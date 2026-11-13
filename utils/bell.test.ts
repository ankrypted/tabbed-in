import { describe, expect, it } from 'vitest';
import { bellLength, bellSchedule } from './bell';

describe('bellSchedule', () => {
  it('has three partials per strike', () => {
    expect(bellSchedule(1)).toHaveLength(3);
    expect(bellSchedule(3)).toHaveLength(9);
  });

  it('spaces strikes by the gap', () => {
    const starts = [...new Set(bellSchedule(3, 1.5).map((n) => n.start))];
    expect(starts).toEqual([0, 1.5, 3]);
  });

  it('keeps every note audible and finite', () => {
    for (const n of bellSchedule()) {
      expect(n.freq).toBeGreaterThan(100);
      expect(n.freq).toBeLessThan(10_000);
      expect(n.gain).toBeGreaterThan(0);
      expect(n.gain).toBeLessThanOrEqual(1);
      expect(n.duration).toBeGreaterThan(0);
    }
  });

  it('gives no notes for zero strikes', () => {
    expect(bellSchedule(0)).toEqual([]);
    expect(bellLength([])).toBe(0);
  });
});

describe('bellLength', () => {
  it('ends when the last note has faded out', () => {
    const notes = bellSchedule(3, 1.2);
    // last strike starts at 2.4 s; its longest partial rings for 2.2 s
    expect(bellLength(notes)).toBeCloseTo(4.6, 5);
  });
});
