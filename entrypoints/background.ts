// Background script: timers, badges, the on-page widget, the tab-switch lock,
// and the end-of-timer alert (bell + notification; the tab is never closed).
// Still to come: pause/resume (see REQUIREMENTS.md).

import {
  decideLockAction,
  findTimerFor,
  isGroupId,
  recordRevert,
  shouldCloseNewTab,
  type TimerRecord,
  type Timers,
} from '../utils/lock';
import { retry } from '../utils/retry';

const KEY = 'timers';

async function getTimers(): Promise<Timers> {
  const r = await browser.storage.session.get(KEY);
  return (r[KEY] as Timers | undefined) ?? {};
}
const setTimers = (t: Timers) => browser.storage.session.set({ [KEY]: t });

/**
 * Every tab a timer covers: just the timed tab, or all tabs currently in the
 * timer's tab group. Never empty (falls back to the timed tab).
 */
async function timerTabs(key: string, t: TimerRecord): Promise<number[]> {
  if (!isGroupId(t.groupId)) return [+key];
  try {
    const ids = (await browser.tabs.query({ groupId: t.groupId }))
      .map((x) => x.id)
      .filter((x): x is number => x !== undefined);
    return ids.length > 0 ? ids : [+key];
  } catch {
    return [+key];
  }
}

async function updateBadges() {
  const timers = await getTimers();
  let changed = false;
  for (const [key, t] of Object.entries(timers)) {
    const mins = Math.max(1, Math.ceil((t.end - Date.now()) / 60000));
    let shown = 0;
    for (const tabId of await timerTabs(key, t)) {
      try {
        await browser.action.setBadgeText({ tabId, text: String(mins) });
        await browser.action.setBadgeBackgroundColor({
          tabId,
          color: mins <= 1 ? '#d93025' : '#1a73e8',
        });
        shown++;
      } catch {} // that tab no longer exists
    }
    if (shown === 0) {
      delete timers[key]; // nothing left to time
      changed = true;
    }
  }
  if (changed) await setTimers(timers);
}

// --- on-page widget -------------------------------------------------------
// Injected only into timed tabs, and only works once the user has granted the
// optional site-access permission (requested from the popup on Start).

async function injectWidget(tabId: number) {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/widget.js'],
    });
  } catch {} // no site access yet, restricted page, or tab gone
}

async function sendToTab(tabId: number, message: unknown) {
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch {} // no widget on this tab
}

const notifyWidget = (tabId: number, end: number | null) =>
  sendToTab(tabId, { type: 'timer-changed', end });

type StartResult = { ok: true } | { ok: false; error: string };

/** `group`: cover the whole tab group of `tabId` (ignored if the tab is not in one). */
async function startTimer(tabId: number, minutes: number, group = false): Promise<StartResult> {
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
    return { ok: false, error: 'Enter a number of minutes between 1 and 1440.' };
  }
  const timers = await getTimers();

  // Only one timer at a time (the lock needs a single timed tab). Forget
  // timers whose tab no longer exists so a dead record can't block a new one.
  for (const id of Object.keys(timers)) {
    try {
      await browser.tabs.get(+id);
    } catch {
      delete timers[id];
    }
  }
  if (Object.keys(timers).length > 0) {
    await setTimers(timers);
    return { ok: false, error: 'A timer is already running. Stop it first.' };
  }

  let windowId: number;
  let groupId: number | undefined;
  try {
    const tab = await browser.tabs.get(tabId);
    windowId = tab.windowId;
    if (group && isGroupId(tab.groupId)) groupId = tab.groupId;
  } catch {
    return { ok: false, error: 'That tab is no longer available.' };
  }

  const end = Date.now() + minutes * 60000;
  const record: TimerRecord = { end, windowId };
  if (groupId !== undefined) {
    record.groupId = groupId;
    record.lastTabId = tabId;
  }
  timers[tabId] = record;
  await setTimers(timers);
  browser.alarms.create(`tab-${tabId}`, { when: end });
  browser.alarms.create('tick', { periodInMinutes: 0.5 });
  await updateBadges();
  for (const id of await timerTabs(String(tabId), record)) {
    await injectWidget(id);
    await notifyWidget(id, end);
  }
  return { ok: true };
}

async function cancelTimer(tabId: number) {
  const timers = await getTimers();
  const t = timers[tabId];
  // Work out which tabs to clean up BEFORE the record is gone.
  const tabs = t ? await timerTabs(String(tabId), t) : [tabId];
  delete timers[tabId];
  await setTimers(timers);
  browser.alarms.clear(`tab-${tabId}`);
  if (Object.keys(timers).length === 0) browser.alarms.clear('tick'); // nothing left to refresh
  for (const id of tabs) {
    try {
      await browser.action.setBadgeText({ tabId: id, text: '' });
    } catch {}
    await notifyWidget(id, null);
  }
}

