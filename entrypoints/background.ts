// Background script: timers, badges, the on-page widget, the tab-switch lock,
// and the end-of-timer alert (bell + notification; the tab is never closed).
// Still to come: pause/resume (see REQUIREMENTS.md).

import { decideLockAction, recordRevert, shouldCloseNewTab, type Timers } from '../utils/lock';
import { retry } from '../utils/retry';

const KEY = 'timers';

async function getTimers(): Promise<Timers> {
  const r = await browser.storage.session.get(KEY);
  return (r[KEY] as Timers | undefined) ?? {};
}
const setTimers = (t: Timers) => browser.storage.session.set({ [KEY]: t });

async function updateBadges() {
  const timers = await getTimers();
  let changed = false;
  for (const [id, t] of Object.entries(timers)) {
    const mins = Math.max(1, Math.ceil((t.end - Date.now()) / 60000));
    try {
      await browser.action.setBadgeText({ tabId: +id, text: String(mins) });
      await browser.action.setBadgeBackgroundColor({
        tabId: +id,
        color: mins <= 1 ? '#d93025' : '#1a73e8',
      });
    } catch {
      delete timers[id]; // tab no longer exists
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

async function startTimer(tabId: number, minutes: number): Promise<StartResult> {
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
  try {
    windowId = (await browser.tabs.get(tabId)).windowId;
  } catch {
    return { ok: false, error: 'That tab is no longer available.' };
  }

  const end = Date.now() + minutes * 60000;
  timers[tabId] = { end, windowId };
  await setTimers(timers);
  browser.alarms.create(`tab-${tabId}`, { when: end });
  browser.alarms.create('tick', { periodInMinutes: 0.5 });
  await updateBadges();
  await injectWidget(tabId);
  await notifyWidget(tabId, end);
  return { ok: true };
}

async function cancelTimer(tabId: number) {
  const timers = await getTimers();
  delete timers[tabId];
  await setTimers(timers);
  browser.alarms.clear(`tab-${tabId}`);
  if (Object.keys(timers).length === 0) browser.alarms.clear('tick'); // nothing left to refresh
  try {
    await browser.action.setBadgeText({ tabId, text: '' });
  } catch {}
  await notifyWidget(tabId, null);
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
  if (timers[tabId]) {
    timers[tabId].lockOff = true;
    await setTimers(timers);
  }
  await sendToTab(tabId, { type: 'lock-released', reason });
}

/**
 * Bring the timed tab back to the front. Chrome fires onActivated on mouse-DOWN
 * over a tab and rejects tabs.update until the click ends, so retry. Each try
 * re-checks that the lock is still on (the user may have stopped the timer in
 * the meantime). Returns true if the timed tab was activated.
 *
 * Failing here is NOT a reason to release the lock: not being able to enforce
 * can't trap anyone, so we just log and try again on the next activation.
 */
async function returnToTimedTab(timedTabId: number): Promise<boolean> {
  try {
    return await retry(async () => {
      const t = (await getTimers())[timedTabId];
      if (!t || t.lockOff) return false; // lock released while we were retrying
      await browser.tabs.update(timedTabId, { active: true });
      return true;
    });
  } catch (err) {
    console.warn('[tabbed-in] could not return to the timed tab', err);
    return false;
  }
}

async function enforceLock(activation: { tabId: number; windowId: number }) {
  try {
    const timers = await getTimers();
    const decision = decideLockAction(timers, activation, Date.now());
    if (decision.action === 'ignore') return;

    if (decision.action === 'release') {
      await releaseLock(decision.timerTabId, decision.reason);
      return;
    }

    // decision.action === 'revert'
    const timedTabId = decision.timerTabId;
    try {
      await browser.tabs.get(timedTabId);
    } catch {
      await cancelTimer(timedTabId); // timed tab is gone: drop the timer and the lock
      return;
    }

    const { history, trip } = recordRevert(recentReverts, Date.now());
    recentReverts = history;
    if (trip) {
      recentReverts = [];
      await releaseLock(timedTabId, 'too many tab switches in a row (possible conflict)');
      return;
    }

    if (await returnToTimedTab(timedTabId)) {
      await sendToTab(timedTabId, { type: 'lock-blocked' });
    }
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
  openerTabId?: number;
  url?: string;
  pendingUrl?: string;
}) {
  try {
    const decision = shouldCloseNewTab(await getTimers(), tab, Date.now());
    if (decision.action !== 'close' || tab.id === undefined) return;
    const newTabId = tab.id;
    try {
      await retry(() => browser.tabs.remove(newTabId)); // same mouse-down caveat as above
    } catch (err) {
      // Could not close it; the lock still keeps focus on the timed tab.
      console.warn('[tabbed-in] could not close the new tab', err);
    }
    if (await returnToTimedTab(decision.timerTabId)) {
      await sendToTab(decision.timerTabId, { type: 'lock-blocked' });
    }
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
  | { type: 'start'; tabId: number; minutes: number }
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
      const tabId = sender.tab?.id;
      getTimers().then((t) => respond(tabId === undefined ? null : (t[tabId] ?? null)));
      return true;
    }
    const run: Promise<StartResult> | null =
      msg.type === 'start' ? startTimer(msg.tabId, msg.minutes)
      : msg.type === 'cancel' ? cancelTimer(msg.tabId).then((): StartResult => ({ ok: true }))
      : null;
    if (run) run.then(respond);
    return !!run; // keep channel open for async response
  });

  browser.tabs.onActivated.addListener((info) => enforceLock(info));
  browser.tabs.onCreated.addListener((tab) => closeNewTabIfLocked(tab));

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'tick') return updateBadges();
    if (!alarm.name.startsWith('tab-')) return;
    await finishTimer(+alarm.name.slice(4));
  });

  browser.tabs.onRemoved.addListener((tabId) => cancelTimer(tabId));

  // Per-tab badges reset on navigation, so reapply. The widget lives in the
  // page, so it is gone after a navigation and must be injected again.
  browser.tabs.onUpdated.addListener(async (id, info) => {
    if (info.status === 'loading') updateBadges();
    if (info.status === 'complete' && (await getTimers())[id]) injectWidget(id);
  });

  // The user just granted site access (popup Start): show widgets that were
  // waiting for it.
  browser.permissions.onAdded.addListener(async () => {
    for (const id of Object.keys(await getTimers())) injectWidget(+id);
  });
});
