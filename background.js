const KEY = "timers"; // { [tabId]: { end: epochMs } }

async function getTimers() {
  const r = await chrome.storage.session.get(KEY);
  return r[KEY] || {};
}
const setTimers = (t) => chrome.storage.session.set({ [KEY]: t });

async function updateBadges() {
  const timers = await getTimers();
  let changed = false;
  for (const [id, t] of Object.entries(timers)) {
    const mins = Math.max(1, Math.ceil((t.end - Date.now()) / 60000));
    try {
      await chrome.action.setBadgeText({ tabId: +id, text: String(mins) });
      await chrome.action.setBadgeBackgroundColor({
        tabId: +id,
        color: mins <= 1 ? "#d93025" : "#1a73e8",
      });
    } catch {
      delete timers[id]; // tab no longer exists
      changed = true;
    }
  }
  if (changed) await setTimers(timers);
}

async function startTimer(tabId, minutes) {
  const timers = await getTimers();
  const end = Date.now() + minutes * 60000;
  timers[tabId] = { end };
  await setTimers(timers);
  chrome.alarms.create(`tab-${tabId}`, { when: end });
  chrome.alarms.create("tick", { periodInMinutes: 0.5 });
  await updateBadges();
}

async function cancelTimer(tabId) {
  const timers = await getTimers();
  delete timers[tabId];
  await setTimers(timers);
  chrome.alarms.clear(`tab-${tabId}`);
  try {
    await chrome.action.setBadgeText({ tabId, text: "" });
  } catch {}
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  const run = msg.type === "start" ? startTimer(msg.tabId, msg.minutes)
            : msg.type === "cancel" ? cancelTimer(msg.tabId)
            : null;
  if (run) run.then(() => respond({ ok: true }));
  return !!run; // keep channel open for async response
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "tick") return updateBadges();
  if (!alarm.name.startsWith("tab-")) return;
  const tabId = +alarm.name.slice(4);
  const timers = await getTimers();
  delete timers[tabId];
  await setTimers(timers);
  try {
    await chrome.tabs.remove(tabId);
  } catch {}
});

chrome.tabs.onRemoved.addListener((tabId) => cancelTimer(tabId));

// Per-tab badges reset on navigation, so reapply.
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === "loading") updateBadges();
});
