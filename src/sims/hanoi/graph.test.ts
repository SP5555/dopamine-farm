import { describe, expect, it } from 'vitest';
import { legalEdges, legalMoves, moveDisk, pegOf, pointOf, regionOf, shortestMoves, solved, solvedPeg, stateCount, type Point } from './graph';

const corners = [
  { x: 0, y: 100 },
  { x: 100, y: 100 },
  { x: 50, y: 0 },
] as const;

describe('hanoi graph', () => {
  it('puts each solved tower on its own corner', () => {
    for (const disks of [1, 2, 4, 6]) {
      for (let peg = 0; peg < 3; peg += 1) {
        expect(pointOf(solved(disks, peg), disks, corners)).toEqual(corners[peg]);
      }
    }
  });

  it('walks the classic seven moves between two solved towers of three', () => {
    const moves = shortestMoves(solved(3, 0), solved(3, 1), 3);
    expect(moves).toHaveLength(7);
    let state = solved(3, 0);
    for (const move of moves) {
      expect(legalMoves(state, 3).some((item) => item.disk === move.disk && item.to === move.to)).toBe(true);
      state = moveDisk(state, move.disk, move.to);
    }
    expect(state).toBe(solved(3, 1));
  });

  it('gives a solved tower two moves and every other arrangement three', () => {
    for (const disks of [1, 2, 3, 4]) {
      for (let state = 0; state < stateCount(disks); state += 1) {
        expect(legalMoves(state, disks)).toHaveLength(solvedPeg(state, disks) < 0 ? 3 : 2);
      }
    }
  });

  it('draws moves that meet only at their own dots', () => {
    for (const disks of [2, 3, 4, 5]) {
      const count = stateCount(disks);
      const points = Array.from({ length: count }, (_, state) => pointOf(state, disks, corners));
      const edges = legalEdges(disks);
      for (let left = 0; left < edges.length; left += 1) {
        for (let right = left + 1; right < edges.length; right += 1) {
          const [a, b] = edges[left]!;
          const [c, d] = edges[right]!;
          if (a === c || a === d || b === c || b === d) continue;
          expect(segmentsCross(points[a]!, points[b]!, points[c]!, points[d]!)).toBe(false);
        }
      }
    }
  });

  it('walks from one solved tower to another along the outer edge', () => {
    for (const disks of [2, 3, 4, 5]) {
      let state = solved(disks, 0);
      expect(segmentDistance(pointOf(state, disks, corners), corners[0], corners[1])).toBeLessThan(1e-4);
      for (const move of shortestMoves(solved(disks, 0), solved(disks, 1), disks)) {
        state = moveDisk(state, move.disk, move.to);
        expect(segmentDistance(pointOf(state, disks, corners), corners[0], corners[1])).toBeLessThan(1e-4);
      }
      expect(state).toBe(solved(disks, 1));
    }
  });

  it('draws every move the same length', () => {
    const equilateral = [
      { x: 0, y: 50 * Math.sqrt(3) },
      { x: 100, y: 50 * Math.sqrt(3) },
      { x: 50, y: 0 },
    ] as const;
    for (const disks of [1, 2, 3, 4, 5]) {
      const points = Array.from({ length: stateCount(disks) }, (_, state) => pointOf(state, disks, equilateral));
      let length = -1;
      for (let state = 0; state < points.length; state += 1) {
        for (const move of legalMoves(state, disks)) {
          const next = moveDisk(state, move.disk, move.to);
          const span = distance(points[state]!, points[next]!);
          if (length < 0) length = span;
          expect(span).toBeCloseTo(length, 6);
        }
      }
      expect(length).toBeCloseTo(100 / (2 ** disks - 1), 6);
    }
  });

  it('gives every arrangement its own dot, and keeps other dots off a move', () => {
    const disks = 4;
    const count = stateCount(disks);
    const points = Array.from({ length: count }, (_, state) => pointOf(state, disks, corners));
    for (let state = 0; state < count; state += 1) {
      for (let other = state + 1; other < count; other += 1) {
        expect(distance(points[state]!, points[other]!)).toBeGreaterThan(0.5);
      }
    }
    for (let state = 0; state < count; state += 1) {
      for (const move of legalMoves(state, disks)) {
        const next = moveDisk(state, move.disk, move.to);
        const from = points[state]!;
        const to = points[next]!;
        for (let other = 0; other < count; other += 1) {
          if (other === state || other === next) continue;
          expect(segmentDistance(points[other]!, from, to)).toBeGreaterThan(0.4);
        }
      }
    }
  });

  it('matches a breadth-first search on every pair', () => {
    for (const disks of [1, 2, 3, 4]) {
      const count = stateCount(disks);
      const distance = bfsDistance(disks);
      for (let from = 0; from < count; from += 1) {
        for (let to = 0; to < count; to += 1) {
          const moves = shortestMoves(from, to, disks);
          const want = distance[from * count + to] ?? -1;
          expect(moves, `disks ${disks} from ${from} to ${to}`).toHaveLength(want);
          let state = from;
          for (const move of moves) {
            expect(legalMoves(state, disks).some((item) => item.disk === move.disk && item.to === move.to)).toBe(true);
            state = moveDisk(state, move.disk, move.to);
          }
          expect(state).toBe(to);
        }
      }
    }
  });

  it('still takes 1023 moves to carry ten disks from one peg to another', () => {
    const moves = shortestMoves(solved(10, 0), solved(10, 1), 10);
    expect(moves).toHaveLength(2 ** 10 - 1);
    let state = solved(10, 0);
    for (const move of moves) {
      expect(legalMoves(state, 10).some((item) => item.disk === move.disk && item.to === move.to)).toBe(true);
      state = moveDisk(state, move.disk, move.to);
    }
    expect(state).toBe(solved(10, 1));
  });

  it('marks the whole triangle when the largest disk is hovered', () => {
    const disks = 3;
    const region = regionOf(solved(disks, 1), disks, disks - 1, corners);
    expect(region).toEqual([corners[0], corners[1], corners[2]]);
    for (let state = 0; state < stateCount(disks); state += 1) {
      expect(contains(pointOf(state, disks, corners), region)).toBe(true);
    }
  });

  it('marks the smallest triangle when the top disk is hovered', () => {
    const disks = 3;
    const anchor = 4;
    const region = regionOf(anchor, disks, 0, corners);
    let inside = 0;
    for (let state = 0; state < stateCount(disks); state += 1) {
      const shares = pegOf(state, 1) === pegOf(anchor, 1) && pegOf(state, 2) === pegOf(anchor, 2);
      expect(contains(pointOf(state, disks, corners), region)).toBe(shares);
      if (shares) inside += 1;
    }
    expect(inside).toBe(3);
  });

  it('nests each disk one step inside the next larger disk', () => {
    const disks = 3;
    const anchor = solved(disks, 1);
    const whole = regionOf(anchor, disks, 2, corners);
    const corner = regionOf(anchor, disks, 1, corners);
    let inside = 0;
    for (let state = 0; state < stateCount(disks); state += 1) {
      const shares = pegOf(state, 2) === 1;
      expect(contains(pointOf(state, disks, corners), corner)).toBe(shares);
      if (shares) {
        inside += 1;
        expect(contains(pointOf(state, disks, corners), whole)).toBe(true);
      }
    }
    expect(inside).toBe(9);
  });

  it('reaches every arrangement of two disks in at most three moves', () => {
    const disks = 2;
    for (let from = 0; from < stateCount(disks); from += 1) {
      for (let to = 0; to < stateCount(disks); to += 1) {
        const moves = shortestMoves(from, to, disks);
        expect(moves.length).toBeLessThanOrEqual(3);
        let state = from;
        for (const move of moves) state = moveDisk(state, move.disk, move.to);
        expect(state).toBe(to);
        for (let disk = 0; disk < disks; disk += 1) expect(pegOf(state, disk)).toBe(pegOf(to, disk));
      }
    }
  });
});