/**
 * A tab was closed. A single-tab timer ends with its tab. A group timer carries
 * on as long as the group still has a tab: the record moves to a surviving tab
 * (records are keyed by tab id, and alarms by that key).
 */
async function onTabClosed(tabId: number) {
  const timers = await getTimers();
  const t = timers[tabId];
  if (!t) return;
  if (!isGroupId(t.groupId)) return cancelTimer(tabId);

  let survivors: number[] = [];
  try {
    survivors = (await browser.tabs.query({ groupId: t.groupId }))
      .map((x) => x.id)
      .filter((x): x is number => x !== undefined && x !== tabId);
  } catch {}
  if (survivors.length === 0) return cancelTimer(tabId);

  const newKey = survivors.includes(t.lastTabId ?? -1) ? t.lastTabId! : survivors[0]!;
  delete timers[tabId];
  timers[newKey] = { ...t, lastTabId: newKey };
  await setTimers(timers);
  browser.alarms.clear(`tab-${tabId}`);
  browser.alarms.create(`tab-${newKey}`, { when: t.end });
}

// --- end of timer ----------------------------------------------------------
// When time is up the timer stops on its own, the lock is released, and the
// user gets a bell and a notification. The tab is NEVER closed.

/** Ring the bell. A service worker can't play audio, so use an offscreen page. */
async function ringBell() {
  try {
    if (browser.offscreen?.createDocument) {
      const open = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (open.length === 0) {
        await browser.offscreen.createDocument({
          url: browser.runtime.getURL('/offscreen.html'),
          reasons: ['AUDIO_PLAYBACK'],
          justification: 'Play the bell when the timer ends',
        });
      }
      // The page may not have registered its listener yet right after creation,
      // so retry until a receiver exists.
      await retry(
        () => browser.runtime.sendMessage({ target: 'offscreen', type: 'play-bell' }),
        30,
        100,
      );
    } else if (typeof AudioContext !== 'undefined') {
      // Browsers whose background page has audio (e.g. Firefox).
      const { playBell } = await import('../utils/bell');
      playBell(new AudioContext());
    }
  } catch (err) {
    console.warn('[tabbed-in] could not ring the bell', err);
  }
}

async function showDoneNotification(tabTitle: string) {
  try {
    await browser.notifications.create('tabbed-in-done', {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: "Time's up",
      message: tabTitle
        ? `Your timer on "${tabTitle}" has ended. The tab is still open.`
        : 'Your timer has ended. The tab is still open.',
      priority: 2,
    });
  } catch (err) {
    console.warn('[tabbed-in] could not show the notification', err);
  }
}

async function finishTimer(tabId: number) {
  const t = (await getTimers())[tabId];
  if (!t) return; // cancelled in the meantime
  if (t.end > Date.now() + 2000) return; // a stale alarm from an earlier timer on this tab

  let title = '';
  try {
    title = (await browser.tabs.get(tabId)).title ?? '';
  } catch {}

  await cancelTimer(tabId); // removes the timer (so the lock is gone), badge, and widget
  await Promise.all([ringBell(), showDoneNotification(title)]);
}

// --- tab-switch lock -------------------------------------------------------
// While a timer runs, activating another tab in the timed tab's window snaps
// back to the timed tab. Fails open: any doubt, error, or revert loop releases
// the lock (the timer keeps running) instead of trapping the user.

let recentReverts: number[] = [];

/** Release the lock for one timer but keep it running. */
async function releaseLock(tabId: number, reason: string) {
  console.warn(`[tabbed-in] lock released: ${reason}`);
  const timers = await getTimers();
  const t = timers[tabId];
  if (t) {
    t.lockOff = true;
    await setTimers(timers);
    for (const id of await timerTabs(String(tabId), t)) {
      await sendToTab(id, { type: 'lock-released', reason });
    }
  }
}

/**
 * Bring the timed tab back to the front. Chrome fires onActivated on mouse-DOWN
 * over a tab and rejects tabs.update until the click ends, so retry. Each try
 * re-checks that the lock is still on (the user may have stopped the timer in
 * the meantime). Returns the id of the tab that was activated, or null.
 *
 * For a group timer the target is the group tab the user was last on (falling
 * back to the timed tab, then to any tab still in the group).
 *
 * Failing here is NOT a reason to release the lock: not being able to enforce
 * can't trap anyone, so we just log and try again on the next activation.
 */
