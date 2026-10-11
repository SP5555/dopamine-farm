export type Move = 0 | 1 | 2 | 3;

export const MOVES: readonly Move[] = [0, 1, 2, 3];

const OPPOSITE: readonly Move[] = [1, 0, 3, 2];

const manhattanTables = new Map<number, Int16Array>();

export function opposite(move: Move): Move {
  return OPPOSITE[move]!;
}

export function delta(move: Move, size: number): number {
  switch (move) {
    case 0:
      return -size;
    case 1:
      return size;
    case 2:
      return -1;
    default:
      return 1;
  }
}

export function isLegal(blank: number, move: Move, size: number): boolean {
  const row = Math.floor(blank / size);
  const col = blank % size;
  switch (move) {
    case 0:
      return row > 0;
    case 1:
      return row + 1 < size;
    case 2:
      return col > 0;
    default:
      return col + 1 < size;
  }
}

export function legalMoves(blank: number, size: number, blocked: Move | null = null): Move[] {
  const moves: Move[] = [];
  for (const move of MOVES) {
    if (move === blocked) continue;
    if (isLegal(blank, move, size)) moves.push(move);
  }
  return moves;
}

export function solvedBoard(size: number): Uint8Array {
  const board = new Uint8Array(size * size);
  for (let index = 0; index < board.length - 1; index += 1) board[index] = index + 1;
  return board;
}

export function isSolved(board: Uint8Array): boolean {
  for (let index = 0; index < board.length - 1; index += 1) {
    if (board[index] !== index + 1) return false;
  }
  return board[board.length - 1] === 0;
}

export function blankOf(board: Uint8Array): number {
  return board.indexOf(0);
}

export function applyMove(board: Uint8Array, move: Move, size: number): number {
  const blank = board.indexOf(0);
  const to = blank + delta(move, size);
  board[blank] = board[to]!;
  board[to] = 0;
  return to;
}

export function inversionCount(board: Uint8Array): number {
  let inversions = 0;
  for (let i = 0; i < board.length; i += 1) {
    const left = board[i]!;
    if (left === 0) continue;
    for (let j = i + 1; j < board.length; j += 1) {
      const right = board[j]!;
      if (right !== 0 && left > right) inversions += 1;
    }
  }
  return inversions;
}

/** 1-based row of the blank, counted from the bottom. */
export function blankRowFromBottom(board: Uint8Array, size: number): number {
  const rowFromTop = Math.floor(board.indexOf(0) / size);
  return size - rowFromTop;
}

/**
 * Inversions ignore the blank.
 * Odd width: solvable when the inversion count is even.
 * Even width: solvable when inversions + blank row from the bottom is odd.
 * The solved 4×4 has 0 inversions and a blank row of 1, which is odd.
 */
export function isSolvable(board: Uint8Array, size: number): boolean {
  const inversions = inversionCount(board);
  if (size % 2 === 1) return inversions % 2 === 0;
  return (inversions + blankRowFromBottom(board, size)) % 2 === 1;
}

export function manhattanTable(size: number): Int16Array {
  const cached = manhattanTables.get(size);
  if (cached) return cached;
  const cells = size * size;
  const table = new Int16Array(cells * cells);
  for (let tile = 1; tile < cells; tile += 1) {
    const goal = tile - 1;
    const goalRow = Math.floor(goal / size);
    const goalCol = goal % size;
    for (let position = 0; position < cells; position += 1) {
      const row = Math.floor(position / size);
      const col = position % size;
      table[tile * cells + position] = Math.abs(row - goalRow) + Math.abs(col - goalCol);
    }
  }
  manhattanTables.set(size, table);
  return table;
}

export function manhattan(board: Uint8Array, size: number): number {
  const cells = size * size;
  const table = manhattanTable(size);
  let total = 0;
  for (let index = 0; index < cells; index += 1) {
    const tile = board[index]!;
    if (tile !== 0) total += table[tile * cells + index]!;
  }
  return total;
}

function lisLength(sequence: number[]): number {
  const tails: number[] = [];
  for (const value of sequence) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo === tails.length) tails.push(value);
    else tails[lo] = value;
  }
  return tails.length;
}

/** Tiles that must leave a line: count minus the longest increasing subsequence of goal positions. */
export function linearConflict(board: Uint8Array, size: number): number {
  let extra = 0;
  for (let row = 0; row < size; row += 1) {
    const sequence: number[] = [];
    for (let col = 0; col < size; col += 1) {
      const tile = board[row * size + col]!;
      if (tile === 0) continue;
      const goal = tile - 1;
      if (Math.floor(goal / size) === row) sequence.push(goal % size);
    }
    extra += sequence.length - lisLength(sequence);
  }
  for (let col = 0; col < size; col += 1) {
    const sequence: number[] = [];
    for (let row = 0; row < size; row += 1) {
      const tile = board[row * size + col]!;
      if (tile === 0) continue;
      const goal = tile - 1;
      if (goal % size === col) sequence.push(Math.floor(goal / size));
    }
    extra += sequence.length - lisLength(sequence);
  }
  return extra;
}

export function heuristic(board: Uint8Array, size: number): number {
  return manhattan(board, size) + 2 * linearConflict(board, size);
}

const PACK_BITS = 7n;

export function packState(board: Uint8Array): bigint {
  let key = 0n;
  for (let index = 0; index < board.length; index += 1) {
    key = (key << PACK_BITS) | BigInt(board[index]!);
  }
  return key;
}
