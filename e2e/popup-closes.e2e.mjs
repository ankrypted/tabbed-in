// The browser closes the toolbar popup the moment it shows the site-access
// dialog. Start must already have reached the background by then. The popup is
// destroyed right when it requests access; the timer and the lock must survive.
// Uses the real manifest (site access NOT pre-granted).
import { launch, reporter, sleep } from './helpers.mjs';

const t = reporter('popup: Start survives the popup closing at the site-access request');
const { ctx, sw, id, close } = await launch({ grantHosts: false });

try {
  const A = await ctx.newPage();
  await A.goto('https://example.com');
  const B = await ctx.newPage();
  await B.goto('https://example.org');

  const state = () =>
    sw.evaluate(async () => {
      const [a] = await chrome.tabs.query({ url: 'https://example.com/*' });
      const [active] = await chrome.tabs.query({ active: true, windowId: a.windowId });
      const { timers } = await chrome.storage.session.get('timers');
      return { aId: a.id, activeId: active.id, timers: timers ?? {} };
    });
  const aId = (await state()).aId;

  // Open the popup page with patches in place BEFORE its script runs: it
  // targets tab A (as the real popup would), and closes itself right after
  // asking for site access.
  const popup = await ctx.newPage();
  await popup.addInitScript((aId) => {
    const q = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (info) => (info?.active ? [await chrome.tabs.get(aId)] : q(info));
    const req = chrome.permissions.request.bind(chrome.permissions);
    chrome.permissions.request = (...args) => {
      const p = req(...args);
      setTimeout(() => window.close(), 0);
      return p;
    };
  }, aId);
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForTimeout(800);
  await A.bringToFront();
  await sleep(300);

  await popup.locator('[data-m="5"]').click({ force: true }).catch(() => {});
  await sleep(2500);

  const s1 = await state();
  t.check('popup closed itself at the access request', popup.isClosed());
  t.check('timer exists even though the popup vanished', Object.keys(s1.timers).length > 0, JSON.stringify(s1.timers));

  await B.bringToFront();
  await sleep(1500);
  const s2 = await state();
  t.check('lock holds (stayed on A)', s2.activeId === s2.aId);
} catch (e) {
  t.fail(`unexpected error: ${e.message}`);
} finally {
  await close();
  t.done();
}
