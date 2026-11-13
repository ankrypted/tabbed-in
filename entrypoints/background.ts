// Baseline port of the v1.0 background script. Behaviour is unchanged for now;
// it is replaced by the state-machine-driven version (see REQUIREMENTS.md).

type Timer = { end: number };
type Timers = Record<string, Timer>;

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

async function startTimer(tabId: number, minutes: number) {
  const timers = await getTimers();
  const end = Date.now() + minutes * 60000;
  timers[tabId] = { end };
  await setTimers(timers);
  browser.alarms.create(`tab-${tabId}`, { when: end });
  browser.alarms.create('tick', { periodInMinutes: 0.5 });
  await updateBadges();
}

async function cancelTimer(tabId: number) {
  const timers = await getTimers();
  delete timers[tabId];
  await setTimers(timers);
  browser.alarms.clear(`tab-${tabId}`);
  try {
    await browser.action.setBadgeText({ tabId, text: '' });
  } catch {}
}

type Message =
  | { type: 'start'; tabId: number; minutes: number }
  | { type: 'cancel'; tabId: number };

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: Message, _sender, respond) => {
    const run =
      msg.type === 'start' ? startTimer(msg.tabId, msg.minutes)
      : msg.type === 'cancel' ? cancelTimer(msg.tabId)
      : null;
    if (run) run.then(() => respond({ ok: true }));
    return !!run; // keep channel open for async response
  });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'tick') return updateBadges();
    if (!alarm.name.startsWith('tab-')) return;
    const tabId = +alarm.name.slice(4);
    const timers = await getTimers();
    delete timers[tabId];
    await setTimers(timers);
    try {
      await browser.tabs.remove(tabId);
    } catch {}
  });

  browser.tabs.onRemoved.addListener((tabId) => cancelTimer(tabId));

  // Per-tab badges reset on navigation, so reapply.
  browser.tabs.onUpdated.addListener((_id, info) => {
    if (info.status === 'loading') updateBadges();
  });
});
