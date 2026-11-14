import { describe, expect, it } from 'vitest';
import { BLUR_WINDOW_MS, MAX_BLUR_PX, blurAmount } from './blur';

describe('blurAmount', () => {
  it('is 0 before the last 15 seconds', () => {
    expect(blurAmount(60_000)).toBe(0);
    expect(blurAmount(BLUR_WINDOW_MS)).toBe(0);
    expect(blurAmount(BLUR_WINDOW_MS + 1)).toBe(0);
  });

  it('starts just after 15 s, reaches the maximum at zero', () => {
    expect(blurAmount(BLUR_WINDOW_MS - 1)).toBeGreaterThanOrEqual(0);
    expect(blurAmount(BLUR_WINDOW_MS - 1)).toBeLessThan(0.1);
    expect(blurAmount(0)).toBe(MAX_BLUR_PX);
  });

  it('is halfway at 7.5 s and never decreases as time runs out', () => {
    expect(blurAmount(BLUR_WINDOW_MS / 2)).toBe(MAX_BLUR_PX / 2);
    let prev = -1;
    for (let ms = BLUR_WINDOW_MS; ms >= 0; ms -= 250) {
      const b = blurAmount(ms);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it('stays at the maximum if the clock overshoots zero', () => {
    expect(blurAmount(-5_000)).toBe(MAX_BLUR_PX);
  });

  it('never gives a stuck blur for garbage input', () => {
    expect(blurAmount(NaN)).toBe(0);
    expect(blurAmount(Infinity)).toBe(0);
    expect(blurAmount(undefined as unknown as number)).toBe(0);
  });
});
