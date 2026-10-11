import { describe, expect, it } from 'vitest';
import {
  applyMove,
  blankRowFromBottom,
  heuristic,
  inversionCount,
  isSolvable,
  manhattan,
  packState,
  solvedBoard,
} from './board';
import { uniformScramble, walkScramble } from './scramble';

describe('sliding puzzle board', () => {
  it('treats the solved board as solvable for every offered size', () => {
    for (const size of [3, 4, 5, 6, 8, 10, 14]) {
      const board = solvedBoard(size);
      expect(isSolvable(board, size)).toBe(true);
      expect(manhattan(board, size)).toBe(0);
      expect(heuristic(board, size)).toBe(0);
    }
  });

  it('matches the 4×4 solved parity check', () => {
    const board = solvedBoard(4);
    expect(inversionCount(board)).toBe(0);
    expect(blankRowFromBottom(board, 4)).toBe(1);
  });

  it('makes a solved board unsolvable after swapping two tiles', () => {
    for (const size of [3, 4]) {
      const board = solvedBoard(size);
      const swap = board[0]!;
      board[0] = board[1]!;
      board[1] = swap;
      expect(isSolvable(board, size)).toBe(false);
    }
  });

  it('counts one blank step as Manhattan 1', () => {
    const board = solvedBoard(3);
    applyMove(board, 2, 3);
    expect(manhattan(board, 3)).toBe(1);
    expect(heuristic(board, 3)).toBe(1);
  });

  it('packs a 5×5 tile above 15 as its own state', () => {
    const board = solvedBoard(5);
    const swapped = new Uint8Array(board);
    swapped[0] = board[15]!;
    swapped[15] = board[0]!;
    expect(packState(board)).not.toBe(packState(swapped));
  });

  it('packs the last tile of a 10×10 without colliding', () => {
    const board = solvedBoard(10);
    const swapped = new Uint8Array(board);
    const last = board.length - 2;
    swapped[0] = board[last]!;
    swapped[last] = board[0]!;
    expect(packState(board)).not.toBe(packState(swapped));
  });

  it('keeps the heuristic within the length of a random walk', () => {
    for (const size of [3, 4, 5, 6, 8, 10, 14]) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const walk = walkScramble(size, 12, seed);
        expect(heuristic(walk.finalBoard, size)).toBeLessThanOrEqual(12);
        expect(isSolvable(walk.finalBoard, size)).toBe(true);
      }
    }
  });

  it('builds a solvable uniform scramble and a walk that replays to the same board', () => {
    const uniform = uniformScramble(4, 9);
    expect(uniform.frames).toHaveLength(20);
    expect(isSolvable(uniform.finalBoard, 4)).toBe(true);
    expect(uniform.frames[19]).toEqual(uniform.finalBoard);

    const walk = walkScramble(3, 15, 4);
    const board = solvedBoard(3);
    for (const move of walk.moves) applyMove(board, move, 3);
    expect(board).toEqual(walk.finalBoard);
  });
});
