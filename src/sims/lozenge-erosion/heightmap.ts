import type { Rng } from '../../harness/rng';

/**
 * A plane partition in an `a × b × c` box.
 * `heights[i * b + j]` is the stack at column `(i, j)`, between 0 and `c`.
 * Heights fall away from the back corner `(0, 0)`. The viewer's front corner is `(a - 1, b - 1)`.
 *
 * The tiling is the boundary between solid and air, seen along `(1, 1, 1)`.
 * Cells with a negative coordinate are solid (the floor and the two back walls).
 * Cells past `a`, `b`, or `c` are empty. Every state then has `ab + bc + ca` lozenges.
 */

export type Orient = 'ab' | 'bc' | 'ca';

export const ORDERS = ['random', 'nearest', 'layers', 'diagonal'] as const;
export type Order = (typeof ORDERS)[number];

export function isOrder(value: string): value is Order {
  return (ORDERS as readonly string[]).includes(value);
}

export function fullHeights(a: number, b: number, c: number): Uint8Array {
  const heights = new Uint8Array(a * b);
  heights.fill(c);
  return heights;
}

/** True when `(i, j, k)` holds a cube. The rock behind the corner counts as solid. */
export function occupied(
  heights: Uint8Array,
  a: number,
  b: number,
  c: number,
  i: number,
  j: number,
  k: number,
): boolean {
  if (i < 0 || j < 0 || k < 0) return true;
  if (i >= a || j >= b || k >= c) return false;
  return k < heights[i * b + j]!;
}

export function isMonotone(heights: Uint8Array, a: number, b: number, c: number): boolean {
  for (let i = 0; i < a; i += 1) {
    for (let j = 0; j < b; j += 1) {
      const height = heights[i * b + j]!;
      if (height > c) return false;
      if (i + 1 < a && height < heights[(i + 1) * b + j]!) return false;
      if (j + 1 < b && height < heights[i * b + j + 1]!) return false;
    }
  }
  return true;
}

/** The top cube of `(i, j)` can leave without breaking the plane partition. */
export function isRemovable(heights: Uint8Array, a: number, b: number, i: number, j: number): boolean {
  const height = heights[i * b + j]!;
  if (height === 0) return false;
  const nextI = i + 1 < a ? heights[(i + 1) * b + j]! : 0;
  const nextJ = j + 1 < b ? heights[i * b + j + 1]! : 0;
  return nextI < height && nextJ < height;
}

/** Packs removable columns as `i * b + j`. Returns the count. */
export function collectRemovable(heights: Uint8Array, a: number, b: number, into: number[]): number {
  into.length = 0;
  for (let i = 0; i < a; i += 1) {
    for (let j = 0; j < b; j += 1) {
      if (isRemovable(heights, a, b, i, j)) into.push(i * b + j);
    }
  }
  return into.length;
}

/** A column can gain a cube without breaking the plane partition. */
export function isAddable(heights: Uint8Array, b: number, c: number, i: number, j: number): boolean {
  const height = heights[i * b + j]!;
  if (height >= c) return false;
  if (i > 0 && heights[(i - 1) * b + j]! <= height) return false;
  if (j > 0 && heights[i * b + (j - 1)]! <= height) return false;
  return true;
}

/** Packs columns that can gain a cube as `i * b + j`. Returns the count. */
export function collectAddable(heights: Uint8Array, a: number, b: number, c: number, into: number[]): number {
  into.length = 0;
  for (let i = 0; i < a; i += 1) {
    for (let j = 0; j < b; j += 1) {
      if (isAddable(heights, b, c, i, j)) into.push(i * b + j);
    }
  }
  return into.length;
}

/**
 * One packed column from `list`, or -1 when the list is empty.
 * The list may be the cubes that can leave or the ones that can return.
 * Nearest, layers, and diagonal ignore `rng`. Random draws one entry uniformly.
 * Ties break toward the front corner, then larger `i`, then larger `j`.
 */
export function chooseRemoval(
  order: Order,
  heights: Uint8Array,
  a: number,
  b: number,
  list: number[],
  count: number,
  rng: Rng,
): number {
  if (count <= 0) return -1;
  if (order === 'random') return list[rng.int(count)]!;
  let best = list[0]!;
  let bestRank = removalRank(order, best, heights, a, b);
  for (let index = 1; index < count; index += 1) {
    const packed = list[index]!;
    const rank = removalRank(order, packed, heights, a, b);
    if (rank < bestRank) {
      best = packed;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Visits each lozenge once.
 * `ab` is the horizontal face at the top of a column (the floor when the column is empty).
 * `bc` is a face of constant `i`. `ca` is a face of constant `j`.
 */
export function visitFaces(
  heights: Uint8Array,
  a: number,
  b: number,
  c: number,
  visit: (orient: Orient, i: number, j: number, k: number) => void,
): void {
  for (let i = 0; i < a; i += 1) {
    const row = i * b;
    for (let j = 0; j < b; j += 1) visit('ab', i, j, heights[row + j]!);
  }
  for (let j = 0; j < b; j += 1) {
    for (let k = 0; k < c; k += 1) {
      let i = 0;
      while (i < a && k < heights[i * b + j]!) i += 1;
      visit('bc', i, j, k);
    }
  }
  for (let i = 0; i < a; i += 1) {
    const row = i * b;
    for (let k = 0; k < c; k += 1) {
      let j = 0;
      while (j < b && k < heights[row + j]!) j += 1;
      visit('ca', i, j, k);
    }
  }
}

/** The four lattice corners of one lozenge, from its minimal corner `(i, j, k)`. */
export function faceCorners(orient: Orient, i: number, j: number, k: number): Array<[number, number, number]> {
  if (orient === 'ab') {
    return [
      [i, j, k],
      [i + 1, j, k],
      [i + 1, j + 1, k],
      [i, j + 1, k],
    ];
  }
  if (orient === 'bc') {
    return [
      [i, j, k],
      [i, j + 1, k],
      [i, j + 1, k + 1],
      [i, j, k + 1],
    ];
  }
  return [
    [i, j, k],
    [i + 1, j, k],
    [i + 1, j, k + 1],
    [i, j, k + 1],
  ];
}

/**
 * Smaller is sooner.
 * `di` and `dj` are steps back from the front corner, so 0 is the corner itself.
 */
function removalRank(order: Order, packed: number, heights: Uint8Array, a: number, b: number): number {
  const i = Math.floor(packed / b);
  const j = packed - i * b;
  const di = a - 1 - i;
  const dj = b - 1 - j;
  if (order === 'diagonal') return (di + dj) * 32 + di;
  const front = (di * di + dj * dj) * 1024 + di * 32 + dj;
  if (order === 'layers') return (255 - heights[packed]!) * 2_000_000 + front;
  return front;
}