function contains(point: Point, corners: readonly [Point, Point, Point]): boolean {
  const [a, b, c] = corners;
  const sign = (p: Point, q: Point, r: Point): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = sign(point, a, b);
  const d2 = sign(point, b, c);
  const d3 = sign(point, c, a);
  const hasNeg = d1 < -1e-4 || d2 < -1e-4 || d3 < -1e-4;
  const hasPos = d1 > 1e-4 || d2 > 1e-4 || d3 > 1e-4;
  return !(hasNeg && hasPos);
}

/** Graph distance between every pair. Index is from * count + to. */
function bfsDistance(disks: number): number[] {
  const count = stateCount(disks);
  const distance = Array.from({ length: count * count }, () => -1);
  for (let from = 0; from < count; from += 1) {
    const queue = [from];
    distance[from * count + from] = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const state = queue[head]!;
      const soFar = distance[from * count + state]!;
      for (const move of legalMoves(state, disks)) {
        const next = moveDisk(state, move.disk, move.to);
        const index = from * count + next;
        if (distance[index] !== -1) continue;
        distance[index] = soFar + 1;
        queue.push(next);
      }
    }
  }
  return distance;
}

/** Two open segments cross when their interiors meet, including a dot sitting mid-edge. */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 === 0 && o2 === 0) return rangesOverlap(a, b, c, d);
  if (o1 === 0 && onOpenSegment(a, b, c)) return true;
  if (o2 === 0 && onOpenSegment(a, b, d)) return true;
  if (o3 === 0 && onOpenSegment(c, d, a)) return true;
  if (o4 === 0 && onOpenSegment(c, d, b)) return true;
  return o1 !== o2 && o3 !== o4;
}

function orient(a: Point, b: Point, c: Point): number {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const scale = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - a.x, c.y - a.y);
  if (scale === 0 || Math.abs(value) <= 1e-8 * Math.max(1, scale)) return 0;
  return Math.sign(value);
}

function rangesOverlap(a: Point, b: Point, c: Point, d: Point): boolean {
  const useX = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y);
  const lo1 = Math.min(useX ? a.x : a.y, useX ? b.x : b.y);
  const hi1 = Math.max(useX ? a.x : a.y, useX ? b.x : b.y);
  const lo2 = Math.min(useX ? c.x : c.y, useX ? d.x : d.y);
  const hi2 = Math.max(useX ? c.x : c.y, useX ? d.x : d.y);
  return Math.min(hi1, hi2) - Math.max(lo1, lo2) > 1e-6;
}

function onOpenSegment(a: Point, b: Point, point: Point): boolean {
  const useX = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y);
  const value = useX ? point.x : point.y;
  const from = useX ? a.x : a.y;
  const to = useX ? b.x : b.y;
  return value > Math.min(from, to) + 1e-6 && value < Math.max(from, to) - 1e-6;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance from a point to a segment, so a dot sitting on a move shows up. */
function segmentDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}
