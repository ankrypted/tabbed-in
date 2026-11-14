// Leisure mode: the page gets progressively hazier over the last few seconds.
// Pure so it can be unit tested; the widget applies the number.

/** How long before the end the blur starts. */
export const BLUR_WINDOW_MS = 15_000;
/** Blur radius reached at time zero, in CSS pixels. */
export const MAX_BLUR_PX = 20;

/**
 * Blur radius for `remainingMs` left: 0 until the window starts, then rising
 * evenly to `maxPx` at zero (and staying there if the clock overshoots).
 * Anything that isn't a number gives 0, never a stuck blur.
 */
export function blurAmount(
  remainingMs: number,
  windowMs = BLUR_WINDOW_MS,
  maxPx = MAX_BLUR_PX,
): number {
  if (!Number.isFinite(remainingMs) || remainingMs >= windowMs) return 0;
  const progress = 1 - Math.max(0, remainingMs) / windowMs; // 0..1
  return Math.round(progress * maxPx * 10) / 10;
}
