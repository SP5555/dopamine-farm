import { describe, expect, it } from 'vitest';
import { createRng } from '../../harness/rng';
import { FLIP_ANGLE, project, rotateScreen } from './geometry';
import {
  chooseRemoval,
  collectAddable,
  collectRemovable,
  faceCorners,
  fullHeights,
  isMonotone,
  isRemovable,
  occupied,
  visitFaces,
  type Order,
  type Orient,
} from './heightmap';
import { faceSlide, slideProgress, slideWindows, slidDepth } from './render';

/** A +60° turn of the whole cube carries each orientation onto this one. */
const SPIN_LANDS: Record<Orient, Orient> = { ab: 'ca', bc: 'ab', ca: 'bc' };
/** A −60° turn is that cycle the other way, which also lands on the full cube. */
const SPIN_BACK: Record<Orient, Orient> = { ab: 'bc', bc: 'ca', ca: 'ab' };

describe('lozenge erosion', () => {
  it('empties every box in exactly a·b·c removals', () => {
    const sizes: Array<[number, number, number]> = [
      [1, 1, 1],
      [1, 5, 3],
      [5, 1, 4],
      [3, 2, 2],
      [4, 3, 2],
      [6, 6, 6],
    ];
    for (const order of ['random', 'depth'] as const) {
      for (const [a, b, c] of sizes) {
        if (order !== 'random' && a * b * c > 80) continue;
        const sequence = erode(a, b, c, order, 7, true);
        expect(sequence).toHaveLength(a * b * c);
      }
    }
  });

  it('keeps ab, bc, and ca lozenges, and matches the solid/air boundary', () => {
    for (const [a, b, c] of [
      [1, 1, 1],
      [1, 5, 3],
      [2, 3, 4],
      [4, 1, 2],
    ] as const) {
      erode(a, b, c, 'random', 3, true);
    }
  });

  it('rotates the empty tiling onto the full tiling', () => {
    for (const [a, b, c] of [
      [1, 1, 1],
      [1, 5, 3],
      [2, 3, 4],
      [3, 1, 2],
      [5, 4, 2],
    ] as const) {
      const full = keysOf(fullHeights(a, b, c), a, b, c);
      const empty = keysOf(new Uint8Array(a * b), a, b, c);
      expect(full).not.toEqual(empty);
      expect(full.map((key) => rotateKey(key, a, b, c)).sort()).toEqual(empty);
    }
  });

  it('turns the three cube lozenges onto the hole', () => {
    for (const cube of [
      { i: 0, j: 0, k: 0 },
      { i: 2, j: 1, k: 3 },
      { i: 4, j: 4, k: 1 },
    ]) {
      const { i, j, k } = cube;
      const [cx, cy] = project(i, j, k);
      const [ox, oy] = project(i + 1, j + 1, k + 1);
      expect(Math.hypot(cx - ox, cy - oy)).toBeLessThan(1e-9);

      const before = [
        screenPoly('ab', i, j, k + 1),
        screenPoly('bc', i + 1, j, k),
        screenPoly('ca', i, j + 1, k),
      ];
      const after = [screenPoly('ab', i, j, k), screenPoly('bc', i, j, k), screenPoly('ca', i, j, k)];
      const turned = before.map((poly) => poly.map(([x, y]) => rotateScreen(x, y, cx, cy, FLIP_ANGLE)));
      for (const poly of turned) {
        expect(after.some((target) => samePoly(poly, target))).toBe(true);
      }
    }
  });

  it('swaps exactly those three lozenges when a cube leaves', () => {
    const a = 2;
    const b = 2;
    const c = 2;
    const heights = fullHeights(a, b, c);
    const before = new Set(keysOf(heights, a, b, c));
    const sticking = [keyFor('ab', 1, 1, 2), keyFor('bc', 2, 1, 1), keyFor('ca', 1, 2, 1)];
    const hole = [keyFor('ab', 1, 1, 1), keyFor('bc', 1, 1, 1), keyFor('ca', 1, 1, 1)];
    for (const key of sticking) expect(before.has(key)).toBe(true);
    for (const key of hole) expect(before.has(key)).toBe(false);

    heights[1 * b + 1] = 1;
    const after = new Set(keysOf(heights, a, b, c));
    for (const key of sticking) expect(after.has(key)).toBe(false);
    for (const key of hole) expect(after.has(key)).toBe(true);
    for (const key of before) {
      if (sticking.includes(key)) continue;
      expect(after.has(key)).toBe(true);
    }
  });

  it('repeats a removal sequence for the same seed', () => {
    const first = erode(4, 3, 2, 'random', 11, false);
    const second = erode(4, 3, 2, 'random', 11, false);
    expect(second).toEqual(first);
    expect(erode(4, 3, 2, 'random', 12, false)).not.toEqual(first);

    const depth = erode(3, 3, 2, 'depth', 1, false);
    expect(erode(3, 3, 2, 'depth', 99, false)).toEqual(depth);
  });

  it('takes the highest cube on the closest plane', () => {
    const heights = Uint8Array.of(6, 5, 4, 5, 4, 3, 4, 3, 1);
    expect(isMonotone(heights, 3, 3, 6)).toBe(true);
    const list: number[] = [];
    const count = collectRemovable(heights, 3, 3, list);
    expect(chooseRemoval('depth', heights, 3, list, count, createRng(1))).toBe(0);
  });

  it('breaks a same-height tie toward the left', () => {
    const heights = fullHeights(2, 2, 1);
    heights[1 * 2 + 1] = 0;
    const list: number[] = [];
    const count = collectRemovable(heights, 2, 2, list);
    expect(count).toBe(2);
    expect(chooseRemoval('depth', heights, 2, list, count, createRng(1))).toBe(0 * 2 + 1);
  });

  it('adds the highest cube on the farthest plane', () => {
    const heights = Uint8Array.of(1, 0, 0, 0);
    const list: number[] = [];
    const count = collectAddable(heights, 2, 2, 3, list);
    expect(chooseRemoval('depth', heights, 2, list, count, createRng(1), false)).toBe(0);
  });

  it('starts at the front corner', () => {
    for (const order of ['random', 'depth'] as const) {
      const heights = fullHeights(4, 3, 2);
      const list: number[] = [];
      const count = collectRemovable(heights, 4, 3, list);
      expect(count).toBe(1);
      expect(isRemovable(heights, 4, 3, 3, 2)).toBe(true);
      expect(chooseRemoval(order, heights, 3, list, count, createRng(5))).toBe(3 * 3 + 2);
    }
  });

  it('picks the next removal or addition from the cubes on screen', () => {
    const heights = fullHeights(3, 3, 3);
    const list: number[] = [];
    const rng = createRng(4);
    for (let step = 0; step < 5; step += 1) {
      const count = collectRemovable(heights, 3, 3, list);
      const packed = chooseRemoval('random', heights, 3, list, count, rng);
      heights[packed] = heights[packed]! - 1;
      expect(isMonotone(heights, 3, 3, 3)).toBe(true);
    }
    const addCount = collectAddable(heights, 3, 3, 3, list);
    expect(addCount).toBeGreaterThan(0);
    const added = chooseRemoval('depth', heights, 3, list, addCount, rng, false);
    heights[added] = heights[added]! + 1;
    expect(isMonotone(heights, 3, 3, 3)).toBe(true);
  });

  it('slides each lozenge onto the parallel face, and the whole box the same way', () => {
    for (const cube of [
      { i: 0, j: 0, k: 0 },
      { i: 2, j: 1, k: 3 },
    ]) {
      const { i, j, k } = cube;
      const leaving = [
        ['ab', i, j, k + 1],
        ['bc', i + 1, j, k],
        ['ca', i, j + 1, k],
      ] as const;
      const hole = [
        ['ab', i, j, k],
        ['bc', i, j, k],
        ['ca', i, j, k],
      ] as const;
      for (let index = 0; index < leaving.length; index += 1) {
        const [orient, x, y, z] = leaving[index]!;
        const [di, dj, dk] = faceSlide(orient, true);
        const slid = screenPoly(orient, x + di, y + dj, z + dk);
        const [ho, hx, hy, hz] = hole[index]!;
        expect(samePoly(slid, screenPoly(ho, hx, hy, hz))).toBe(true);
      }
    }
    for (const n of [1, 4]) {
      const empty = new Map<string, Orient>();
      visitFaces(new Uint8Array(n * n), n, n, n, (orient, i, j, k) => {
        empty.set(screenPoly(orient, i, j, k).map(([x, y]) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`).sort().join('|'), orient);
      });
      visitFaces(fullHeights(n, n, n), n, n, n, (orient, i, j, k) => {
        const [di, dj, dk] = faceSlide(orient, true, n);
        const key = screenPoly(orient, i + di, j + dj, k + dk)
          .map(([x, y]) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`)
          .sort()
          .join('|');
        expect(empty.get(key)).toBe(orient);
      });
    }
  });

  it('puts a lozenge farther from the camera the more it has slid away', () => {
    expect(slidDepth('ab', 1, 2, 3, 0, true, 4)).toBe(6);
    expect(slidDepth('bc', 1, 2, 3, 1, true, 4)).toBe(2);
    expect(slidDepth('ca', 1, 2, 3, 1, false, 4)).toBe(10);
    expect(slidDepth('ab', 0, 0, 4, 0.5, true, 4)).toBeLessThan(slidDepth('bc', 4, 0, 0, 0, true, 4));
  });

  it('deals the three faces a random order of staggered windows', () => {
    const windows = slideWindows(['ca', 'ab', 'bc']);
    expect(windows.ca).toEqual({ start: 0, end: 0.6 });
    expect(windows.ab).toEqual({ start: 0.2, end: 0.8 });
    expect(windows.bc).toEqual({ start: 0.4, end: 1 });
    expect(slideProgress(0, windows.ca)).toBe(0);
    expect(slideProgress(0.3, windows.ca)).toBeCloseTo(0.5);
    expect(slideProgress(0.6, windows.ca)).toBe(1);
    expect(slideProgress(0.2, windows.ab)).toBe(0);
    expect(slideProgress(0.4, windows.bc)).toBe(0);
    expect(slideProgress(1, windows.bc)).toBe(1);
    const rng = createRng(7);
    const order: Orient[] = ['ab', 'bc', 'ca'];
    rng.shuffle(order);
    const dealt = slideWindows(order);
    expect([dealt.ab.start, dealt.bc.start, dealt.ca.start].sort()).toEqual([0, 0.2, 0.4]);
  });

  it('spins an empty cube 60° either way onto the full cube and cycles the face colors', () => {
    for (const n of [1, 4]) {
      const full = new Map<string, Orient>();
      visitFaces(fullHeights(n, n, n), n, n, n, (orient, i, j, k) => {
        full.set(screenKey(orient, i, j, k, 0, n), orient);
      });
      visitFaces(new Uint8Array(n * n), n, n, n, (orient, i, j, k) => {
        expect(full.get(screenKey(orient, i, j, k, FLIP_ANGLE, n))).toBe(SPIN_LANDS[orient]);
        expect(full.get(screenKey(orient, i, j, k, -FLIP_ANGLE, n))).toBe(SPIN_BACK[orient]);
      });
    }
  });
});

function erode(a: number, b: number, c: number, order: Order, seed: number, checkFaces: boolean): number[] {
  const heights = fullHeights(a, b, c);
  const rng = createRng(seed);
  const list: number[] = [];
  const sequence: number[] = [];
  const total = a * b * c;
  for (let step = 0; step < total; step += 1) {
    expect(isMonotone(heights, a, b, c)).toBe(true);
    if (checkFaces) expect(keysOf(heights, a, b, c)).toEqual(bruteKeys(heights, a, b, c));
    const count = collectRemovable(heights, a, b, list);
    expect(count).toBeGreaterThan(0);
    const packed = chooseRemoval(order, heights, b, list, count, rng);
    const i = Math.floor(packed / b);
    const j = packed % b;
    expect(isRemovable(heights, a, b, i, j)).toBe(true);
    sequence.push(packed);
    heights[packed] = heights[packed]! - 1;
  }
  expect(isMonotone(heights, a, b, c)).toBe(true);
  expect(collectRemovable(heights, a, b, list)).toBe(0);
  for (const value of heights) expect(value).toBe(0);
  if (checkFaces) {
    expect(keysOf(heights, a, b, c)).toEqual(bruteKeys(heights, a, b, c));
    expect(countOrients(heights, a, b, c)).toEqual({ ab: a * b, bc: b * c, ca: a * c });
  }
  return sequence;
}

function keysOf(heights: Uint8Array, a: number, b: number, c: number): string[] {
  const keys: string[] = [];
  visitFaces(heights, a, b, c, (orient, i, j, k) => {
    keys.push(keyFor(orient, i, j, k));
  });
  keys.sort();
  return keys;
}

function bruteKeys(heights: Uint8Array, a: number, b: number, c: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < a; i += 1) {
    for (let j = 0; j < b; j += 1) {
      for (let k = 0; k <= c; k += 1) {
        if (occupied(heights, a, b, c, i, j, k - 1) && !occupied(heights, a, b, c, i, j, k)) {
          keys.push(keyFor('ab', i, j, k));
        }
      }
    }
  }
  for (let i = 0; i <= a; i += 1) {
    for (let j = 0; j < b; j += 1) {
      for (let k = 0; k < c; k += 1) {
        if (occupied(heights, a, b, c, i - 1, j, k) && !occupied(heights, a, b, c, i, j, k)) {
          keys.push(keyFor('bc', i, j, k));
        }
      }
    }
  }
  for (let j = 0; j <= b; j += 1) {
    for (let i = 0; i < a; i += 1) {
      for (let k = 0; k < c; k += 1) {
        if (occupied(heights, a, b, c, i, j - 1, k) && !occupied(heights, a, b, c, i, j, k)) {
          keys.push(keyFor('ca', i, j, k));
        }
      }
    }
  }
  keys.sort();
  return keys;
}

