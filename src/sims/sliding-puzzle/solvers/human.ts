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
 * one-cell pocket cannot accept a new tile. Pair runs do that for every
 * neighboring couple, and place one tile first only when the length is odd.
 * The final handful of cells
 * is solved exhaustively. Each finished placement is handed back immediately,
 * so those slides can play while later tiles are still unplaced.
 * Memory stays on the order of one row, not the whole puzzle.
 */
export type HumanOrder = 'rows' | 'inward';
/** `tail` pairs only the last two cells. `runs` pairs the whole line, with one single tile first when the length is odd. */
export type HumanPairing = 'tail' | 'runs';

type PlacementHandler = (moves: readonly Move[], focus: readonly (readonly number[])[]) => void;

const YIELD_EVERY = 2048;

export function createHumanSolver(
  start: Uint8Array,
  size: number,
  order: HumanOrder = 'rows',
  pairing: HumanPairing = 'tail',
): Search {
  const ready: { moves: Move[]; focus: readonly (readonly number[])[] }[] = [];
  const walk = walkHuman(start, size, order, pairing, (segmentMoves, segmentFocus) => {
    ready.push({ moves: segmentMoves.slice(), focus: segmentFocus.map((tiles) => tiles.slice()) });
  });
  let found = false;
  let failed = false;
  let finished = false;
  let moves: Move[] = [];
  let focus: readonly (readonly number[])[] = [];
  let nodes = 0;
  let elapsedMs = 0;

  return {
    step(maxNodes = YIELD_EVERY) {
      if (finished || ready.length > 0) return;
      const started = performance.now();
      let spent = 0;
      while (spent < maxNodes && performance.now() - started < 4) {
        const next = walk.next();
        if (next.done) {
          nodes = next.value.nodes;
          if (next.value.moves && replays(start, next.value.moves, size)) {
            moves = next.value.moves;
            focus = next.value.focus;
            found = true;
          } else {
            failed = true;
          }
          finished = true;
          break;
        }
        spent += next.value;
        nodes += next.value;
        if (ready.length > 0) break;
      }
      elapsedMs += performance.now() - started;
    },
    solution: () => moves,
    take() {
      if (ready.length === 0) return null;
      const takenMoves: Move[] = [];
      const takenFocus: (readonly number[])[] = [];
      for (const segment of ready) {
        takenMoves.push(...segment.moves);
        takenFocus.push(...segment.focus);
      }
      ready.length = 0;
      return { moves: takenMoves, focus: takenFocus };
    },
    focus: () => focus,
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
  pairing: HumanPairing = 'tail',
): { moves: Move[] | null; nodes: number; focus: readonly (readonly number[])[] } {
  const walk = walkHuman(start, size, order, pairing);
  let step = walk.next();
  while (!step.done) step = walk.next();
  return step.value;
}

function* walkHuman(
  start: Uint8Array,
  size: number,
  order: HumanOrder,
  pairing: HumanPairing,
  publish?: PlacementHandler,
): Generator<number, { moves: Move[] | null; nodes: number; focus: readonly (readonly number[])[] }> {
  const board = new Uint8Array(start);
  const frozen = new Uint8Array(board.length);
  const moves: Move[] = [];
  const focus: number[][] = [];
  let nodes = 0;
  const spend = (count: number) => {
    nodes += count;
  };

  function* finishIfSmall(): Generator<number, boolean | null> {
    if (freeCount(frozen) > 6) return null;
    const pocket = yield* solvePocket(board, size, frozen);
    spend(pocket.nodes);
    if (!pocket.moves) return false;
    commit(board, size, moves, focus, pocket.moves, looseTiles(board, frozen), publish);
    return true;
  }

  function* finish(): Generator<number, { moves: Move[] | null; nodes: number; focus: number[][] } | null> {
    const done = yield* finishIfSmall();
    if (done === null) return null;
    return done ? packed() : { moves: null, nodes, focus: [] };
  }

  function packed(): { moves: Move[]; nodes: number; focus: number[][] } {
    return { moves, nodes, focus };
  }

  function* placeHomes(
    homes: readonly number[],
  ): Generator<number, { moves: Move[] | null; nodes: number; focus: number[][] } | null> {
    for (const unit of placementUnits(homes, pairing)) {
      const done = yield* finish();
      if (done) return done;
      const placed =
        unit.length === 1
          ? yield* placeTile(board, size, unit[0]!, frozen, moves, focus, spend, publish)
          : yield* placePair(board, size, unit[0]!, unit[1]!, frozen, moves, focus, spend, publish);
      if (!placed) return { moves: null, nodes, focus: [] };
    }
    return null;
  }

  if (size > 2 && order === 'inward') {
    for (let origin = 0; size - origin > 2; origin += 1) {
      const rowHomes: number[] = [];
      for (let col = origin; col < size; col += 1) rowHomes.push(origin * size + col);
      const rowPlaced = yield* placeHomes(rowHomes);
      if (rowPlaced) return rowPlaced;
      const colHomes: number[] = [];
      for (let row = origin + 1; row < size; row += 1) colHomes.push(row * size + origin);
      const colPlaced = yield* placeHomes(colHomes);
      if (colPlaced) return colPlaced;
    }
  } else if (size > 2) {
    for (let row = 0; row < size - 2; row += 1) {
      const homes: number[] = [];
      for (let col = 0; col < size; col += 1) homes.push(row * size + col);
      const placed = yield* placeHomes(homes);
      if (placed) return placed;
    }
    const band = size - 2;
    for (let col = 0; col < size - 2; col += 1) {
      const placed = yield* placeHomes([band * size + col, (band + 1) * size + col]);
      if (placed) return placed;
    }
  }

  const done = yield* finishIfSmall();
  if (done !== true) return { moves: null, nodes, focus: [] };
  return packed();
}

/** Last two cells stay a pair. `runs` also pairs every earlier adjacent couple, leaving a single tile only when the line length is odd. */
export function placementUnits(homes: readonly number[], pairing: HumanPairing): number[][] {
  if (homes.length === 0) return [];
  if (pairing === 'tail') {
    if (homes.length === 1) return [[homes[0]!]];
    const units: number[][] = [];
    for (let index = 0; index < homes.length - 2; index += 1) units.push([homes[index]!]);
    units.push([homes[homes.length - 2]!, homes[homes.length - 1]!]);
    return units;
  }
  const units: number[][] = [];
  let index = 0;
  if (homes.length % 2 === 1) {
    units.push([homes[0]!]);
    index = 1;
  }
  for (; index < homes.length; index += 2) units.push([homes[index]!, homes[index + 1]!]);
  return units;
}

function* placeTile(
  board: Uint8Array,
  size: number,
  goal: number,
  frozen: Uint8Array,
  moves: Move[],
  focus: number[][],
  spend: (count: number) => void,
  publish?: PlacementHandler,
): Generator<number, boolean> {
  const routed = yield* routeTile(board, size, goal + 1, goal, frozen);
  spend(routed.nodes);
  if (!routed.moves) return false;
  commit(board, size, moves, focus, routed.moves, [goal + 1], publish);
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
  focus: number[][],
  spend: (count: number) => void,
  publish?: PlacementHandler,
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
  commit(board, size, moves, focus, routed.moves, [tileA, tileB], publish);
  if (board[goalA] !== tileA || board[goalB] !== tileB) return false;
  frozen[goalA] = 1;
  frozen[goalB] = 1;
  return true;
}

function commit(
  board: Uint8Array,
  size: number,
  moves: Move[],
  focus: number[][],
  extra: readonly Move[],
  tiles: readonly number[],
  publish?: PlacementHandler,
): void {
  const mark = tiles.slice();
  const segmentMoves: Move[] = [];
  const segmentFocus: number[][] = [];
  for (const move of extra) {
    applyMove(board, move, size);
    segmentMoves.push(move);
    segmentFocus.push(mark);
  }
  const kept = compress(segmentMoves, segmentFocus);
  for (let index = 0; index < kept.moves.length; index += 1) {
    moves.push(kept.moves[index]!);
    focus.push(kept.focus[index]!);
  }
  if (kept.moves.length > 0) publish?.(kept.moves, kept.focus);
}

function looseTiles(board: Uint8Array, frozen: Uint8Array): number[] {
  const tiles: number[] = [];
  for (let index = 0; index < board.length; index += 1) {
    const tile = board[index]!;
    if (frozen[index] === 0 && tile !== 0) tiles.push(tile);
  }
  return tiles;
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

function compress(
  moves: readonly Move[],
  focus: readonly (readonly number[])[],
): { moves: Move[]; focus: number[][] } {
  const keptMoves: Move[] = [];
  const keptFocus: number[][] = [];
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index]!;
    const last = keptMoves[keptMoves.length - 1];
    if (last !== undefined && opposite(last) === move) {
      keptMoves.pop();
      keptFocus.pop();
    } else {
      keptMoves.push(move);
      keptFocus.push(focus[index]!.slice());
    }
  }
  return { moves: keptMoves, focus: keptFocus };
}

function replays(start: Uint8Array, moves: readonly Move[], size: number): boolean {
  const board = new Uint8Array(start);
  for (const move of moves) applyMove(board, move, size);
  return isSolved(board);
}
