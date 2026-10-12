import { createRng } from '../../harness/author';
import { degree, neighbor, opposite, rotateMask, uniqueRotations } from './tiles';

export type SolveEvent =
  | { type: 'lock'; index: number; rotation: number; kind: 'deduction' | 'contingent' | 'guess' }
  | { type: 'unlock'; index: number };

export type SolverTick = SolveEvent | 'solved' | 'failed' | null;

interface TrailEntry {
  index: number;
  prev: number;
  prevKind: number;
  prevAnnounced: number;
  prevShown: number;
}

interface Frame {
  mark: number;
  index: number;
  remaining: number;
}

const OPEN = -1;
const DEDUCTION = 0;
const GUESS = 1;
/** Forced to one turn while a guess is still open. Released if that guess fails. */
const CONTINGENT = 2;

/**
 * Incremental Net solver. `next` returns one visible lock or unlock, `'solved'`,
 * `'failed'`, or `null` when the budget ran out mid-search.
 *
 * A rotation is pruned when it disagrees with every rotation a neighbor can
 * still take. Two dead ends facing each other are rejected on a board larger
 * than two cells. After each fixpoint, cycles and sealed islands in the
 * decided tiles are rejected, then the tile with the fewest remaining turns
 * is guessed.
 *
 * `facing` is the turn drawn for each tile. It stays put while that turn is
 * still possible, and otherwise picks one remaining turn. A backtrack restores
 * the turn that was showing before the failed branch.
 */
export interface PipeSolver {
  next(budget: number): SolverTick;
  readonly facing: Uint8Array;
  remaining(index: number): number;
  readonly deductions: number;
  readonly guesses: number;
  readonly backtracks: number;
  readonly depth: number;
  readonly maxDepth: number;
}