async function returnToTimedTab(timedTabId: number): Promise<number | null> {
  try {
    return await retry(async () => {
      const t = (await getTimers())[timedTabId];
      if (!t || t.lockOff) return null; // lock released while we were retrying
      let target = timedTabId;
      if (isGroupId(t.groupId)) {
        const inGroup = await timerTabs(String(timedTabId), t);
        const wanted = [t.lastTabId, timedTabId].find((x) => x !== undefined && inGroup.includes(x));
        target = wanted ?? inGroup[0] ?? timedTabId;
      }
      await browser.tabs.update(target, { active: true });
      return target;
    });
  } catch (err) {
    console.warn('[tabbed-in] could not return to the timed tab', err);
    return null;
  }
}

/**
 * Browsers may attach a brand-new tab to its group a moment AFTER creating it
 * (the group's own "+" button). So for a tab created in the last couple of
 * seconds that doesn't look grouped yet, wait briefly and look again before
 * treating it as an outsider.
 */
const recentlyCreated = new Map<number, number>();
const NEW_TAB_GRACE_MS = 2000;
const GROUP_SETTLE_MS = 400;

async function settledGroupId(tabId: number, groupId: number | undefined, wanted: number) {
  const born = recentlyCreated.get(tabId);
  if (groupId === wanted || born === undefined || Date.now() - born > NEW_TAB_GRACE_MS) return groupId;
  await new Promise((r) => setTimeout(r, GROUP_SETTLE_MS));
  try {
    return (await browser.tabs.get(tabId)).groupId;
  } catch {
    return groupId;
  }
}

async function enforceLock(info: { tabId: number; windowId: number }) {
  try {
    const timers = await getTimers();
    // onActivated doesn't say which group the tab is in; only look it up when a
    // group timer exists (single-tab timers behave exactly as before).
    const activation: { tabId: number; windowId: number; groupId?: number } = { ...info };
    const groupTimer = Object.values(timers).find((t) => isGroupId(t.groupId));
    if (groupTimer) {
      try {
        const g = (await browser.tabs.get(info.tabId)).groupId;
        activation.groupId = await settledGroupId(info.tabId, g, groupTimer.groupId!);
      } catch {
        return; // the tab is already gone: nothing to enforce (fail open)
      }
    }
    const decision = decideLockAction(timers, activation, Date.now());
    if (decision.action === 'ignore') return;

    if (decision.action === 'track') {
      // Moved within the locked group: remember where, so a revert comes back here.
      const t = timers[decision.timerTabId];
      if (t && t.lastTabId !== info.tabId) {
        t.lastTabId = info.tabId;
        await setTimers(timers);
      }
      return;
    }

    if (decision.action === 'release') {
      await releaseLock(decision.timerTabId, decision.reason);
      return;
    }

    // decision.action === 'revert'
    const timedTabId = decision.timerTabId;
    const record = timers[timedTabId];
    if (record && isGroupId(record.groupId)) {
      // Group timer: if the group has dissolved (all tabs ungrouped) there is
      // nothing to return to, so release rather than strand the user.
      const inGroup = await timerTabs(String(timedTabId), record);
      if (!(await browser.tabs.get(inGroup[0] ?? timedTabId).then((x) => x.groupId === record.groupId, () => false))) {
        await releaseLock(timedTabId, 'the tab group no longer exists');
        return;
      }
    } else {
      try {
        await browser.tabs.get(timedTabId);
      } catch {
        await cancelTimer(timedTabId); // timed tab is gone: drop the timer and the lock
        return;
      }
    }

    const { history, trip } = recordRevert(recentReverts, Date.now());
    recentReverts = history;
    if (trip) {
      recentReverts = [];
      await releaseLock(timedTabId, 'too many tab switches in a row (possible conflict)');
      return;
    }

    const shownOn = await returnToTimedTab(timedTabId);
    if (shownOn !== null) await sendToTab(shownOn, { type: 'lock-blocked' });
  } catch (err) {
    // Safe mode: a bug in the lock logic must never leave the lock held.
    console.error('[tabbed-in] lock error, releasing all locks', err);
    try {
      const timers = await getTimers();
      for (const t of Object.values(timers)) t.lockOff = true;
      await setTimers(timers);
    } catch {}
  }
}

/**
 * Close tabs the user opens while locked (new-tab button, Ctrl+T) so nothing is
 * left to click. Tabs opened by a link on the timed page are kept. Focus is
 * handled by enforceLock (onActivated), which also feeds the circuit breaker,
 * so closing here does not count reverts a second time.
 */
