// Inlined into the script so no web-accessible resource is needed.
import css from './style.css?inline';
import { clampPosition, defaultPosition, isPos, type Pos } from '../../utils/position';
import { formatRemaining } from '../../utils/time';
import { blurAmount } from '../../utils/blur';

const TAG = 'tabbed-in-widget';
const POS_KEY = 'widgetPos';

type TimerState = { end: number; mode?: 'focus' | 'leisure' } | null;
type Controller = { setEnd(end: number): void; flash(text: string): void };

/**
 * Floating timer shown on the timed page. Injected on demand by the background
 * script (registration: 'runtime') once the user has granted site access.
 * Step 1: show the countdown, drag anywhere, remember the position.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',

  async main(ctx) {
    if (window !== window.top) return; // top frame only
    if (document.querySelector(TAG)) return; // already injected

    const state: TimerState = await browser.runtime.sendMessage({ type: 'widget-state' });
    if (!state) return; // no timer on this tab

    const saved = (await browser.storage.local.get(POS_KEY))[POS_KEY];
    let controller: Controller | undefined;

    const ui = await createShadowRootUi(ctx, {
      name: TAG,
      position: 'inline',
      anchor: 'body',
      onMount: (container, shadow) => {
        const style = document.createElement('style');
        style.textContent = css;
        shadow.append(style);
        const mounted = mountWidget(
          ctx,
          container,
          state.end,
          state.mode === 'leisure',
          isPos(saved) ? saved : null,
        );
        controller = mounted.controller;
        return mounted.cleanup;
      },
      onRemove: (cleanup) => cleanup?.(),
    });
    ui.mount();

    // The background tells us when the timer changes or is removed.
    const onMessage = (msg: unknown) => {
      const m = msg as { type?: string; end?: number | null };
      if (m?.type === 'lock-blocked') {
        controller?.flash('Locked in. Stop the timer to switch tabs.');
      } else if (m?.type === 'lock-released') {
        controller?.flash('Tab lock released.');
      } else if (m?.type === 'timer-changed') {
        if (m.end == null) {
          browser.runtime.onMessage.removeListener(onMessage);
          ui.remove();
        } else {
          controller?.setEnd(m.end);
        }
      }
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onMessage));
  },
});

function mountWidget(
  ctx: { setInterval: (fn: () => void, ms: number) => number },
  container: HTMLElement,
  initialEnd: number,
  leisure: boolean,
  savedPos: Pos | null,
) {
  let end = initialEnd;
  let reportedEnd = false;

  const el = document.createElement('div');
  el.className = 'widget';
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = leisure ? 'Tabbed In · Leisure' : 'Tabbed In';
  const time = document.createElement('div');
  time.className = 'time';
  const note = document.createElement('div');
  note.className = 'note';
  el.append(label, time, note);

  // Leisure mode: a full-page haze over the last seconds. It sits under the timer
  // card (so the card stays readable) and never blocks clicks.
  const haze = document.createElement('div');
  haze.className = 'haze';
  container.append(haze, el);

  const tick = () => {
    const remaining = end - Date.now();
    const text = formatRemaining(remaining);
    if (time.textContent !== text) time.textContent = text;
    if (!leisure) return;
    const px = blurAmount(remaining);
    haze.style.display = px > 0 ? 'block' : 'none';
    if (px > 0) {
      haze.style.backdropFilter = `blur(${px}px)`;
      haze.style.background = `rgba(0, 0, 0, ${(px / 20) * 0.35})`;
    }
    if (remaining <= 0 && !reportedEnd) {
      // The background closes the tab (its alarm does the same; whichever is first).
      reportedEnd = true;
      browser.runtime.sendMessage({ type: 'time-up' }).catch(() => {});
    }
  };
  tick();
  // Fine steps in leisure mode so the blur ramps smoothly; once a second otherwise.
  ctx.setInterval(tick, leisure ? 100 : 1000);

  // --- position ---
  const box = () => ({ width: el.offsetWidth, height: el.offsetHeight });
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  let pos = savedPos ?? defaultPosition(box(), viewport());
  const place = (p: Pos) => {
    pos = clampPosition(p, box(), viewport());
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
  };
  place(pos);

  // Short message under the time (e.g. why a tab switch was undone).
  let noteTimer: number | undefined;
  const flash = (text: string) => {
    note.textContent = text;
    note.classList.add('show');
    place(pos); // the card grew: keep it fully on screen
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => {
      note.classList.remove('show');
      place(pos);
    }, 3500);
  };

  // --- drag ---
  let drag: { dx: number; dy: number } | null = null;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (drag) place({ x: e.clientX - drag.dx, y: e.clientY - drag.dy });
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    el.classList.remove('dragging');
    browser.storage.local.set({ [POS_KEY]: pos });
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  // Keep it on screen if the window shrinks.
  const onResize = () => place(pos);
  window.addEventListener('resize', onResize);

  return {
    controller: {
      setEnd(next: number) {
        end = next;
        reportedEnd = false;
        tick();
      },
      flash,
    } satisfies Controller,
    cleanup: () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(noteTimer);
    },
  };
}