export function createSolver(
  base: Uint8Array,
  size: number,
  wrap: boolean,
  initial?: Uint8Array,
  seed = 1,
): PipeSolver {
  const count = size * size;
  const turned = new Uint8Array(count * 4);
  const possible = new Uint8Array(count);
  const kind = new Int8Array(count);
  const announced = new Uint8Array(count);
  kind.fill(OPEN);

  for (let index = 0; index < count; index += 1) {
    const mask = base[index]!;
    let bits = 0;
    for (const turn of uniqueRotations(mask)) {
      turned[index * 4 + turn] = rotateMask(mask, turn);
      bits |= 1 << turn;
    }
    for (let turn = 0; turn < 4; turn += 1) {
      if (turned[index * 4 + turn] === 0) turned[index * 4 + turn] = rotateMask(mask, turn);
    }
    possible[index] = bits;
  }

  const intro: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (popcount(possible[index]!) !== 1) continue;
    kind[index] = DEDUCTION;
    announced[index] = 1;
    intro.push(index);
  }

  const shown = new Uint8Array(count);
  const rng = createRng(seed);
  for (let index = 0; index < count; index += 1) {
    const start = initial?.[index] ?? 0;
    shown[index] = (possible[index]! & (1 << start)) !== 0 ? start : pickTurn(possible[index]!);
  }

  const trail: TrailEntry[] = [];
  const frames: Frame[] = [];
  const undoQueue: number[] = [];
  const queue: number[] = [];
  const inQueue = new Uint8Array(count);
  let queueHead = 0;
  let phase: 'intro' | 'propagate' | 'check' | 'branch' | 'retry' | 'solved' | 'failed' =
    intro.length > 0 ? 'intro' : 'propagate';
  let deductions = 0;
  let guesses = 0;
  let backtracks = 0;
  let maxDepth = 0;

  if (phase === 'propagate') enqueueAll();

  function maskAt(index: number, turn: number): number {
    return turned[index * 4 + turn]!;
  }

  function enqueue(index: number): void {
    if (inQueue[index]) return;
    inQueue[index] = 1;
    queue.push(index);
  }

  function enqueueAll(): void {
    for (let index = 0; index < count; index += 1) enqueue(index);
  }

  function dequeue(): number {
    const index = queue[queueHead]!;
    queueHead += 1;
    inQueue[index] = 0;
    if (queueHead > 64 && queueHead * 2 > queue.length) {
      queue.splice(0, queueHead);
      queueHead = 0;
    }
    return index;
  }

  function clearQueue(): void {
    while (queueHead < queue.length) {
      inQueue[queue[queueHead]!] = 0;
      queueHead += 1;
    }
    queue.length = 0;
    queueHead = 0;
  }

  function queueEmpty(): boolean {
    return queueHead >= queue.length;
  }

  function pickTurn(mask: number): number {
    const options: number[] = [];
    for (let turn = 0; turn < 4; turn += 1) {
      if ((mask & (1 << turn)) !== 0) options.push(turn);
    }
    return options[rng.int(options.length)]!;
  }

  function setMask(index: number, mask: number, nextKind: number, nextAnnounced: number): void {
    const current = shown[index]!;
    const nextShown = (mask & (1 << current)) !== 0 ? current : pickTurn(mask);
    if (
      possible[index] === mask &&
      kind[index] === nextKind &&
      announced[index] === nextAnnounced &&
      current === nextShown
    ) {
      return;
    }
    trail.push({
      index,
      prev: possible[index]!,
      prevKind: kind[index]!,
      prevAnnounced: announced[index]!,
      prevShown: current,
    });
    possible[index] = mask;
    kind[index] = nextKind;
    announced[index] = nextAnnounced;
    shown[index] = nextShown;
  }

  function allowed(index: number, turn: number): boolean {
    const mask = maskAt(index, turn);
    for (let dir = 0; dir < 4; dir += 1) {
      const open = (mask & (1 << dir)) !== 0;
      const next = neighbor(index, dir, size, wrap);
      if (next < 0) {
        if (open) return false;
        continue;
      }
      let anyOpen = false;
      let anyClosed = false;
      const bits = possible[next]!;
      for (let option = 0; option < 4; option += 1) {
        if ((bits & (1 << option)) === 0) continue;
        if ((maskAt(next, option) & (1 << opposite(dir))) !== 0) anyOpen = true;
        else anyClosed = true;
      }
      if (open && !anyOpen) return false;
      if (!open && !anyClosed) return false;
    }
    if (count > 2 && degree(base[index]!) === 1) {
      for (let dir = 0; dir < 4; dir += 1) {
        if ((mask & (1 << dir)) === 0) continue;
        const next = neighbor(index, dir, size, wrap);
        if (next >= 0 && degree(base[next]!) === 1) return false;
      }
    }
    return true;
  }

  function enqueueNeighbors(index: number): void {
    for (let dir = 0; dir < 4; dir += 1) {
      const next = neighbor(index, dir, size, wrap);
      if (next >= 0) enqueue(next);
    }
  }

  function prune(index: number): 'contradiction' | 'locked' | 'changed' | 'same' {
    const before = possible[index]!;
    let nextMask = 0;
    for (let turn = 0; turn < 4; turn += 1) {
      if ((before & (1 << turn)) !== 0 && allowed(index, turn)) nextMask |= 1 << turn;
    }
    if (nextMask === 0) return 'contradiction';
    if (nextMask === before) return 'same';
    const wasSingle = popcount(before) === 1;
    const nowSingle = popcount(nextMask) === 1;
    const nextKind = !wasSingle && nowSingle ? (frames.length > 0 ? CONTINGENT : DEDUCTION) : kind[index]!;
    const nextAnnounced = !wasSingle && nowSingle ? 1 : announced[index]!;
    setMask(index, nextMask, nextKind, nextAnnounced);
    return !wasSingle && nowSingle ? 'locked' : 'changed';
  }

  function globalOk(): boolean {
    const parent = new Int32Array(count);
    for (let index = 0; index < count; index += 1) parent[index] = index;
    const find = (start: number): number => {
      let cursor = start;
      while (parent[cursor] !== cursor) cursor = parent[cursor]!;
      let compress = start;
      while (parent[compress] !== cursor) {
        const next = parent[compress]!;
        parent[compress] = cursor;
        compress = next;
      }
      return cursor;
    };

    const decided = (index: number): boolean => popcount(possible[index]!) === 1;
    for (let index = 0; index < count; index += 1) {
      if (!decided(index)) continue;
      const mask = maskAt(index, lowbit(possible[index]!));
      for (let dir = 0; dir < 4; dir += 1) {
        const open = (mask & (1 << dir)) !== 0;
        const next = neighbor(index, dir, size, wrap);
        if (!open) {
          if (next >= 0 && decided(next)) {
            const facing = maskAt(next, lowbit(possible[next]!));
            if ((facing & (1 << opposite(dir))) !== 0) return false;
          }
          continue;
        }
        if (next < 0) return false;
        if (!decided(next)) continue;
        const facing = maskAt(next, lowbit(possible[next]!));
        if ((facing & (1 << opposite(dir))) === 0) return false;
        if (index < next) {
          const left = find(index);
          const right = find(next);
          if (left === right) return false;
          parent[right] = left;
        }
      }
    }

    const seen = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      if (!decided(index) || seen[index]) continue;
      const stack = [index];
      seen[index] = 1;
      let component = 0;
      let openOut = false;
      while (stack.length > 0) {
        const cell = stack.pop()!;
        component += 1;
        const mask = maskAt(cell, lowbit(possible[cell]!));
        for (let dir = 0; dir < 4; dir += 1) {
          if ((mask & (1 << dir)) === 0) continue;
          const next = neighbor(cell, dir, size, wrap);
          if (next < 0 || !decided(next)) {
            openOut = true;
            continue;
          }
          if (!seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
      if (!openOut && component < count) return false;
    }
    return true;
  }

  function allDecided(): boolean {
    for (let index = 0; index < count; index += 1) {
      if (popcount(possible[index]!) !== 1) return false;
    }
    return true;
  }

  function pickCell(): number {
    let best = -1;
    let bestCount = 5;
    for (let index = 0; index < count; index += 1) {
      const options = popcount(possible[index]!);
      if (options <= 1 || options >= bestCount) continue;
      best = index;
      bestCount = options;
    }
    return best;
  }

  function revertTo(mark: number): void {
    while (trail.length > mark) {
      const entry = trail.pop()!;
      if (announced[entry.index] === 1 && entry.prevAnnounced === 0) undoQueue.push(entry.index);
      possible[entry.index] = entry.prev;
      kind[entry.index] = entry.prevKind;
      announced[entry.index] = entry.prevAnnounced;
      shown[entry.index] = entry.prevShown;
    }
  }

  function startBacktrack(): void {
    clearQueue();
    const frame = frames[frames.length - 1];
    if (!frame) {
      phase = 'failed';
      return;
    }
    revertTo(frame.mark);
    backtracks += 1;
    if (frame.remaining === 0) {
      frames.pop();
      startBacktrack();
      return;
    }
    phase = 'retry';
  }

  function placeGuess(index: number, turn: number): SolveEvent {
    setMask(index, 1 << turn, GUESS, 1);
    guesses += 1;
    if (frames.length > maxDepth) maxDepth = frames.length;
    enqueue(index);
    enqueueNeighbors(index);
    phase = 'propagate';
    return { type: 'lock', index, rotation: turn, kind: 'guess' };
  }

  function lockEvent(index: number): SolveEvent {
    deductions += 1;
    const marked = kind[index] === CONTINGENT ? 'contingent' : 'deduction';
    return { type: 'lock', index, rotation: lowbit(possible[index]!), kind: marked };
  }

  return {
    get facing() {
      return shown;
    },
    remaining(index: number) {
      return possible[index]!;
    },
    get deductions() {
      return deductions;
    },
    get guesses() {
      return guesses;
    },
    get backtracks() {
      return backtracks;
    },
    get depth() {
      return frames.length;
    },
    get maxDepth() {
      return maxDepth;
    },
    next(budget: number): SolverTick {
      let used = 0;
      while (used < budget) {
        if (undoQueue.length > 0) return { type: 'unlock', index: undoQueue.shift()! };
        if (phase === 'failed') return 'failed';
        if (phase === 'solved') return 'solved';

        if (phase === 'intro') {
          const index = intro.shift()!;
          if (intro.length === 0) {
            phase = 'propagate';
            enqueueAll();
          }
          return lockEvent(index);
        }

        if (phase === 'retry') {
          const frame = frames[frames.length - 1];
          if (!frame) {
            phase = 'failed';
            return 'failed';
          }
          const turn = lowbit(frame.remaining);
          frame.remaining &= ~(1 << turn);
          frame.mark = trail.length;
          return placeGuess(frame.index, turn);
        }

        if (phase === 'propagate') {
          if (queueEmpty()) {
            phase = 'check';
            continue;
          }
          const index = dequeue();
          used += 1;
          const before = possible[index]!;
          const outcome = prune(index);
          if (outcome === 'contradiction') {
            startBacktrack();
            continue;
          }
          if (possible[index] !== before) enqueueNeighbors(index);
          if (outcome === 'locked') return lockEvent(index);
          continue;
        }

        if (phase === 'check') {
          used += count;
          if (!globalOk()) {
            startBacktrack();
            continue;
          }
          if (allDecided()) {
            phase = 'solved';
            return 'solved';
          }
          phase = 'branch';
          continue;
        }

        const index = pickCell();
        if (index < 0) {
          phase = 'solved';
          return 'solved';
        }
        const bits = possible[index]!;
        const turn = lowbit(bits);
        frames.push({
          mark: trail.length,
          index,
          remaining: bits & ~(1 << turn),
        });
        return placeGuess(index, turn);
      }
      return null;
    },
  };
}

export function collectSolve(
  base: Uint8Array,
  size: number,
  wrap: boolean,
): { events: SolveEvent[]; status: 'solved' | 'failed' } {
  const solver = createSolver(base, size, wrap);
  const events: SolveEvent[] = [];
  for (let step = 0; step < 500_000; step += 1) {
    const tick = solver.next(8_000);
    if (tick === null) continue;
    if (tick === 'solved' || tick === 'failed') return { events, status: tick };
    events.push(tick);
  }
  return { events, status: 'failed' };
}

function popcount(value: number): number {
  let count = 0;
  let bits = value;
  while (bits) {
    count += 1;
    bits &= bits - 1;
  }
  return count;
}

function lowbit(value: number): number {
  return 31 - Math.clz32(value & -value);
}
