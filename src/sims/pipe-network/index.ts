import type {
  BarPiece,
  ParamSchema,
  Params,
  SimContext,
  SimHost,
  SimInstance,
  SimModule,
  SimStatus,
} from '../../harness/types';
import { startNetwork, type Network, type NetworkBuild } from './generate';
import { drawNetwork, type PipeCell, type PipePending } from './render';
import { createSolver, type PipeSolver, type SolverTick } from './solver';
import { applyRotations, countLeaks } from './tiles';

const SOLVE_BUDGET = 4_000;

export const params: ParamSchema = {
  size: {
    type: 'number',
    label: 'Grid size',
    default: 8,
    min: 5,
    max: 30,
    step: 1,
    reset: true,
    group: 'Board',
  },
};

interface PipeParams {
  size: number;
}

type Phase = 'build' | 'solve' | 'done';

const BUILD_SLICE_MS = 8;

function create(ctx: SimContext, host: SimHost): SimInstance<Params> {
  let width = ctx.width;
  let height = ctx.height;
  let dpr = ctx.dpr;
  let context = ctx.canvas.getContext('2d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let settings = readParams(paramsDefault());
  let network: Network = emptyNetwork(settings.size);
  let build: NetworkBuild | null = null;
  let buildProgress = 0;
  let cells: PipeCell[] = [];
  let phase: Phase = 'build';
  let pending: PipePending | null = null;
  let facingTurns: { index: number; to: number; options: number; turn: boolean }[] = [];
  let deferred: Exclude<SolverTick, null> | null = null;
  let solver: PipeSolver | null = null;
  let decided = 0;
  let leaks = 0;
  let deductions = 0;
  let guesses = 0;
  let backtracks = 0;
  let depth = 0;
  let maxDepth = 0;
  let failed = false;
  let message = '';
  let solvedAt = 0;
  let runSeed = 1;

  function reset(all: Params, seed: number): void {
    runSeed = seed;
    settings = readParams(all);
    const count = settings.size * settings.size;
    network = emptyNetwork(settings.size);
    cells = [];
    for (let index = 0; index < count; index += 1) {
      cells.push({ present: false, rot: 0, options: 4, baseline: 4, role: 'open' });
    }
    pending = null;
    facingTurns = [];
    deferred = null;
    solver = null;
    decided = 0;
    leaks = 0;
    deductions = 0;
    guesses = 0;
    backtracks = 0;
    depth = 0;
    maxDepth = 0;
    failed = false;
    message = '';
    solvedAt = 0;
    phase = 'build';
    build = startNetwork(settings.size, seed, false);
    buildProgress = 0;
    pumpBuild();
  }

  function pumpBuild(): void {
    if (!build || phase !== 'build') return;
    const started = performance.now();
    let finished: Network | null = null;
    while (performance.now() - started < BUILD_SLICE_MS) {
      finished = build.advance(512);
      buildProgress = build.progress;
      if (finished) break;
    }
    if (!finished) return;
    network = finished;
    build = null;
    placeScrambled();
    beginSolve();
  }

  function placeScrambled(): void {
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index]!;
      cell.present = true;
      cell.rot = network.scramble[index]!;
      cell.options = 4;
      cell.role = 'open';
    }
    recomputeLeaks();
  }

  function beginSolve(): void {
    phase = 'solve';
    solver = createSolver(network.mask, network.size, network.wrap, network.scramble, runSeed);
    decided = 0;
    pending = null;
    facingTurns = [];
    deferred = null;
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index]!;
      cell.options = 4;
      cell.baseline = optionCount(solver.remaining(index));
    }
  }

  function finish(): void {
    snapshot();
    phase = 'done';
    solver = null;
    pending = null;
    facingTurns = [];
    deferred = null;
    failed = false;
    solvedAt = performance.now();
    message = summary();
    recomputeLeaks();
  }

  function fail(text: string): void {
    snapshot();
    phase = 'done';
    pending = null;
    facingTurns = [];
    deferred = null;
    failed = true;
    solvedAt = performance.now();
    message = text;
  }

  function step(): void {
    if (phase === 'done') return;
    if (phase === 'build') {
      pumpBuild();
      return;
    }
    if (pending === null) {
      if (phase === 'solve') pullSolve();
      return;
    }
    commit();
    if (phase === 'solve') pullSolve();
  }

  function commit(): void {
    if (!pending) return;
    if (pending.type === 'lock') {
      const cell = cells[pending.index]!;
      cell.rot = pending.to;
      cell.role = pending.kind;
      cell.options = 1;
      decided += 1;
    } else if (pending.type === 'unlock') {
      const cell = cells[pending.index]!;
      cell.rot = pending.to;
      cell.role = 'open';
      cell.options = pending.options;
      decided -= 1;
    } else if (pending.type === 'turn') {
      const cell = cells[pending.index]!;
      cell.rot = pending.to;
      cell.options = pending.options;
    } else {
      const cell = cells[pending.index]!;
      cell.options = pending.options;
    }
    pending = null;
    recomputeLeaks();
  }

  function pullSolve(): void {
    if (!solver || phase !== 'solve') return;
    if (startQueuedTurn()) return;
    if (deferred) {
      const tick = deferred;
      deferred = null;
      presentTick(tick);
      return;
    }
    const tick = solver.next(SOLVE_BUDGET);
    snapshot();
    const skip = tick !== null && typeof tick === 'object' ? tick.index : -1;
    collectFacing(skip);
    if (facingTurns.length > 0) {
      if (tick !== null) deferred = tick;
      startQueuedTurn();
      return;
    }
    if (tick === null) {
      pending = null;
      return;
    }
    presentTick(tick);
  }

  function startQueuedTurn(): boolean {
    const next = facingTurns.shift();
    if (!next || !solver) return false;
    const cell = cells[next.index]!;
    pending = next.turn
      ? { type: 'turn', index: next.index, from: cell.rot, to: next.to, options: next.options }
      : { type: 'tint', index: next.index, options: next.options };
    return true;
  }

  function collectFacing(skip: number): void {
    if (!solver) return;
    const facing = solver.facing;
    for (let index = 0; index < cells.length; index += 1) {
      if (index === skip) continue;
      const cell = cells[index]!;
      if (cell.role !== 'open') continue;
      const count = optionCount(solver.remaining(index));
      const painted = paintCount(count, cell.baseline);
      const to = facing[index]!;
      if (cell.rot !== to && count > 1) {
        facingTurns.push({ index, to, options: painted, turn: true });
        continue;
      }
      if (painted < 4 && cell.options >= 4) {
        facingTurns.push({ index, to: cell.rot, options: painted, turn: false });
        continue;
      }
      if (painted < 4) cell.options = painted;
    }
  }

  function presentTick(tick: Exclude<SolverTick, null>): void {
    if (tick === 'solved') {
      finish();
      return;
    }
    if (tick === 'failed') {
      fail('Solver stopped before every pipe was connected.');
      return;
    }
    const cell = cells[tick.index]!;
    if (tick.type === 'lock') {
      pending = { type: 'lock', index: tick.index, from: cell.rot, to: tick.rotation, kind: tick.kind };
      return;
    }
    pending = {
      type: 'unlock',
      index: tick.index,
      from: cell.rot,
      to: solver!.facing[tick.index]!,
      options: paintCount(optionCount(solver!.remaining(tick.index)), cell.baseline),
    };
  }

  function snapshot(): void {
    if (!solver) return;
    deductions = solver.deductions;
    guesses = solver.guesses;
    backtracks = solver.backtracks;
    depth = solver.depth;
    maxDepth = solver.maxDepth;
  }

  function recomputeLeaks(): void {
    const count = cells.length;
    const present = new Uint8Array(count);
    const rotation = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      const cell = cells[index]!;
      rotation[index] = cell.rot;
      if (cell.present) present[index] = 1;
    }
    leaks = countLeaks(applyRotations(network.mask, rotation), network.size, network.wrap, present);
  }

  function render(alpha: number): void {
    if (!context) return;
    drawNetwork(context, {
      cells,
      base: network.mask,
      size: network.size,
      pending,
      alpha,
      width,
      height,
      dpr,
      solvedAt: phase === 'done' && !failed ? solvedAt : 0,
      reducedMotion,
    });
  }

  function toolbar(): BarPiece[] {
    return host.transport();
  }

  function getStatus(): SimStatus {
    const leakPiece: BarPiece = { type: 'metric', id: 'leaks', label: 'Leaks', value: leaks };
    const total = cells.length;
    if (phase === 'build') {
      return {
        done: false,
        computing: true,
        row: [
          { type: 'label', id: 'phase', text: 'Building' },
          { type: 'progress', id: 'progress', value: buildProgress },
        ],
      };
    }
    if (phase === 'solve') {
      return {
        done: false,
        computing: pending === null,
        span: pending?.type === 'tint' ? 0.5 : undefined,
        row: [
          { type: 'label', id: 'phase', text: 'Solving' },
          { type: 'progress', id: 'progress', value: total === 0 ? 0 : decided / total },
          leakPiece,
        ],
        aside: solveAside(),
      };
    }
    const title = failed ? 'Stuck' : 'Solved';
    return {
      done: true,
      note: message,
      banner: title,
      row: [
        { type: 'label', id: 'phase', text: title },
        { type: 'progress', id: 'progress', value: 1 },
        leakPiece,
      ],
      aside: solveAside(),
    };
  }

  function solveAside(): BarPiece[] {
    return [
      { type: 'readout', id: 'deductions', label: 'deduced', value: String(deductions) },
      { type: 'readout', id: 'guesses', label: 'guesses', value: String(guesses) },
      { type: 'readout', id: 'backtracks', label: 'backtracks', value: String(backtracks) },
      { type: 'readout', id: 'depth', label: 'depth', value: String(phase === 'solve' ? depth : maxDepth) },
    ];
  }

  function summary(): string {
    const grid = `${network.size}×${network.size}`;
    const tail = `${backtracks} backtrack${backtracks === 1 ? '' : 's'}`;
    if (guesses === 0) return `${grid} · ${deductions} deductions · ${tail}`;
    const per = deductions / guesses;
    const ratio = per >= 10 ? per.toFixed(0) : per.toFixed(1);
    return `${grid} · ${ratio} deductions per guess · ${tail}`;
  }

  return {
    reset,
    step,
    render,
    getStatus,
    toolbar,
    resize(nextWidth, nextHeight, nextDpr) {
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
    },
    dispose() {
      solver = null;
      context = null;
    },
  };
}

function paramsDefault(): Params {
  const values: Params = {};
  for (const [key, def] of Object.entries(params)) values[key] = def.default;
  return values;
}

function readParams(all: Params): PipeParams {
  return {
    size: clamp(Math.round(numberParam(all.size, 8)), 5, 30),
  };
}

/** 4 stays iron. A count below the tile's own starting set, and still above one, is in progress. */
function paintCount(count: number, baseline: number): number {
  if (count >= baseline || count <= 1) return 4;
  return count;
}

function optionCount(mask: number): number {
  let count = 0;
  let bits = mask;
  while (bits) {
    count += 1;
    bits &= bits - 1;
  }
  return count;
}

function emptyNetwork(size: number): Network {
  const count = size * size;
  return {
    size,
    wrap: false,
    mask: new Uint8Array(count),
    solution: new Uint8Array(count),
    scramble: new Uint8Array(count),
    source: -1,
    growth: new Uint16Array(0),
  };
}

function numberParam(value: Params[string] | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const sim: SimModule = { params, create };
