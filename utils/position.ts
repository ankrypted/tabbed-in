export type Pos = { x: number; y: number };
export type Size = { width: number; height: number };

/** Keep a box of `box` size fully inside a viewport of `viewport` size. */
export function clampPosition(pos: Pos, box: Size, viewport: Size): Pos {
  const maxX = Math.max(0, viewport.width - box.width);
  const maxY = Math.max(0, viewport.height - box.height);
  return {
    x: Math.min(Math.max(0, pos.x), maxX),
    y: Math.min(Math.max(0, pos.y), maxY),
  };
}

/** Default spot: top-right corner with a margin. */
export function defaultPosition(box: Size, viewport: Size, margin = 16): Pos {
  return clampPosition(
    { x: viewport.width - box.width - margin, y: margin },
    box,
    viewport,
  );
}

/** True if `value` looks like a saved position we can trust. */
export function isPos(value: unknown): value is Pos {
  const v = value as Pos | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y)
  );
}
