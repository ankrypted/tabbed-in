// Popup + groups, through the real popup UI (not by sending messages directly).
// The toolbar popup acts on the ACTIVE tab; a popup opened as a normal tab has
// itself as the active tab, so only that one lookup is pointed at a group tab.
import { launch, reporter, sleep } from './helpers.mjs';

const t = reporter('popup-group: Start from the popup on a tab in a group');
const { ctx, sw, id, close } = await launch({ grantHosts: true });
try {
  const A = await ctx.newPage();
  await A.goto('https://example.com');
  const B = await ctx.newPage();
  await B.goto('https://example.org');
  const O = await ctx.newPage();
  await O.goto('https://example.net');

  const ids = await sw.evaluate(async () => {
    const f = async (u) => (await chrome.tabs.query({ url: u }))[0].id;
    return { a: await f('https://example.com/*'), b: await f('https://example.org/*'), o: await f('https://example.net/*') };
  });
  const groupId = await sw.evaluate((x) => chrome.tabs.group({ tabIds: [x.a, x.b] }), ids);
  await A.bringToFront();
  await sleep(500);

  const openPopup = async () => {
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.addInitScript((tabId) => {
      const orig = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (q) =>
        q && q.active && q.currentWindow ? chrome.tabs.get(tabId).then((tab) => [tab]) : orig(q);
    }, ids.a);
    await p.goto(`chrome-extension://${id}/popup.html`);
    await sleep(1200);
    p.errors = errors;
    return p;
  };

  const popup = await openPopup();
  t.check('the "whole tab group" option is shown for a tab in a group', await popup.locator('#groupopt').isVisible());
  t.check('...and ticked by default', await popup.locator('#group').isChecked());
  const label = await popup.locator('#grouptext').textContent();
  t.check('...naming the tab count', /2 tabs/.test(label ?? ''), JSON.stringify(label));

  await popup.locator('[data-m="5"]').click();
  await sleep(2500);
  const { timers } = await sw.evaluate(() => chrome.storage.session.get('timers'));
  const rec = timers?.[ids.a];
  t.check('clicking 5m stores a GROUP timer', rec?.groupId === groupId, JSON.stringify(timers));
  t.check('popup shows the running view with the group lock text',
    (await popup.locator('#running').isVisible()) && /tab group/.test((await popup.locator('#lockinfo').textContent()) ?? ''));
  t.check('no popup errors', popup.errors.length === 0, JSON.stringify(popup.errors));

  // The other group tab got the widget; moving to it works; leaving the group does not.
  t.check('widget on the other group tab',
    await B.locator('tabbed-in-widget .widget').waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  await B.bringToFront();
  await sleep(1200);
  let active = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  t.check('switching to the other group tab sticks', active === ids.b);
  await O.bringToFront();
  await sleep(1500);
  active = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  t.check('switching outside the group is reverted', active === ids.b || active === ids.a);

  // Popup opened from the OTHER group tab shows the running timer, and can stop it.
  const popup2 = await ctx.newPage();
  await popup2.addInitScript((tabId) => {
    const orig = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (q) =>
      q && q.active && q.currentWindow ? chrome.tabs.get(tabId).then((tab) => [tab]) : orig(q);
  }, ids.b);
  await popup2.goto(`chrome-extension://${id}/popup.html`);
  await sleep(1200);
  t.check('popup on the other group tab shows the running timer', await popup2.locator('#running').isVisible());
  await popup2.locator('#phrase').fill('I am done');
  await sleep(1500);
  const after = await sw.evaluate(() => chrome.storage.session.get('timers'));
  t.check('typing "I am done" there stops the group timer', Object.keys(after.timers ?? {}).length === 0, JSON.stringify(after));
} catch (e) {
  t.fail(`unexpected error: ${e.message}`);
} finally {
  await close();
  t.done();
}
