// Tab-switch lock: reverts switches, closes new-tab-page tabs, keeps link-opened
// tabs, allows in-tab navigation, one timer at a time, and every way out
// (stop, circuit breaker, corrupt record, closing the tab).
import { launch, reporter, sleep } from './helpers.mjs';

const t = reporter('lock: tab switching, new tabs, safety nets');
const { ctx, sw, id, close } = await launch({ grantHosts: true });

try {
  const A = await ctx.newPage();
  await A.goto('https://example.com');
  const B = await ctx.newPage(); // an existing tab, created BEFORE the timer
  await B.goto('https://example.org');
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await A.bringToFront();
  await sleep(400);

  const info = () =>
    sw.evaluate(async () => {
      const [a] = await chrome.tabs.query({ url: 'https://example.com/*' });
      const b = (await chrome.tabs.query({ url: 'https://example.org/*' })).find((x) => !x.url.includes('linked'));
      const all = await chrome.tabs.query({ windowId: a.windowId });
      const [active] = await chrome.tabs.query({ active: true, windowId: a.windowId });
      const { timers } = await chrome.storage.session.get('timers');
      return { aId: a.id, bId: b?.id, activeId: active.id, count: all.length, urls: all.map((x) => x.url), timers: timers ?? {} };
    });
  const send = (msg) => popup.evaluate((m) => chrome.runtime.sendMessage(m), msg);

  const { aId } = await info();

  // --- start ---------------------------------------------------------------
  let r = await send({ type: 'start', tabId: aId, minutes: 5 });
  t.check('start on tab A succeeds', r.ok === true, JSON.stringify(r));
  await A.locator('tabbed-in-widget .widget').waitFor({ timeout: 8000 }).catch(() => {});
  await sleep(500);

  // --- switching to an existing tab is undone ------------------------------
  await B.bringToFront();
  await sleep(1200);
  let s = await info();
  t.check('switching to existing tab B is reverted to A', s.activeId === aId);
  const note = await A.locator('tabbed-in-widget .note.show').textContent().catch(() => null);
  t.check('widget explains why', !!note && /Locked/.test(note), JSON.stringify(note));

  // --- new tabs ------------------------------------------------------------
  const before = (await info()).count;
  // Like the + button / Ctrl+T: the browser's own New Tab page, no opener.
  const ntpUrl = await sw.evaluate(async () => (await chrome.tabs.create({})).pendingUrl ?? 'n/a');
  await sleep(1500);
  s = await info();
  t.check('new-tab-page tab is closed automatically', s.count === before, `tabs before=${before} after=${s.count}, url=${ntpUrl}`);
  await sw.evaluate(async (aId) => { await chrome.tabs.create({ openerTabId: aId }); }, aId);
  await sleep(1500);
  s = await info();
  t.check('New Tab page is closed even with the timed tab as opener', s.count === before, `tabs=${s.count}`);
  t.check('focus is back on A after the new tab', s.activeId === aId);

  // A tab opened by a link on the timed page is kept.
  await A.evaluate(() => {
    const a = document.createElement('a');
    a.href = 'https://example.org/?linked=1';
    a.target = '_blank';
    a.id = 'tl';
    a.textContent = 'open';
    a.style.cssText = 'position:fixed;left:20px;top:200px;font-size:30px;background:#fff;z-index:99999';
    document.body.append(a);
  });
  const beforeLink = (await info()).count;
  await A.locator('#tl').click();
  await sleep(1800);
  s = await info();
  t.check('tab opened by a link on the timed page is kept', s.urls.some((u) => u.includes('linked=1')) && s.count === beforeLink + 1);
  t.check('...and focus stays on A', s.activeId === aId);

  // --- navigation inside the timed tab is allowed --------------------------
  await A.goto('https://example.com/?x=1');
  await sleep(800);
  s = await info();
  t.check('navigating inside A is allowed and A stays active', s.activeId === aId && A.url().includes('x=1'));
  t.check('widget re-appears after navigation',
    await A.locator('tabbed-in-widget .widget').waitFor({ timeout: 8000 }).then(() => true).catch(() => false));

  // --- one timer at a time -------------------------------------------------
  r = await send({ type: 'start', tabId: s.bId, minutes: 5 });
  t.check('second timer on another tab is refused', r.ok === false, JSON.stringify(r));

  // --- stop releases the lock ---------------------------------------------
  await send({ type: 'cancel', tabId: aId });
  await sleep(500);
  await B.bringToFront();
  await sleep(1200);
  s = await info();
  t.check('after stop, switching to B sticks', s.activeId === s.bId && Object.keys(s.timers).length === 0);
  const beforeFree = s.count;
  const free = await ctx.newPage().catch(() => null);
  await sleep(1000);
  s = await info();
  t.check('after stop, a new tab is NOT closed', s.count === beforeFree + 1);
  await free?.close().catch(() => {});

  // --- circuit breaker -----------------------------------------------------
  await A.bringToFront();
  await sleep(500);
  r = await send({ type: 'start', tabId: aId, minutes: 5 });
  t.check('restart timer on A', r.ok === true);
  for (let i = 0; i < 12; i++) {
    await B.bringToFront();
    await sleep(80);
  }
  await sleep(1500);
  s = await info();
  t.check('rapid switching trips the circuit breaker (lockOff)', s.timers[aId]?.lockOff === true, JSON.stringify(s.timers[aId]));
  t.check('timer keeps running after the breaker', !!s.timers[aId]);
  await B.bringToFront();
  await sleep(1000);
  s = await info();
  t.check('after the breaker, switching to B sticks', s.activeId === s.bId);
  const beforeBreaker = s.count;
  const afterBreaker = await ctx.newPage().catch(() => null);
  await sleep(1000);
  s = await info();
  t.check('after the breaker, a new tab is NOT closed', s.count === beforeBreaker + 1);
  await afterBreaker?.close().catch(() => {});

  // --- fail open on a corrupt record ---------------------------------------
  await send({ type: 'cancel', tabId: aId });
  await sw.evaluate(async (aId) => {
    const a = await chrome.tabs.get(aId);
    await chrome.storage.session.set({ timers: { [aId]: { end: 'garbage', windowId: a.windowId } } });
  }, aId);
  await B.bringToFront();
  await sleep(1000);
  s = await info();
  t.check('a corrupt timer record never traps the user', s.activeId === s.bId, JSON.stringify(s.timers));
  await send({ type: 'cancel', tabId: aId });

  // --- closing the timed tab ----------------------------------------------
  await A.bringToFront();
  await send({ type: 'start', tabId: aId, minutes: 5 });
  await A.close();
  await sleep(1000);
  const timers = await sw.evaluate(async () => (await chrome.storage.session.get('timers')).timers ?? {});
  t.check('closing the timed tab removes its timer', Object.keys(timers).length === 0, JSON.stringify(timers));
} catch (e) {
  t.fail(`unexpected error: ${e.message}`);
} finally {
  await close();
  t.done();
}
