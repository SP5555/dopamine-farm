import {
  MOVES,
  delta,
  heuristic,
  isLegal,
  opposite,
  packState,
  type Move,
} from '../board';
import { createHeap } from './heap';
import type { Search } from './search';

export function createWeightedAStar(start: Uint8Array, size: number, weight: number): Search {
  const boards: Uint8Array[] = [new Uint8Array(start)];
  const blanks: number[] = [start.indexOf(0)];
  const costs: number[] = [0];
  const parents: number[] = [-1];
  const arrivedBy: number[] = [-1];
  const bestG = new Map<bigint, number>();
  const closed = new Set<bigint>();
  const heap = createHeap();
  let sequence = 1;
  let nodes = 0;
  let found = false;
  let failed = false;
  let goalIndex = -1;
  let started = 0;
  let elapsedMs = 0;

  const rootKey = packState(boards[0]!);
  const rootH = heuristic(boards[0]!, size);
  bestG.set(rootKey, 0);
  heap.push({ f: weight * rootH, g: 0, seq: 0, index: 0 });

  const solution = (): Move[] => {
    if (!found || goalIndex < 0) return [];
    const moves: Move[] = [];
    let index = goalIndex;
    while (parents[index] !== -1) {
      moves.push(arrivedBy[index] as Move);
      index = parents[index]!;
    }
    moves.reverse();
    return moves;
  };

  return {
    step(maxNodes = 5000) {
      if (found || failed) return;
      if (started === 0) started = performance.now();
      let expanded = 0;
      while (expanded < maxNodes && heap.size > 0) {
        const item = heap.pop();
        if (!item) break;
        const index = item.index;
        const board = boards[index]!;
        const key = packState(board);
        if (closed.has(key) || bestG.get(key) !== item.g) continue;

        closed.add(key);
        expanded += 1;
        nodes += 1;
        const h = heuristic(board, size);
        if (h === 0) {
          found = true;
          goalIndex = index;
          break;
        }

        const blank = blanks[index]!;
        const g = costs[index]!;
        const previous = arrivedBy[index]!;
        for (const move of MOVES) {
          if (previous !== -1 && move === opposite(previous as Move)) continue;
          if (!isLegal(blank, move, size)) continue;
          const to = blank + delta(move, size);
          const next = new Uint8Array(board);
          next[blank] = next[to]!;
          next[to] = 0;
          const childKey = packState(next);
          const childG = g + 1;
          const known = bestG.get(childKey);
          if (known !== undefined && known <= childG) continue;
          if (closed.has(childKey)) {
            if (weight !== 1) continue;
            closed.delete(childKey);
          }
          const childIndex = boards.length;
          boards.push(next);
          blanks.push(to);
          costs.push(childG);
          parents.push(index);
          arrivedBy.push(move);
          bestG.set(childKey, childG);
          heap.push({
            f: childG + weight * heuristic(next, size),
            g: childG,
            seq: sequence,
            index: childIndex,
          });
          sequence += 1;
        }
      }
      if (!found && heap.size === 0) failed = true;
      elapsedMs = performance.now() - started;
    },
    solution,
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
      return heap.size;
    },
    get elapsedMs() {
      return elapsedMs;
    },
  };
}
