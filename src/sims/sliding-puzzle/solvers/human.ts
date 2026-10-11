import {
  applyMove,
  delta,
  isLegal,
  isSolved,
  opposite,
  solvedBoard,
  type Move,
} from '../board';
import type { Search } from './search';

/**
 * Places tiles the way a person does, either a row at a time or a row and then
 * the column beside it.
 * A single tile is walked home while finished cells stay walls.
 * The last two cells of a row or column are placed together, because a
 * one-cell pocket cannot accept a new tile. The final handful of cells
 * is solved exhaustively. Memory stays on the order of one row, not the
 * whole puzzle.
 */
export type HumanOrder = 'rows' | 'inward';

const YIELD_EVERY = 2048;

export function createHumanSolver(start: Uint8Array, size: number, order: HumanOrder = 'rows'): Search {
  const walk = walkHuman(start, size, order);
  let found = false;
  let failed = false;
  let finished = false;
  let moves: Move[] = [];
  let nodes = 0;
  let elapsedMs = 0;

  return {
    step(maxNodes = YIELD_EVERY) {
      if (finished) return;
      const started = performance.now();
      let spent = 0;
      while (spent < maxNodes && performance.now() - started < 4) {
        const next = walk.next();
        if (next.done) {
          nodes = next.value.nodes;
          if (next.value.moves && replays(start, next.value.moves, size)) {
            moves = next.value.moves;
            found = true;
          } else {
            failed = true;
          }
          finished = true;
          break;
        }
        spent += next.value;
        nodes += next.value;
      }
      elapsedMs += performance.now() - started;
    },
    solution: () => moves,
    get found() {
      return found;
    },
    get aborted() {
      return false;
    },
    get failed() {
      return failed;
    },
    get nodes() {
      return nodes;
    },
    get bound() {
      return null;
    },
    get openSize() {
      return null;
    },
    get elapsedMs() {
      return elapsedMs;
    },
  };
}

interface Route {
  moves: Move[] | null;
  nodes: number;
}

export function solveHuman(
  start: Uint8Array,
  size: number,
  order: HumanOrder = 'rows',
): { moves: Move[] | null; nodes: number } {
  const walk = walkHuman(start, size, order);
  let step = walk.next();
  while (!step.done) step = walk.next();
  return step.value;
}

function* walkHuman(
  start: Uint8Array,
  size: number,
  order: HumanOrder,
): Generator<number, { moves: Move[] | null; nodes: number }> {
  const board = new Uint8Array(start);
  const frozen = new Uint8Array(board.length);
  const moves: Move[] = [];
  let nodes = 0;
  const spend = (count: number) => {
    nodes += count;
  };

  function* finishIfSmall(): Generator<number, boolean | null> {
    if (freeCount(frozen) > 6) return null;
    const pocket = yield* solvePocket(board, size, frozen);
    spend(pocket.nodes);
    if (!pocket.moves) return false;
    commit(board, size, moves, pocket.moves);
    return true;
  }

  function* finish(): Generator<number, { moves: Move[] | null; nodes: number } | null> {
    const done = yield* finishIfSmall();
    if (done === null) return null;
    return done ? { moves: compress(moves), nodes } : { moves: null, nodes };
  }

  if (size > 2 && order === 'inward') {
    for (let origin = 0; size - origin > 2; origin += 1) {
      for (let col = origin; col < size - 2; col += 1) {
        const done = yield* finish();
        if (done) return done;
        if (!(yield* placeTile(board, size, origin * size + col, frozen, moves, spend))) {
          return { moves: null, nodes };
        }
      }
      const rowDone = yield* finish();
      if (rowDone) return rowDone;
      const rowA = origin * size + (size - 2);
      if (!(yield* placePair(board, size, rowA, rowA + 1, frozen, moves, spend))) {
        return { moves: null, nodes };
      }

      for (let row = origin + 1; row < size - 2; row += 1) {
        const done = yield* finish();
        if (done) return done;
        if (!(yield* placeTile(board, size, row * size + origin, frozen, moves, spend))) {
          return { moves: null, nodes };
        }
      }
      const colDone = yield* finish();
      if (colDone) return colDone;
      const colA = (size - 2) * size + origin;
      if (!(yield* placePair(board, size, colA, colA + size, frozen, moves, spend))) {
        return { moves: null, nodes };
      }
    }
  } else if (size > 2) {
    for (let row = 0; row < size - 2; row += 1) {
      for (let col = 0; col < size - 2; col += 1) {
        const done = yield* finish();
        if (done) return done;
        if (!(yield* placeTile(board, size, row * size + col, frozen, moves, spend))) {
          return { moves: null, nodes };
        }
      }
      const paired = yield* finish();
      if (paired) return paired;
      const homeA = row * size + (size - 2);
      if (!(yield* placePair(board, size, homeA, homeA + 1, frozen, moves, spend))) {
        return { moves: null, nodes };
      }
    }
    const band = size - 2;
    for (let col = 0; col < size - 2; col += 1) {
      const done = yield* finish();
      if (done) return done;
      const homeU = band * size + col;
      if (!(yield* placePair(board, size, homeU, homeU + size, frozen, moves, spend))) {
        return { moves: null, nodes };
      }
    }
  }

  const done = yield* finishIfSmall();
  if (done !== true) return { moves: null, nodes };
  return { moves: compress(moves), nodes };
}

