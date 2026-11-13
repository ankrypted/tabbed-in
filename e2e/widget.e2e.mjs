// On-page widget: appears, drags, clamps to the viewport, remembers its
// position across a reload, and removes itself when the timer stops.
import { launch, reporter, sleep } from './helpers.mjs';

const t = reporter('widget: show, drag, persist, remove');
const { ctx, sw, id, close } = await launch({ grantHosts: true });

const box = async (page) => {
  const b = await page.locator('tabbed-in-widget .widget').boundingBox();
  return b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
};
const drag = async (page, from, to, steps = 10) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
};

try {
  const site = await ctx.newPage();
  const siteErrors = [];
  site.on('console', (m) => ['error', 'warning'].includes(m.type()) && siteErrors.push(`${m.type()}: ${m.text()}`));
  await site.goto('https://example.com');
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://example.com/*' }))[0].id);

  // The popup page is only used to send the same message the real popup sends.
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'start', tabId, minutes: 5 }), tabId);
  await site.bringToFront();

  await site.locator('tabbed-in-widget .widget').waitFor({ timeout: 8000 });
  t.check('widget appears on the page', true);
  t.check('shows the countdown', /^[45]:\d\d$/.test((await site.locator('tabbed-in-widget .time').textContent()) ?? ''));
  const start = await box(site);
  t.check('default position is the top-right corner', start.x > 800 && start.y < 40, JSON.stringify(start));

  const c = { x: start.x + start.w / 2, y: start.y + start.h / 2 };
  await drag(site, c, { x: c.x - 600, y: c.y + 400 }, 12);
  const dragged = await box(site);
  t.check('dragging moves it', Math.abs(dragged.x - (start.x - 600)) <= 2 && Math.abs(dragged.y - (start.y + 400)) <= 2, JSON.stringify(dragged));

  await drag(site, { x: dragged.x + 5, y: dragged.y + 5 }, { x: 5000, y: 5000 }, 8);
  const clamped = await box(site);
  t.check('dragging far off-screen keeps it fully visible',
    clamped.x >= 0 && clamped.y >= 0 && clamped.x + clamped.w <= 1000 && clamped.y + clamped.h <= 700, JSON.stringify(clamped));

  await drag(site, { x: clamped.x + 5, y: clamped.y + 5 }, { x: 200, y: 150 }, 8);
  const before = await box(site);
  await site.reload();
  await site.locator('tabbed-in-widget .widget').waitFor({ timeout: 8000 });
  const after = await box(site);
  t.check('position is remembered across a reload', before.x === after.x && before.y === after.y, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

  await popup.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'cancel', tabId }), tabId);
  await sleep(1200);
  t.check('widget is removed when the timer stops', (await site.locator('tabbed-in-widget').count()) === 0);
  t.check('no console errors/warnings on the page', siteErrors.length === 0, JSON.stringify(siteErrors));
} catch (e) {
  t.fail(`unexpected error: ${e.message}`);
} finally {
  await close();
  t.done();
}
