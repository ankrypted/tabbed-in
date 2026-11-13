import { describe, expect, it } from 'vitest';
import { formatRemaining } from './time';

describe('formatRemaining', () => {
  it('formats under a minute', () => {
    expect(formatRemaining(9_000)).toBe('0:09');
  });

  it('formats minutes and seconds', () => {
    expect(formatRemaining(15 * 60_000)).toBe('15:00');
    expect(formatRemaining(61_000)).toBe('1:01');
  });

  it('switches to h:mm:ss from one hour', () => {
    expect(formatRemaining(3_600_000)).toBe('1:00:00');
    expect(formatRemaining(3_725_000)).toBe('1:02:05');
  });

  it('never shows a negative time', () => {
    expect(formatRemaining(-5_000)).toBe('0:00');
  });

  it('rounds to the nearest second', () => {
    expect(formatRemaining(1_499)).toBe('0:01');
    expect(formatRemaining(1_500)).toBe('0:02');
  });
});