async function closeNewTabIfLocked(tab: {
  id?: number;
  windowId: number;
  groupId?: number;
  openerTabId?: number;
  url?: string;
  pendingUrl?: string;
}) {
  try {
    const timers = await getTimers();
    const groupTimer = Object.values(timers).find((t) => isGroupId(t.groupId));
    if (tab.id !== undefined && groupTimer) {
      tab = { ...tab, groupId: await settledGroupId(tab.id, tab.groupId, groupTimer.groupId!) };
    }
    const decision = shouldCloseNewTab(await getTimers(), tab, Date.now());
    if (decision.action !== 'close' || tab.id === undefined) return;
    const newTabId = tab.id;
    try {
      await retry(() => browser.tabs.remove(newTabId)); // same mouse-down caveat as above
    } catch (err) {
      // Could not close it; the lock still keeps focus on the timed tab.
      console.warn('[tabbed-in] could not close the new tab', err);
    }
    const shownOn = await returnToTimedTab(decision.timerTabId);
    if (shownOn !== null) await sendToTab(shownOn, { type: 'lock-blocked' });
  } catch (err) {
    console.error('[tabbed-in] new-tab handling failed, releasing all locks', err);
    try {
      const timers = await getTimers();
      for (const t of Object.values(timers)) t.lockOff = true;
      await setTimers(timers);
    } catch {}
  }
}

type Message =
  | { type: 'start'; tabId: number; minutes: number; group?: boolean }
  | { type: 'cancel'; tabId: number }
  | { type: 'widget-state' }
  | { type: 'bell-played'; state: string };

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: Message, sender, respond) => {
    if (msg.type === 'bell-played') {
      // Reported by the hidden bell page, which has no storage access of its own.
      browser.storage.session.set({ lastBell: { at: Date.now(), state: msg.state } });
      return false;
    }
    if (msg.type === 'widget-state') {
      // A freshly injected widget asks what to show for its own tab.
      // (a group timer applies to every tab of its group).
      const tab = sender.tab;
      getTimers().then((t) => respond(tab ? (findTimerFor(t, tab)?.[1] ?? null) : null));
      return true;
    }
    const run: Promise<StartResult> | null =
      msg.type === 'start' ? startTimer(msg.tabId, msg.minutes, msg.group)
      : msg.type === 'cancel' ? cancelTimer(msg.tabId).then((): StartResult => ({ ok: true }))
      : null;
    if (run) run.then(respond);
    return !!run; // keep channel open for async response
  });

  browser.tabs.onActivated.addListener((info) => enforceLock(info));
  browser.tabs.onCreated.addListener((tab) => {
    if (tab.id !== undefined) {
      recentlyCreated.set(tab.id, Date.now());
      setTimeout(() => recentlyCreated.delete(tab.id!), NEW_TAB_GRACE_MS + 1000);
    }
    closeNewTabIfLocked(tab);
  });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'tick') return updateBadges();
    if (!alarm.name.startsWith('tab-')) return;
    await finishTimer(+alarm.name.slice(4));
  });

  browser.tabs.onRemoved.addListener((tabId) => onTabClosed(tabId));

  // Per-tab badges reset on navigation, so reapply. The widget lives in the
  // page, so it is gone after a navigation and must be injected again. A tab
  // that joins the timer's group gets the badge and widget too.
  browser.tabs.onUpdated.addListener(async (id, info, tab) => {
    if (info.status === 'loading') updateBadges();
    const joinedGroup = info.groupId !== undefined && isGroupId(info.groupId);
    const leftGroup = info.groupId === -1;
    if (info.status !== 'complete' && !joinedGroup && !leftGroup) return;
    const hit = findTimerFor(await getTimers(), { id, groupId: tab.groupId });
    if (!hit) {
      if (leftGroup) {
        await sendToTab(id, { type: 'timer-changed', end: null }); // drop its widget and badge
        try {
          await browser.action.setBadgeText({ tabId: id, text: '' });
        } catch {}
        // Taking the tab you're ON out of the group fires no tab-switch event, so
        // re-check it now or dragging it out would be a way around the lock.
        if (tab.active) await enforceLock({ tabId: id, windowId: tab.windowId });
      }
      return;
    }
    if (joinedGroup) updateBadges();
    await injectWidget(id);
    await notifyWidget(id, hit[1].end);
  });

  // The user just granted site access (popup Start): show widgets that were
  // waiting for it.
  browser.permissions.onAdded.addListener(async () => {
    const timers = await getTimers();
    for (const [key, t] of Object.entries(timers)) {
      for (const id of await timerTabs(key, t)) injectWidget(id);
    }
  });
});
