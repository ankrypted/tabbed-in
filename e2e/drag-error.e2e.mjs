// Regression test for the "user may be dragging a tab" bug: Chrome fires
// onActivated on mouse-DOWN and rejects tabs.update until the click ends. The
// real error is simulated by making tabs.update throw it. The lock must retry
// and must never release itself because of it.
import { launch, reporter, sleep } from './helpers.mjs';

const t = reporter('lock: survives "user may be dragging a tab" errors');
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

  const info = () =>
    sw.evaluate(async () => {
      const [a] = await chrome.tabs.query({ url: 'https://example.com/*' });
      const [b] = await chrome.tabs.query({ url: 'https://example.org/*' });
      const [active] = await chrome.tabs.query({ active: true, windowId: a.windowId });
      const { timers } = await chrome.storage.session.get('timers');
      return { aId: a.id, bId: b.id, activeId: active.id, timers: timers ?? {} };
    });
  const send = (msg) => popup.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  // Make tabs.update fail the way Chrome does during a tab click, for the next n calls.
  const failUpdates = (n) =>
    sw.evaluate((n) => {
      globalThis.__real ??= chrome.tabs.update.bind(chrome.tabs);
      globalThis.__fails = n;
      chrome.tabs.update = (...a) =>
        globalThis.__fails-- > 0
          ? Promise.reject(new Error('Tabs cannot be edited right now (user may be dragging a tab).'))
          : globalThis.__real(...a);
    }, n);

  const { aId } = await info();
  const r = await send({ type: 'start', tabId: aId, minutes: 5 });
  t.check('start on A', r.ok === true);
  await sleep(500);

  // 1. A few "mouse is down" failures, then it works: the lock must still hold.
  await failUpdates(4);
  await B.bringToFront();
  await sleep(2500);
  let s = await info();
  t.check('lock holds after 4 "dragging a tab" errors (retried)', s.activeId === aId);
  t.check('lock was NOT released by those errors', s.timers[aId]?.lockOff !== true, JSON.stringify(s.timers[aId]));

  // 2. Updates keep failing for a long time: the lock must stay engaged.
  await failUpdates(1000);
  await B.bringToFront();
  await sleep(5500);
  s = await info();
  t.check('lock stays engaged when reverts keep failing (no self-release)', !!s.timers[aId] && s.timers[aId].lockOff !== true);
  await failUpdates(0);

  // 3. The user stops the timer WHILE a revert is retrying: must not be pulled back.
  await A.bringToFront();
  await sleep(600);
  await failUpdates(1000);
  await B.bringToFront();
  await sleep(500);
  await send({ type: 'cancel', tabId: aId });
  await failUpdates(0);
  await sleep(1800);
  s = await info();
  t.check('stopping the timer mid-retry does not pull the user back', s.activeId === s.bId && Object.keys(s.timers).length === 0);
} catch (e) {
  t.fail(`unexpected error: ${e.message}`);
} finally {
  await close();
  t.done();
}
