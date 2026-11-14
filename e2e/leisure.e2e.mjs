// Leisure mode: no tab lock, the page hazes progressively over the last 15 s,
// and the tab closes at zero. Uses a short real timer (about 24 s).
import { launch, reporter, sleep } from './helpers.mjs';

const t = reporter('leisure: blur in the last 15 s, tab closes at zero, no lock');
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
      const [active] = await chrome.tabs.query({ active: true, windowId: (b ?? a).windowId });
      const { timers } = await chrome.storage.session.get('timers');
      return { a: a?.id, b: b?.id, activeId: active?.id, timers: timers ?? {}, count: (await chrome.tabs.query({})).length };
    });
  const send = (msg) => popup.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  const haze = () =>
    A.locator('tabbed-in-widget .haze').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { display: cs.display, filter: cs.backdropFilter, events: cs.pointerEvents };
    }).catch(() => null);
  const px = (h) => (h && /blur\(([\d.]+)px\)/.exec(h.filter)?.[1]) * 1 || 0;

  // --- popup UI: the mode switch ---------------------------------------------------
  t.check('popup shows Focus and Leisure buttons', (await popup.locator('#mode-focus').isVisible()) && (await popup.locator('#mode-leisure').isVisible()));
  await popup.locator('#mode-leisure').click();
  const help = await popup.locator('#modehelp').textContent();
  t.check('choosing Leisure explains blur + close', /hazier/.test(help ?? '') && /closes/.test(help ?? ''), JSON.stringify(help));
  await popup.locator('#mode-focus').click();
  t.check('choosing Focus shows the lock text', /locked/i.test((await popup.locator('#modehelp').textContent()) ?? ''));

  // --- start ---------------------------------------------------------------------
  let s = await state();
  const r = await send({ type: 'start', tabId: s.a, minutes: 0.4, mode: 'leisure' });
  const end = Date.now() + 0.4 * 60000;
  t.check('start in leisure mode succeeds', r.ok === true, JSON.stringify(r));
  s = await state();
  t.check('record is marked leisure, one tab only', s.timers[s.a]?.mode === 'leisure' && s.timers[s.a]?.groupId === undefined, JSON.stringify(s.timers));
  t.check('widget shows and is labelled Leisure',
    await A.locator('tabbed-in-widget .label').filter({ hasText: 'Leisure' }).waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  let h = await haze();
  t.check('no haze early on', h?.display === 'none', JSON.stringify(h));

  // --- no lock ---------------------------------------------------------------------
  await B.bringToFront();
  await sleep(1200);
  s = await state();
  t.check('switching to another tab is allowed (no lock)', s.activeId === s.b);
  const before = (await state()).count;
  await sw.evaluate(() => chrome.tabs.create({}));
  await sleep(1200);
  t.check('new tabs are not closed', (await state()).count === before + 1);
  await sw.evaluate(async () => { const [n] = await chrome.tabs.query({ url: 'chrome://newtab/' }).catch(() => []); if (n) await chrome.tabs.remove(n.id); });
  await A.bringToFront();

  // --- the haze ramps up over the last 15 s ----------------------------------------
  const sampleAt = async (remainingMs) => {
    await sleep(Math.max(0, end - remainingMs - Date.now()));
    return haze();
  };
  const h16 = await sampleAt(16_500);
  t.check('still clear with ~16 s left', h16?.display === 'none', JSON.stringify(h16));
  const h10 = await sampleAt(10_000);
  const h5 = await sampleAt(5_000);
  const h1 = await sampleAt(1_000);
  t.check('hazy with ~10 s left', px(h10) > 3 && px(h10) < 12, JSON.stringify(h10));
  t.check('hazier with ~5 s left', px(h5) > px(h10), `${px(h10)} -> ${px(h5)}`);
  t.check('hazier still with ~1 s left', px(h1) > px(h5) && px(h1) > 15, `${px(h5)} -> ${px(h1)}`);
  t.check('the haze never blocks clicks', h1?.events === 'none', JSON.stringify(h1));
  const card = await A.locator('tabbed-in-widget .widget').isVisible().catch(() => false);
  t.check('the timer card is still shown above the haze', card === true);

  // --- zero: the tab closes ---------------------------------------------------------
  await sleep(Math.max(0, end - Date.now()) + 2500);
  s = await state();
  t.check('the timed tab is closed at zero', s.a === undefined, `a=${s.a}`);
  t.check('the other tab is untouched', s.b !== undefined);
  t.check('the timer is gone', Object.keys(s.timers).length === 0, JSON.stringify(s.timers));
  t.check('A really is closed', A.isClosed());

  // --- group option does not apply to leisure -------------------------------------
  const C = await ctx.newPage();
  await C.goto('https://example.net');
  const D = await ctx.newPage();
  await D.goto('https://example.com');
  const ids = await sw.evaluate(async () => {
    const [c] = await chrome.tabs.query({ url: 'https://example.net/*' });
    const [d] = await chrome.tabs.query({ url: 'https://example.com/*' });
    return { c: c.id, d: d.id };
  });
  await sw.evaluate((x) => chrome.tabs.group({ tabIds: [x.c, x.d] }), ids);
  const r2 = await send({ type: 'start', tabId: ids.d, minutes: 5, group: true, mode: 'leisure' });
  const rec = (await state()).timers[ids.d];
  t.check('leisure ignores group: it times just that one tab', r2.ok && rec?.groupId === undefined && rec?.mode === 'leisure', JSON.stringify(rec));
  await send({ type: 'cancel', tabId: ids.d });
  t.check('stopping early does not close the tab', (await sw.evaluate((x) => chrome.tabs.get(x).then(() => true, () => false), ids.d)) === true);
} catch (e) {
  t.fail(`unexpected error: ${e.message}`);
} finally {
  await close();
  t.done();
}
