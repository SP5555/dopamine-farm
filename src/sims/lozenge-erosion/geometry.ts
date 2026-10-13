/** Screen edge of one lattice step. The three axes meet at 60°, so each tile is a true lozenge. */
export const HEX_COS = Math.sqrt(3) / 2;

/** A removal turns the three lozenges of one small hexagon by this much. */
export const FLIP_ANGLE = Math.PI / 3;

export interface Layout {
  originX: number;
  originY: number;
  edge: number;
}

/** Lattice point `(i, j, k)` in the view along `(1, 1, 1)`. `k` is up on screen. */
export function project(
  i: number,
  j: number,
  k: number,
  originX = 0,
  originY = 0,
  edge = 1,
): [number, number] {
  return [
    originX + (i - j) * edge * HEX_COS,
    originY + (i + j) * edge * 0.5 - k * edge,
  ];
}

/** Positive angles follow the screen y axis, which matches the lozenge flip. */
export function rotateScreen(
  x: number,
  y: number,
  cx: number,
  cy: number,
  angle: number,
): [number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/**
 * The six corners of the hexagon, in boundary order.
 * `(0,0,0)` and `(a,b,c)` project inside it.
 */
export function hexagonLattice(a: number, b: number, c: number): Array<[number, number, number]> {
  return [
    [a, 0, 0],
    [a, b, 0],
    [0, b, 0],
    [0, b, c],
    [0, 0, c],
    [a, 0, c],
  ];
}

const PAD = 0.08;

/** Fit the box's projected silhouette in the viewport. */
export function fitLayout(a: number, b: number, c: number, width: number, height: number): Layout {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const corners: Array<[number, number, number]> = [
    [0, 0, 0],
    [a, 0, 0],
    [0, b, 0],
    [0, 0, c],
    [a, b, 0],
    [a, 0, c],
    [0, b, c],
    [a, b, c],
  ];
  for (const [i, j, k] of corners) {
    const [x, y] = project(i, j, k);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const availW = Math.max(1, width * (1 - PAD * 2));
  const availH = Math.max(1, height * (1 - PAD * 2));
  const edge = Math.min(availW / spanX, availH / spanY);
  return {
    originX: width / 2 - ((minX + maxX) / 2) * edge,
    originY: height / 2 - ((minY + maxY) / 2) * edge,
    edge,
  };
}