function countOrients(heights: Uint8Array, a: number, b: number, c: number): Record<Orient, number> {
  const counts = { ab: 0, bc: 0, ca: 0 };
  visitFaces(heights, a, b, c, (orient) => {
    counts[orient] += 1;
  });
  return counts;
}

function keyFor(orient: Orient, i: number, j: number, k: number): string {
  const corners = faceCorners(orient, i, j, k)
    .map(([x, y, z]) => `${x},${y},${z}`)
    .sort()
    .join('/');
  return `${orient}:${corners}`;
}

function rotateKey(key: string, a: number, b: number, c: number): string {
  const split = key.indexOf(':');
  const orient = key.slice(0, split);
  const corners = key
    .slice(split + 1)
    .split('/')
    .map((part) => {
      const [x, y, z] = part.split(',').map(Number);
      return `${a - x!},${b - y!},${c - z!}`;
    })
    .sort()
    .join('/');
  return `${orient}:${corners}`;
}

function screenKey(orient: Orient, i: number, j: number, k: number, angle: number, n: number): string {
  const [cx, cy] = project(n / 2, n / 2, n / 2);
  return faceCorners(orient, i, j, k)
    .map(([x, y, z]) => {
      const [px, py] = project(x, y, z);
      const [rx, ry] = rotateScreen(px, py, cx, cy, angle);
      return `${Math.round(rx * 1e6)},${Math.round(ry * 1e6)}`;
    })
    .sort()
    .join('|');
}

function screenPoly(orient: Orient, i: number, j: number, k: number): Array<[number, number]> {
  return faceCorners(orient, i, j, k).map(([x, y, z]) => project(x, y, z));
}

function samePoly(left: Array<[number, number]>, right: Array<[number, number]>): boolean {
  return left.every((point) => right.some((other) => Math.hypot(point[0] - other[0], point[1] - other[1]) < 1e-6));
}
