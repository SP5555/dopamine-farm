import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyMove,
  isSolved,
  legalMoves,
  solvedBoard,
  heuristic,
  type Move,
} from '../board';
import { uniformScramble, walkScramble } from '../scramble';
import { createHumanSolver, placementUnits, solveHuman } from './human';
import { createIdaStar } from './ida-star';
import type { Search } from './search';
import { createWeightedAStar } from './weighted-astar';

const HARD = Uint8Array.from([8, 6, 7, 2, 5, 4, 3, 0, 1]);

let distances: Map<number, number>;

beforeAll(() => {
  distances = distancesFromSolved();
});

describe('sliding puzzle solvers', () => {
  it('knows the classic 8-puzzle is 31 moves from solved', () => {
    expect(distances.get(pack3(HARD))).toBe(31);
  });

  it('solves one move from solved', () => {
    const board = solvedBoard(3);
    applyMove(board, 0, 3);
    expect(solve(createIdaStar(board, 3, 1_000_000)).solution()).toHaveLength(1);
    expect(solve(createWeightedAStar(board, 3, 2)).solution()).toHaveLength(1);
  });

  it('finds the known 31-move optimum', () => {
    const search = solve(createIdaStar(HARD, 3, 20_000_000));
    expect(search.found).toBe(true);
    expect(search.solution()).toHaveLength(31);
    expect(replay(HARD, search.solution(), 3)).toBe(true);
  });

  it('stays admissible and matches breadth-first search on 3×3', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const board = walkScramble(3, 16, seed).finalBoard;
      const optimal = distances.get(pack3(board));
      expect(optimal).toBeTypeOf('number');
      expect(heuristic(board, 3)).toBeLessThanOrEqual(optimal!);
      const ida = solve(createIdaStar(board, 3, 20_000_000));
      expect(ida.solution()).toHaveLength(optimal!);
      expect(replay(board, ida.solution(), 3)).toBe(true);
    }

    for (let seed = 1; seed <= 6; seed += 1) {
      const board = walkScramble(3, 12, seed + 100).finalBoard;
      const optimal = distances.get(pack3(board))!;
      const exact = solve(createWeightedAStar(board, 3, 1));
      expect(exact.solution()).toHaveLength(optimal);
      const fast = solve(createWeightedAStar(board, 3, 2));
      expect(fast.solution().length).toBeGreaterThanOrEqual(optimal);
      expect(replay(board, fast.solution(), 3)).toBe(true);
    }
  });

  it('returns the same solution one node at a time as in one batch', () => {
    const board = walkScramble(3, 10, 7).finalBoard;
    const batch = solve(createIdaStar(board, 3, 20_000_000), 50_000);
    const stepped = createIdaStar(board, 3, 20_000_000);
    let guard = 0;
    while (!stepped.found && !stepped.failed && !stepped.aborted) {
      stepped.step(1);
      if (++guard > 2_000_000) throw new Error('incremental search did not finish');
    }
    expect(stepped.solution()).toEqual(batch.solution());
  });

  it('solves 4×4 walks', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const board = walkScramble(4, 10, seed).finalBoard;
      const fast = solve(createWeightedAStar(board, 4, 2));
      expect(fast.found).toBe(true);
      expect(replay(board, fast.solution(), 4)).toBe(true);
    }

    for (let seed = 1; seed <= 6; seed += 1) {
      const walk = walkScramble(4, 8, seed + 40);
      const ida = solve(createIdaStar(walk.finalBoard, 4, 20_000_000));
      expect(ida.found).toBe(true);
      expect(ida.solution().length).toBeLessThanOrEqual(walk.moves.length);
      expect(replay(walk.finalBoard, ida.solution(), 4)).toBe(true);
    }
  });

  it('is deterministic for the same board', () => {
    const board = walkScramble(4, 12, 3).finalBoard;
    const a = solve(createWeightedAStar(board, 4, 2)).solution();
    const b = solve(createWeightedAStar(new Uint8Array(board), 4, 2)).solution();
    expect(a).toEqual(b);
    const walkA = walkScramble(4, 12, 3);
    const walkB = walkScramble(4, 12, 3);
    expect(walkA.moves).toEqual(walkB.moves);
    expect(walkA.finalBoard).toEqual(walkB.finalBoard);
  });

  it('solves walks and uniform boards by placing rows', () => {
    for (const size of [3, 4, 5, 6, 8, 10, 14]) {
      for (let seed = 1; seed <= 4; seed += 1) {
        const walk = walkScramble(size, 30, seed).finalBoard;
        const walked = solve(createHumanSolver(walk, size));
        expect(walked.found, `walk ${size} seed ${seed}`).toBe(true);
        expect(replay(walk, walked.solution(), size)).toBe(true);
      }
    }

    for (const size of [3, 4, 6, 10]) {
      for (let seed = 1; seed <= 3; seed += 1) {
        const board = uniformScramble(size, seed).finalBoard;
        const search = solve(createHumanSolver(board, size));
        expect(search.found, `uniform ${size} seed ${seed}`).toBe(true);
        expect(search.solution().length).toBeGreaterThan(0);
        expect(search.solution().length).toBeLessThan(size * size * size * 8);
        expect(replay(board, search.solution(), size)).toBe(true);
      }
    }
  });

  it('pairs an odd line after one tile and an even line all the way', () => {
    expect(placementUnits([0, 1, 2, 3, 4], 'tail')).toEqual([[0], [1], [2], [3, 4]]);
    expect(placementUnits([0, 1, 2, 3, 4], 'runs')).toEqual([[0], [1, 2], [3, 4]]);
    expect(placementUnits([0, 1, 2, 3], 'runs')).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('marks each move with the tiles that placement is seating', () => {
    const board = walkScramble(5, 40, 1).finalBoard;
    for (const pairing of ['tail', 'runs'] as const) {
      const solved = solveHuman(board, 5, 'rows', pairing);
      expect(solved.moves, pairing).not.toBeNull();
      expect(solved.focus, pairing).toHaveLength(solved.moves!.length);
      for (const tiles of solved.focus) {
        expect(tiles.length).toBeGreaterThan(0);
        expect(tiles.length).toBeLessThanOrEqual(5);
      }
      const pocket = solved.focus.find((tiles) => tiles.length > 2);
      expect(pocket, pairing).toBeTruthy();
    }
  });

  it('hands each placement back before the walk finishes', () => {
    const board = walkScramble(5, 40, 1).finalBoard;
    const search = createHumanSolver(board, 5, 'rows', 'runs');
    const moves: Move[] = [];
    let early = false;
    let steps = 0;
    while (!search.found && !search.failed) {
      search.step(5000);
      const taken = search.take?.();
      if (taken) {
        if (!search.found) early = true;
        moves.push(...taken.moves);
      }
      if (++steps > 200_000) throw new Error('search did not finish');
    }
    const last = search.take?.();
    if (last) moves.push(...last.moves);
    expect(early).toBe(true);
    expect(search.found).toBe(true);
    expect(moves).toEqual(search.solution());
    expect(replay(board, moves, 5)).toBe(true);
  });

  it('solves with pair runs and uses fewer moves than one-tile placement', () => {
    for (const order of ['rows', 'inward'] as const) {
      for (const size of [5, 6, 8]) {
        const board = walkScramble(size, 40, 1).finalBoard;
        const tail = solveHuman(board, size, order, 'tail');
        const runs = solveHuman(board, size, order, 'runs');
        expect(tail.moves, `${order} ${size} tail`).not.toBeNull();
        expect(runs.moves, `${order} ${size} runs`).not.toBeNull();
        expect(replay(board, runs.moves!, size)).toBe(true);
        expect(runs.moves!.length).toBeLessThanOrEqual(tail.moves!.length);
      }
    }
  });

  it('solves by placing a row and then the column beside it', () => {
    for (const size of [3, 4, 5, 6, 8, 10, 14]) {
      for (let seed = 1; seed <= 2; seed += 1) {
        const walk = walkScramble(size, 30, seed).finalBoard;
        const walked = solve(createHumanSolver(walk, size, 'inward'));
        expect(walked.found, `inward walk ${size} seed ${seed}`).toBe(true);
        expect(replay(walk, walked.solution(), size)).toBe(true);
      }
    }

    for (const size of [4, 6, 10, 14]) {
      const board = uniformScramble(size, 1).finalBoard;
      const search = solve(createHumanSolver(board, size, 'inward'));
      expect(search.found, `inward uniform ${size}`).toBe(true);
      expect(search.solution().length).toBeGreaterThan(0);
      expect(replay(board, search.solution(), size)).toBe(true);
    }
  });

  it('falls back cleanly when IDA* is given a tiny budget', () => {
    const board = walkScramble(4, 18, 11).finalBoard;
    const stalled = solve(createIdaStar(board, 4, 1), 500);
    expect(stalled.aborted).toBe(true);
    expect(stalled.found).toBe(false);
    const rescued = solve(createWeightedAStar(board, 4, 2));
    expect(replay(board, rescued.solution(), 4)).toBe(true);
  });
});

