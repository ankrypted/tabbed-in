import { describe, expect, it } from 'vitest';
import { clampPosition, defaultPosition, isPos } from './position';

const box = { width: 100, height: 50 };
const viewport = { width: 1000, height: 600 };

describe('clampPosition', () => {
  it('leaves an in-bounds position alone', () => {
    expect(clampPosition({ x: 200, y: 300 }, box, viewport)).toEqual({ x: 200, y: 300 });
  });

  it('clamps past the left/top edges to 0', () => {
    expect(clampPosition({ x: -40, y: -9 }, box, viewport)).toEqual({ x: 0, y: 0 });
  });

  it('clamps past the right/bottom edges so the box stays fully visible', () => {
    expect(clampPosition({ x: 5000, y: 5000 }, box, viewport)).toEqual({ x: 900, y: 550 });
  });

  it('never goes negative when the viewport is smaller than the box', () => {
    expect(clampPosition({ x: 10, y: 10 }, box, { width: 60, height: 20 })).toEqual({ x: 0, y: 0 });
  });
});

describe('defaultPosition', () => {
  it('sits in the top-right with a margin', () => {
    expect(defaultPosition(box, viewport)).toEqual({ x: 884, y: 16 });
  });

  it('stays on screen in a tiny viewport', () => {
    expect(defaultPosition(box, { width: 80, height: 40 })).toEqual({ x: 0, y: 0 });
  });
});

describe('isPos', () => {
  it('accepts finite coordinates', () => {
    expect(isPos({ x: 1, y: 2 })).toBe(true);
  });

  it.each([null, undefined, 5, 'x', {}, { x: 1 }, { x: NaN, y: 1 }, { x: 1, y: Infinity }])(
    'rejects %j',
    (v) => expect(isPos(v)).toBe(false),
  );
});
