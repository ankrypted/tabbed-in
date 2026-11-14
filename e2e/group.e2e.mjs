// Group timers: one timer covers a whole browser tab group; the user can move
// freely between the group's tabs, everything else is locked, and it fails open
// (group dissolved) and survives losing the tab it was started on.
import { launch, reporter, sleep } from './helpers.mjs';

const t = reporter('group: one timer for a tab group');
const { ctx, sw, id, close } = await launch({ grantHosts: true });

try {
  const G1 = await ctx.newPage();
  await G1.goto('https://example.com');
  const G2 = await ctx.newPage();
  await G2.goto('https://example.org');
  const O = await ctx.newPage(); // outside the group
  await O.goto('https://example.net');
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await G1.bringToFront();
  await sleep(400);

  const info = () =>
    sw.evaluate(async () => {
      const find = async (u) => (await chrome.tabs.query({ url: u }))[0];
      const [g1, g2, o] = await Promise.all([find('https://example.com/*'), find('https://example.org/*'), find('https://example.net/*')]);
      const all = await chrome.tabs.query({ windowId: o.windowId });
      const [active] = await chrome.tabs.query({ active: true, windowId: o.windowId });
      const { timers } = await chrome.storage.session.get('timers');
      return {
        g1: g1?.id, g2: g2?.id, o: o.id, groupId: g1?.groupId, activeId: active.id,
        count: all.length, timers: timers ?? {},
      };
    });
  const send = (msg) => popup.evaluate((m) => chrome.runtime.sendMessage(m), msg);

  // --- build the group (G1 + G2), O stays outside -----------------------------
  let s = await info();
  const groupId = await sw.evaluate(async ([a, b]) => chrome.tabs.group({ tabIds: [a, b] }), [s.g1, s.g2]);
  await sleep(300);
  s = await info();
  t.check('G1 and G2 are in a tab group', groupId >= 0 && s.groupId === groupId, `group=${groupId}`);

  // --- start on G1 with group:true -------------------------------------------
  await G1.bringToFront();
  let r = await send({ type: 'start', tabId: s.g1, minutes: 5, group: true });
  t.check('start with group:true succeeds', r.ok === true, JSON.stringify(r));
  s = await info();
  const rec = s.timers[s.g1];
  t.check('record stores the group id and last tab', rec?.groupId === groupId && rec?.lastTabId === s.g1, JSON.stringify(rec));
  t.check('widget shows on the started tab',
    await G1.locator('tabbed-in-widget .widget').waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  t.check('widget shows on the OTHER group tab too',
    await G2.locator('tabbed-in-widget .widget').waitFor({ timeout: 8000 }).then(() => true).catch(() => false));

  // --- moving inside the group is allowed ----------------------------------
  await G2.bringToFront();
  await sleep(1200);
  s = await info();
  t.check('switching to another tab of the group sticks', s.activeId === s.g2);
  t.check('...and the last group tab is remembered', s.timers[s.g1]?.lastTabId === s.g2, JSON.stringify(s.timers[s.g1]));
  await G1.bringToFront();
  await sleep(800);
  s = await info();
  t.check('...and back again', s.activeId === s.g1);

  // --- leaving the group is reverted, to the LAST group tab -------------------
  await G2.bringToFront();
  await sleep(800);
  await O.bringToFront();
  await sleep(1500);
  s = await info();
  t.check('switching to a tab outside the group is reverted', s.activeId !== s.o);
  t.check('...back to the group tab the user was last on (G2)', s.activeId === s.g2);
  const note = await G2.locator('tabbed-in-widget .note.show').textContent().catch(() => null);
  t.check('widget explains why', !!note && /Locked/.test(note), JSON.stringify(note));

  // --- new tabs --------------------------------------------------------------
  const before = (await info()).count;
  await sw.evaluate(async () => { await chrome.tabs.create({}); });
  await sleep(1500);
  s = await info();
  t.check('a New Tab page is closed while the group is locked', s.count === before, `before=${before} after=${s.count}`);
  t.check('...and focus returns to a group tab', s.activeId === s.g1 || s.activeId === s.g2);

  // --- a tab joining the group is covered by the timer -------------------------
  await sw.evaluate(async ([o, g]) => chrome.tabs.group({ tabIds: [o], groupId: g }), [s.o, groupId]);
  await sleep(1200);
  t.check('a tab dragged into the group gets the widget',
    await O.locator('tabbed-in-widget .widget').waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  await O.bringToFront();
  await sleep(1000);
  s = await info();
  t.check('...and can be switched to', s.activeId === s.o);
  await sw.evaluate(async (o) => chrome.tabs.ungroup([o]), s.o);
  await sleep(1500);
  s = await info();
  t.check('taking it out of the group again re-locks (reverted to a group tab)', s.activeId === s.g1 || s.activeId === s.g2, `active=${s.activeId}`);
  const widgetGone = await O.locator('tabbed-in-widget').count();
  t.check('...and its widget is removed', widgetGone === 0);

  // --- closing the tab the timer was started on keeps the timer ---------------
  await G2.bringToFront();
  await sleep(500);
  await G1.close();
  await sleep(1200);
  s = await info();
  const keys = Object.keys(s.timers);
  t.check('closing the starting tab keeps the group timer', keys.length === 1, JSON.stringify(s.timers));
  t.check('...re-keyed to a surviving group tab', keys[0] === String(s.g2) && s.timers[s.g2]?.groupId === groupId, JSON.stringify(s.timers));
  const alarm = await sw.evaluate(async (k) => !!(await chrome.alarms.get(`tab-${k}`)), s.g2);
  t.check('...with its alarm moved too', alarm === true);
  const countdown = await G2.locator('tabbed-in-widget .time').textContent().catch(() => null);
  t.check('...and the widget keeps counting', /^\d+:\d\d$/.test((countdown ?? '').trim()), JSON.stringify(countdown));

  // --- stop (found from any tab of the group) -----------------------------------
  await send({ type: 'cancel', tabId: s.g2 });
  await sleep(500);
  s = await info();
  t.check('stop removes the timer', Object.keys(s.timers).length === 0);
  t.check('...and the widget', (await G2.locator('tabbed-in-widget').count()) === 0);

  // --- fail open: group dissolved ---------------------------------------------
  await G2.bringToFront();
  s = await info();
  r = await send({ type: 'start', tabId: s.g2, minutes: 5, group: true });
  t.check('restart a group timer on G2', r.ok === true, JSON.stringify(r));
  await sw.evaluate(async (g) => {
    const tabs = await chrome.tabs.query({ groupId: g });
    await chrome.tabs.ungroup(tabs.map((x) => x.id));
  }, groupId);
  await sleep(800);
  await O.bringToFront();
  await sleep(1500);
  s = await info();
  t.check('when the group is dissolved the lock releases, not traps', s.activeId === s.o, `active=${s.activeId}`);
  t.check('...and the timer itself keeps running', Object.values(s.timers)[0]?.lockOff === true);
  await send({ type: 'cancel', tabId: s.g2 });

  // --- group:true on an ungrouped tab, and group:false on a grouped one ---------
  await O.bringToFront();
  r = await send({ type: 'start', tabId: s.o, minutes: 5, group: true });
  s = await info();
  t.check('group:true on an ungrouped tab falls back to a single-tab timer', r.ok === true && s.timers[s.o]?.groupId === undefined, JSON.stringify(s.timers));
  await send({ type: 'cancel', tabId: s.o });

  const gid2 = await sw.evaluate(async ([a, b]) => chrome.tabs.group({ tabIds: [a, b] }), [s.g2, s.o]);
  await sleep(300);
  await G2.bringToFront();
  r = await send({ type: 'start', tabId: s.g2, minutes: 5, group: false });
  s = await info();
  t.check('group:false in a group stays a single-tab timer', r.ok === true && gid2 >= 0 && s.timers[s.g2]?.groupId === undefined, JSON.stringify(s.timers));
  await O.bringToFront();
  await sleep(1200);
  s = await info();
  t.check('...and the other group tab is still locked out', s.activeId === s.g2);
  await send({ type: 'cancel', tabId: s.g2 });

  // --- closing every tab of the group ends the timer ------------------------
  await G2.bringToFront();
  await send({ type: 'start', tabId: s.g2, minutes: 5, group: true });
  await sw.evaluate(async (g) => {
    const tabs = await chrome.tabs.query({ groupId: g });
    await chrome.tabs.remove(tabs.map((x) => x.id));
  }, gid2);
  await sleep(1200);
  const left = await sw.evaluate(async () => (await chrome.storage.session.get('timers')).timers ?? {});
  t.check('closing the last tab of the group removes the timer', Object.keys(left).length === 0, JSON.stringify(left));
} catch (e) {
  t.fail(`unexpected error: ${e.message}`);
} finally {
  await close();
  t.done();
}