function solve(search: Search, chunk = 5000): Search {
  let steps = 0;
  while (!search.found && !search.aborted && !search.failed) {
    search.take?.();
    search.step(chunk);
    if (++steps > 200_000) throw new Error('search did not finish');
  }
  search.take?.();
  return search;
}

function replay(start: Uint8Array, moves: readonly Move[], size: number): boolean {
  const board = new Uint8Array(start);
  for (const move of moves) applyMove(board, move, size);
  return isSolved(board);
}

function pack3(board: Uint8Array): number {
  let key = 0;
  for (let index = 0; index < 9; index += 1) key = key * 16 + board[index]!;
  return key;
}

function distancesFromSolved(): Map<number, number> {
  const board = solvedBoard(3);
  const dist = new Map<number, number>();
  const queue: number[] = [pack3(board)];
  dist.set(queue[0]!, 0);
  let head = 0;
  while (head < queue.length) {
    const key = queue[head++]!;
    const depth = dist.get(key)!;
    load3(board, key);
    const blank = board.indexOf(0);
    for (const move of legalMoves(blank, 3)) {
      const next = new Uint8Array(board);
      applyMove(next, move, 3);
      const packed = pack3(next);
      if (dist.has(packed)) continue;
      dist.set(packed, depth + 1);
      queue.push(packed);
    }
  }
  return dist;
}

function load3(board: Uint8Array, key: number): void {
  let value = key;
  for (let index = 8; index >= 0; index -= 1) {
    board[index] = value % 16;
    value = Math.floor(value / 16);
  }
}
