import { playBell } from '../../utils/bell';

// The background sends { target: 'offscreen', type: 'play-bell' }.
browser.runtime.onMessage.addListener((msg: { target?: string; type?: string }) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'play-bell') return;
  void ring();
});

async function ring() {
  let state = 'error';
  try {
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    state = ctx.state;
    const seconds = playBell(ctx);
    setTimeout(() => void ctx.close(), seconds * 1000 + 500);
  } catch (err) {
    console.error('[tabbed-in] could not play the bell', err);
  }
  // Offscreen pages can only use chrome.runtime (no storage), so report back
  // by message; the background records it so it's possible to tell whether the
  // bell was attempted.
  try {
    await browser.runtime.sendMessage({ type: 'bell-played', state });
  } catch {}
}