function* placeTile(
  board: Uint8Array,
  size: number,
  goal: number,
  frozen: Uint8Array,
  moves: Move[],
  spend: (count: number) => void,
): Generator<number, boolean> {
  const routed = yield* routeTile(board, size, goal + 1, goal, frozen);
  spend(routed.nodes);
  if (!routed.moves) return false;
  commit(board, size, moves, routed.moves);
  if (board[goal] !== goal + 1) return false;
  frozen[goal] = 1;
  return true;
}

function* placePair(
  board: Uint8Array,
  size: number,
  goalA: number,
  goalB: number,
  frozen: Uint8Array,
  moves: Move[],
  spend: (count: number) => void,
): Generator<number, boolean> {
  const tileA = goalA + 1;
  const tileB = goalB + 1;
  if (board[goalA] === tileA && board[goalB] === tileB) {
    frozen[goalA] = 1;
    frozen[goalB] = 1;
    return true;
  }
  const routed = yield* routePair(board, size, tileA, goalA, tileB, goalB, frozen);
  spend(routed.nodes);
  if (!routed.moves) return false;
  commit(board, size, moves, routed.moves);
  if (board[goalA] !== tileA || board[goalB] !== tileB) return false;
  frozen[goalA] = 1;
  frozen[goalB] = 1;
  return true;
}

function commit(board: Uint8Array, size: number, moves: Move[], extra: readonly Move[]): void {
  for (const move of extra) {
    applyMove(board, move, size);
    moves.push(move);
  }
}

function freeCount(frozen: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < frozen.length; index += 1) if (frozen[index] === 0) count += 1;
  return count;
}

function* routeTile(
  board: Uint8Array,
  size: number,
  tile: number,
  goal: number,
  frozen: Uint8Array,
): Generator<number, Route> {
  const cells = size * size;
  let tileAt = -1;
  let blank = board.indexOf(0);
  for (let index = 0; index < cells; index += 1) {
    if (board[index] === tile) tileAt = index;
  }
  if (tileAt < 0 || blank < 0) return { moves: null, nodes: 0 };
  if (tileAt === goal) return { moves: [], nodes: 0 };

  const span = cells * cells;
  const parent = new Int32Array(span).fill(-1);
  const via = new Int8Array(span).fill(-1);
  const seen = new Uint8Array(span);
  const start = tileAt * cells + blank;
  const queue = [start];
  seen[start] = 1;
  let head = 0;
  let nodes = 0;
  let batch = 0;
  let found = -1;

  while (head < queue.length) {
    const state = queue[head]!;
    head += 1;
    nodes += 1;
    batch += 1;
    if (batch >= YIELD_EVERY) {
      yield batch;
      batch = 0;
    }
    const stateTile = Math.floor(state / cells);
    const stateBlank = state % cells;
    if (stateTile === goal) {
      found = state;
      break;
    }
    for (const move of [0, 1, 2, 3] as const) {
      const nextBlank = stepBlank(stateBlank, move, size, frozen);
      if (nextBlank < 0) continue;
      const nextTile = nextBlank === stateTile ? stateBlank : stateTile;
      if (frozen[nextTile]) continue;
      const next = nextTile * cells + nextBlank;
      if (seen[next]) continue;
      seen[next] = 1;
      parent[next] = state;
      via[next] = move;
      queue.push(next);
    }
  }

  if (batch > 0) yield batch;
  if (found < 0) return { moves: null, nodes };
  return { moves: retrace(found, start, parent, via), nodes };
}

