import type { Rng } from '../../harness/rng';
import { createRng } from '../../harness/rng';
import { applyMove, isSolvable, legalMoves, opposite, solvedBoard, type Move } from './board';

export interface WalkScramble {
  moves: Move[];
  finalBoard: Uint8Array;
}

export interface UniformScramble {
  finalBoard: Uint8Array;
}

export function walkScramble(size: number, length: number, seed: number): WalkScramble {
  const rng = createRng(seed);
  const board = solvedBoard(size);
  const moves: Move[] = [];
  let blank = size * size - 1;
  let previous: Move | null = null;
  for (let index = 0; index < length; index += 1) {
    const choices = legalMoves(blank, size, previous === null ? null : opposite(previous));
    const move = rng.pick(choices);
    blank = applyMove(board, move, size);
    moves.push(move);
    previous = move;
  }
  return { moves, finalBoard: board };
}

/** One solvable board, chosen evenly from every solvable board. */
export function uniformScramble(size: number, seed: number): UniformScramble {
  return { finalBoard: randomSolvable(size, createRng(seed)) };
}

function randomSolvable(size: number, rng: Rng): Uint8Array {
  const board = randomPermutation(size, rng);
  if (isSolvable(board, size)) return board;
  let first = -1;
  let second = -1;
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] === 0) continue;
    if (first < 0) first = index;
    else {
      second = index;
      break;
    }
  }
  const swap = board[first]!;
  board[first] = board[second]!;
  board[second] = swap;
  return board;
}

function randomPermutation(size: number, rng: Rng): Uint8Array {
  const board = solvedBoard(size);
  const values = Array.from(board);
  rng.shuffle(values);
  board.set(values);
  return board;
}
