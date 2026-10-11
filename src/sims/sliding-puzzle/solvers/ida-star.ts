import {
  delta,
  isLegal,
  linearConflict,
  manhattan,
  manhattanTable,
  opposite,
  type Move,
} from '../board';
import type { Search } from './search';

const MAX_DEPTH = 128;

export function createIdaStar(start: Uint8Array, size: number, nodeBudget: number): Search {
  const board = new Uint8Array(start);
  let blank = board.indexOf(0);
  const cells = size * size;
  const distances = manhattanTable(size);
  let man = manhattan(board, size);

  const prevStack = new Int16Array(MAX_DEPTH);
  const gStack = new Int16Array(MAX_DEPTH);
  const nextStack = new Int8Array(MAX_DEPTH);
  let sp = 0;

  let threshold = man + 2 * linearConflict(board, size);
  let nextThreshold = Number.POSITIVE_INFINITY;
  let nodes = 0;
  let found = false;
  let aborted = false;
  let failed = false;
  const path: Move[] = [];
  let started = 0;
  let elapsedMs = 0;

  const score = () => man + 2 * linearConflict(board, size);

  const apply = (move: Move) => {
    const to = blank + delta(move, size);
    const tile = board[to]!;
    man += distances[tile * cells + blank]! - distances[tile * cells + to]!;
    board[blank] = tile;
    board[to] = 0;
    blank = to;
  };

  const undo = () => {
    const move = path.pop();
    if (move !== undefined) apply(opposite(move));
  };

  const pushRoot = () => {
    prevStack[0] = -1;
    gStack[0] = 0;
    nextStack[0] = 0;
    sp = 1;
    path.length = 0;
  };

  pushRoot();

  return {
    step(maxNodes = 5000) {
      if (found || aborted || failed) return;
      if (started === 0) started = performance.now();
      let visits = 0;
      while (visits < maxNodes && !found && !aborted && !failed) {
        if (sp === 0) {
          if (!Number.isFinite(nextThreshold)) {
            failed = true;
            break;
          }
          threshold = nextThreshold;
          nextThreshold = Number.POSITIVE_INFINITY;
          pushRoot();
          continue;
        }

        visits += 1;
        const frame = sp - 1;
        const child = nextStack[frame]!;
        if (child === 0) {
          const h = score();
          const f = gStack[frame]! + h;
          if (f > threshold) {
            if (f < nextThreshold) nextThreshold = f;
            sp -= 1;
            if (sp > 0) undo();
            continue;
          }
          nodes += 1;
          if (h === 0) {
            found = true;
            break;
          }
          if (nodes > nodeBudget) {
            aborted = true;
            break;
          }
        }

        if (child > 3) {
          sp -= 1;
          if (sp > 0) undo();
          continue;
        }

        nextStack[frame] = child + 1;
        const move = child as Move;
        const previous = prevStack[frame]!;
        if ((previous !== -1 && move === opposite(previous as Move)) || !isLegal(blank, move, size)) {
          continue;
        }
        if (sp >= MAX_DEPTH) continue;

        apply(move);
        path.push(move);
        prevStack[sp] = move;
        gStack[sp] = gStack[frame]! + 1;
        nextStack[sp] = 0;
        sp += 1;
      }
      elapsedMs = performance.now() - started;
    },
    solution() {
      return path.slice();
    },
    get found() {
      return found;
    },
    get aborted() {
      return aborted;
    },
    get failed() {
      return failed;
    },
    get nodes() {
      return nodes;
    },
    get bound() {
      return threshold;
    },
    get openSize() {
      return null;
    },
    get elapsedMs() {
      return elapsedMs;
    },
  };
}
