// End of timer: the tab is NEVER closed. The timer stops on its own, the lock
// lifts, the widget goes away, and a bell + notification fire. A timer stopped
// early must not ring.
// (The sound itself can't be heard from automation; we check that the bell page
// was created and its AudioContext started.)
import { launch, reporter, sleep } from './helpers.mjs';

const t = reporter('expiry: bell + notification, tab stays open');
const { ctx, sw, id, close } = await launch({ grantHosts: true });

try {
  const A = await ctx.newPage();
  await A.goto('https://example.com');
  const B = await ctx.newPage();
  await B.goto('https://example.org');
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await A.bringToFront();
  await sleep(400);

  const state = () =>
    sw.evaluate(async () => {
      const [a] = await chrome.tabs.query({ url: 'https://example.com/*' });
      const [b] = await chrome.tabs.query({ url: 'https://example.org/*' });
      const all = await chrome.tabs.query({ windowId: a?.windowId });
      const [active] = a ? await chrome.tabs.query({ active: true, windowId: a.windowId }) : [];
      const { timers, lastBell } = await chrome.storage.session.get(['timers', 'lastBell']);
      const notes = await chrome.notifications.getAll();
      const offscreen = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      const alarms = (await chrome.alarms.getAll()).map((x) => x.name);
      return {
        aId: a?.id, bId: b?.id, activeId: active?.id, tabCount: all.length,
        timers: timers ?? {}, lastBell: lastBell ?? null, notes: Object.keys(notes),
        offscreen: offscreen.length, alarms,
      };
    });
  const send = (msg) => popup.evaluate((m) => chrome.runtime.sendMessage(m), msg);

  let s = await state();
  const aId = s.aId;

  // ---- 1. A timer stopped early must NOT ring ------------------------------
  let r = await send({ type: 'start', tabId: aId, minutes: 0.05 }); // 3 seconds
  t.check('short timer starts', r.ok === true, JSON.stringify(r));
  await sleep(800);
  await send({ type: 'cancel', tabId: aId });
  await sleep(4500); // well past when it would have ended
  s = await state();
  t.check('a stopped timer does not ring or notify', s.lastBell === null && s.notes.length === 0 && s.offscreen === 0,
    `bell=${JSON.stringify(s.lastBell)} notes=${s.notes} offscreen=${s.offscreen}`);
  t.check('and its repeating badge alarm was cleared', !s.alarms.includes('tick'), JSON.stringify(s.alarms));

  // ---- 2. Timer runs out ----------------------------------------------------
  await A.bringToFront();
  await sleep(400);
  r = await send({ type: 'start', tabId: aId, minutes: 0.05 });
  t.check('timer starts again', r.ok === true);
  await A.locator('tabbed-in-widget .widget').waitFor({ timeout: 8000 }).catch(() => {});
  await B.bringToFront();
  await sleep(1000);
  s = await state();
  t.check('lock is on while the timer runs', s.activeId === aId && Object.keys(s.timers).length === 1);

  const tabsBefore = s.tabCount;
  await sleep(4500); // timer ends after ~3 s
  s = await state();
  t.check('the tab is NOT closed when time is up', s.aId === aId && A.url().includes('example.com') && s.tabCount === tabsBefore,
    `tabs ${tabsBefore} -> ${s.tabCount}`);
  t.check('the timer stopped on its own', Object.keys(s.timers).length === 0, JSON.stringify(s.timers));
  t.check('a notification was shown', s.notes.includes('tabbed-in-done'), JSON.stringify(s.notes));
  t.check('the bell page was created', s.offscreen === 1);
  t.check('the bell started playing', !!s.lastBell && s.lastBell.state !== 'error' && Date.now() - s.lastBell.at < 10_000,
    JSON.stringify(s.lastBell));
  t.check('the widget is gone', (await A.locator('tabbed-in-widget').count()) === 0);
  t.check('the repeating badge alarm was cleared', !s.alarms.includes('tick'), JSON.stringify(s.alarms));

  // ---- 3. Afterwards the user is free ----------------------------------------
  await B.bringToFront();
  await sleep(1200);
  s = await state();
  t.check('after the timer ends, switching tabs works again', s.activeId === s.bId);
  const before = s.tabCount;
  const free = await ctx.newPage().catch(() => null);
  await sleep(1000);
  s = await state();
  t.check('after the timer ends, new tabs are not closed', s.tabCount === before + 1);
  await free?.close().catch(() => {});
} catch (e) {
  t.fail(`unexpected error: ${e.message}`);
} finally {
  await close();
  t.done();
}