function* routePair(
  board: Uint8Array,
  size: number,
  tileA: number,
  goalA: number,
  tileB: number,
  goalB: number,
  frozen: Uint8Array,
): Generator<number, Route> {
  const cells = size * size;
  const stride = cells * cells;
  let posA = board.indexOf(tileA);
  let posB = board.indexOf(tileB);
  const blank = board.indexOf(0);
  if (posA < 0 || posB < 0 || blank < 0) return { moves: null, nodes: 0 };
  const start = posA * stride + posB * cells + blank;
  if (posA === goalA && posB === goalB) return { moves: [], nodes: 0 };

  const span = cells * stride;
  const parent = new Int32Array(span).fill(-1);
  const via = new Int8Array(span).fill(-1);
  const seen = new Uint8Array(span);
  const queue = [start];
  seen[start] = 1;
  let head = 0;
  let nodes = 0;
  let batch = 0;
  let found = -1;

  while (head < queue.length) {
    const state = queue[head]!;
    head += 1;
    nodes += 1;
    batch += 1;
    if (batch >= YIELD_EVERY) {
      yield batch;
      batch = 0;
    }
    posA = Math.floor(state / stride);
    const rest = state % stride;
    posB = Math.floor(rest / cells);
    const stateBlank = rest % cells;
    if (posA === goalA && posB === goalB) {
      found = state;
      break;
    }
    for (const move of [0, 1, 2, 3] as const) {
      const nextBlank = stepBlank(stateBlank, move, size, frozen);
      if (nextBlank < 0) continue;
      let nextA = posA;
      let nextB = posB;
      if (nextBlank === posA) nextA = stateBlank;
      else if (nextBlank === posB) nextB = stateBlank;
      if (frozen[nextA] || frozen[nextB]) continue;
      const next = nextA * stride + nextB * cells + nextBlank;
      if (seen[next]) continue;
      seen[next] = 1;
      parent[next] = state;
      via[next] = move;
      queue.push(next);
    }
  }

  if (batch > 0) yield batch;
  if (found < 0) return { moves: null, nodes };
  return { moves: retrace(found, start, parent, via), nodes };
}

function retrace(found: number, start: number, parent: Int32Array, via: Int8Array): Move[] {
  const moves: Move[] = [];
  for (let state = found; state !== start; state = parent[state]!) moves.push(via[state] as Move);
  moves.reverse();
  return moves;
}

function stepBlank(blank: number, move: Move, size: number, frozen: Uint8Array): number {
  if (!isLegal(blank, move, size)) return -1;
  const next = blank + delta(move, size);
  if (frozen[next]) return -1;
  return next;
}

function* solvePocket(board: Uint8Array, size: number, frozen: Uint8Array): Generator<number, Route> {
  const cells: number[] = [];
  for (let index = 0; index < frozen.length; index += 1) {
    if (frozen[index] === 0) cells.push(index);
  }
  const goal = solvedBoard(size);
  const target = cells.map((cell) => goal[cell]!).join(',');
  const startKey = cells.map((cell) => board[cell]!).join(',');
  if (startKey === target) return { moves: [], nodes: 0 };

  const neighbors = cells.map((_, index) => {
    const adjacent: number[] = [];
    for (let other = 0; other < cells.length; other += 1) {
      if (other !== index && adjacentCells(cells[index]!, cells[other]!, size)) adjacent.push(other);
    }
    return adjacent;
  });

  const parent = new Map<string, { prev: string; move: Move }>();
  const queue = [startKey];
  parent.set(startKey, { prev: '', move: 0 });
  let head = 0;
  let nodes = 0;
  let batch = 0;
  let found = '';

  while (head < queue.length) {
    const key = queue[head]!;
    head += 1;
    nodes += 1;
    batch += 1;
    if (batch >= YIELD_EVERY) {
      yield batch;
      batch = 0;
    }
    if (key === target) {
      found = key;
      break;
    }
    const values = key.split(',').map(Number);
    const blankLocal = values.indexOf(0);
    for (const nextLocal of neighbors[blankLocal] ?? []) {
      const move = moveBetween(cells[blankLocal]!, cells[nextLocal]!, size);
      if (move === null) continue;
      const swapped = values.slice();
      swapped[blankLocal] = swapped[nextLocal]!;
      swapped[nextLocal] = 0;
      const nextKey = swapped.join(',');
      if (parent.has(nextKey)) continue;
      parent.set(nextKey, { prev: key, move });
      queue.push(nextKey);
    }
  }

  if (batch > 0) yield batch;
  if (!found) return { moves: null, nodes };
  const moves: Move[] = [];
  for (let key = found; key !== startKey; ) {
    const step = parent.get(key);
    if (!step) return { moves: null, nodes };
    moves.push(step.move);
    key = step.prev;
  }
  moves.reverse();
  return { moves, nodes };
}

function adjacentCells(left: number, right: number, size: number): boolean {
  const row = Math.floor(left / size);
  const col = left % size;
  const otherRow = Math.floor(right / size);
  const otherCol = right % size;
  return Math.abs(row - otherRow) + Math.abs(col - otherCol) === 1;
}

function moveBetween(from: number, to: number, size: number): Move | null {
  const deltaIndex = to - from;
  if (deltaIndex === -size) return 0;
  if (deltaIndex === size) return 1;
  if (deltaIndex === -1) return 2;
  if (deltaIndex === 1) return 3;
  return null;
}

function compress(moves: readonly Move[]): Move[] {
  const stack: Move[] = [];
  for (const move of moves) {
    const last = stack[stack.length - 1];
    if (last !== undefined && opposite(last) === move) stack.pop();
    else stack.push(move);
  }
  return stack;
}

function replays(start: Uint8Array, moves: readonly Move[], size: number): boolean {
  const board = new Uint8Array(start);
  for (const move of moves) applyMove(board, move, size);
  return isSolved(board);
}
