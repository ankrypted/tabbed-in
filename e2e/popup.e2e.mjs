// Popup: the Start button starts a timer and the popup shows the countdown.
// Uses the real manifest (site access NOT pre-granted).
import { launch, reporter, sleep } from './helpers.mjs';

const t = reporter('popup: Start button');
const { ctx, sw, id, close } = await launch({ grantHosts: false });
try {
  const site = await ctx.newPage();
  await site.goto('https://example.com');

  const popup = await ctx.newPage();
  const errors = [];
  popup.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  popup.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await sleep(1500);

  t.check('start form is shown before clicking', await popup.locator('#setup').isVisible());
  await popup.locator('[data-m="5"]').click();
  await sleep(2500);
  t.check('running view is shown after clicking 5m', await popup.locator('#running').isVisible());
  const remaining = await popup.locator('#remaining').textContent();
  t.check('countdown is about 5 minutes', /^[45]:\d\d left$/.test(remaining ?? ''), JSON.stringify(remaining));
  const { timers } = await sw.evaluate(() => chrome.storage.session.get('timers'));
  t.check('timer is stored (with window id)', Object.values(timers ?? {}).some((x) => x.end && x.windowId), JSON.stringify(timers));
  t.check('no popup errors', errors.length === 0, JSON.stringify(errors));
} catch (e) {
  t.fail(`unexpected error: ${e.message}`);
} finally {
  await close();
  t.done();
}
