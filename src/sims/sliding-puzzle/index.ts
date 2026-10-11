import type {
  ParamSchema,
  Params,
  SimContext,
  SimHost,
  SimInstance,
  SimModule,
  SimStatus,
  BarPiece,
} from '../../harness/types';
import {
  applyMove,
  manhattan,
  solvedBoard,
  type Move,
} from './board';
import { formatCount, formatSeconds } from './format';
import { drawPuzzle } from './render';
import { uniformScramble, walkScramble } from './scramble';
import { applyLegal, legalize, solverOptionAvailable } from './limits';
import { createHumanSolver } from './solvers/human';
import { createIdaStar } from './solvers/ida-star';
import type { Search } from './solvers/search';
import { createWeightedAStar } from './solvers/weighted-astar';

const SEARCH_CHUNK = 5000;

export const params: ParamSchema = {
  size: {
    type: 'select',
    label: 'Size',
    default: '4',
    reset: true,
    options: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((size) => ({
      value: String(size),
      label: `${size}×${size}`,
    })),
  },
  showNumbers: {
    type: 'boolean',
    label: 'Numbers',
    default: true,
  },
  scramble: {
    type: 'select',
    label: 'Scramble',
    default: 'walk',
    reset: true,
    options: [
      {
        value: 'walk',
        label: 'Random walk',
        detail: 'Starts from solved and takes random slides, so the board stays nearby.',
      },
      {
        value: 'uniform',
        label: 'Uniform random',
        detail: 'Picks any solvable board, including the hardest ones.',
      },
    ],
    group: 'Scrambler',
  },
  walkLength: {
    type: 'number',
    label: 'Walk length',
    default: 50,
    min: 10,
    max: 200,
    step: 1,
    reset: true,
    when: (current) => current.scramble === 'walk',
    group: 'Scrambler',
  },
  animateScramble: {
    type: 'boolean',
    label: 'Animate scramble',
    default: true,
    reset: true,
    group: 'Scrambler',
  },
  solver: {
    type: 'select',
    label: 'Solver',
    default: 'wastar',
    reset: true,
    options: [
      {
        value: 'ida',
        label: 'Optimal (IDA*)',
        detail: 'Looks for one of the shortest solutions.',
      },
      {
        value: 'wastar',
        label: 'Fast (weighted A*)',
        detail: 'Finds a short solution quickly, usually a little longer than the shortest.',
      },
      {
        value: 'human',
        label: 'Human (placement)',
        detail: 'Places each tile on a fixed plan, so any size can finish.',
      },
    ],
    available: solverOptionAvailable,
    group: 'Solver',
  },
  order: {
    type: 'select',
    label: 'Order',
    default: 'rows',
    reset: true,
    options: [
      {
        value: 'rows',
        label: 'Rows',
        detail: 'Finishes each row from the top before starting the next.',
      },
      {
        value: 'inward',
        label: 'Inward',
        detail: 'Finishes a row, then the column beside it, and repeats toward the corner.',
      },
    ],
    when: (current) => current.solver === 'human',
    group: 'Solver',
  },
  weight: {
    type: 'number',
    label: 'Weight',
    default: 2,
    min: 1,
    max: 5,
    step: 0.1,
    reset: true,
    when: (current) => current.solver === 'wastar',
    group: 'Solver',
  },
  nodeBudget: {
    type: 'number',
    label: 'Node budget',
    default: 2e7,
    min: 1e6,
    max: 5e7,
    step: 1e6,
    reset: true,
    when: (current) => current.solver === 'ida',
    group: 'Solver',
  },
};

interface PuzzleParams {
  size: number;
  scramble: 'walk' | 'uniform';
  walkLength: number;
  solver: 'ida' | 'wastar' | 'human';
  order: 'rows' | 'inward';
  weight: number;
  nodeBudget: number;
  animateScramble: boolean;
  showNumbers: boolean;
}

type Phase = 'scramble' | 'search' | 'play' | 'solved';

function create(ctx: SimContext, host: SimHost): SimInstance<Params> {
  let width = ctx.width;
  let height = ctx.height;
  let dpr = ctx.dpr;
  let context = ctx.canvas.getContext('2d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let settings = readParams(paramsDefault());
  let size = 4;
  let board = solvedBoard(4);
  let scrambled = board;
  let phase: Phase = 'scramble';
  let walkMoves: Move[] = [];
  let walkIndex = 0;
  let uniformFrames: Uint8Array[] = [];
  let uniformIndex = 0;
  let pendingMove: Move | null = null;
  let fadeTo: Uint8Array | null = null;
  let search: Search | null = null;
  let solution: Move[] = [];
  let playIndex = 0;
  let optimal = false;
  let fellBack = false;
  let failed = false;
  let baseNodes = 0;
  let baseMs = 0;
  let nodes = 0;
  let searchMs = 0;
  let metricValue = 0;
  let message: string | undefined;
  let solvedAt = 0;
  let showNumbers = true;

  function reset(all: Params, _seed: number): void {
    settings = readParams(all);
    size = settings.size;
    showNumbers = settings.showNumbers;
    search = null;
    solution = [];
    playIndex = 0;
    pendingMove = null;
    fadeTo = null;
    fellBack = false;
    failed = false;
    baseNodes = 0;
    baseMs = 0;
    nodes = 0;
    searchMs = 0;
    message = undefined;
    solvedAt = 0;
    walkMoves = [];
    walkIndex = 0;
    uniformFrames = [];
    uniformIndex = 0;

    const solved = solvedBoard(size);
    if (settings.scramble === 'uniform') {
      const uniform = uniformScramble(size, _seed);
      scrambled = uniform.finalBoard;
      if (settings.animateScramble) {
        phase = 'scramble';
        uniformFrames = uniform.frames;
        board = solved;
        fadeTo = uniformFrames[0] ?? null;
        metricValue = manhattan(board, size);
      } else {
        board = new Uint8Array(scrambled);
        beginSearch();
      }
    } else {
      const walk = walkScramble(size, settings.walkLength, _seed);
      scrambled = walk.finalBoard;
      walkMoves = walk.moves;
      if (settings.animateScramble && walkMoves.length > 0) {
        phase = 'scramble';
        board = solved;
        pendingMove = walkMoves[0] ?? null;
        metricValue = manhattan(board, size);
      } else {
        board = new Uint8Array(scrambled);
        beginSearch();
      }
    }
  }

  function beginSearch(): void {
    phase = 'search';
    pendingMove = null;
    fadeTo = null;
    board = new Uint8Array(scrambled);
    metricValue = manhattan(board, size);
    if (settings.solver === 'ida') search = createIdaStar(scrambled, size, settings.nodeBudget);
    else if (settings.solver === 'human') search = createHumanSolver(scrambled, size, settings.order);
    else search = createWeightedAStar(scrambled, size, settings.weight);
  }

  function beginPlayback(): void {
    if (!search) return;
    nodes = baseNodes + search.nodes;
    searchMs = baseMs + search.elapsedMs;
    solution = search.solution();
    search = null;
    optimal =
      !fellBack && (settings.solver === 'ida' || (settings.solver === 'wastar' && settings.weight === 1));
    board = new Uint8Array(scrambled);
    playIndex = 0;
    metricValue = manhattan(board, size);
    if (solution.length === 0) {
      finish();
      return;
    }
    phase = 'play';
    pendingMove = solution[0] ?? null;
  }

  function finish(): void {
    phase = 'solved';
    pendingMove = null;
    fadeTo = null;
    metricValue = manhattan(board, size);
    solvedAt = performance.now();
    failed = false;
    message = `${solution.length} moves · ${optimal ? 'optimal' : 'not optimal'} · ${formatCount(nodes)} nodes · ${formatSeconds(searchMs)} search`;
  }

  function fail(text: string): void {
    phase = 'solved';
    pendingMove = null;
    fadeTo = null;
    failed = true;
    solvedAt = performance.now();
    message = text;
  }

  function step(): void {
    if (phase === 'solved') return;
    if (phase === 'scramble') stepScramble();
    else if (phase === 'search') stepSearch();
    else stepPlay();
  }

  function stepScramble(): void {
    if (settings.scramble === 'walk') {
      if (pendingMove === null) {
        beginSearch();
        return;
      }
      applyMove(board, pendingMove, size);
      walkIndex += 1;
      pendingMove = walkMoves[walkIndex] ?? null;
      metricValue = manhattan(board, size);
      if (pendingMove === null) beginSearch();
      return;
    }

    const frame = uniformFrames[uniformIndex];
    if (!frame) {
      beginSearch();
      return;
    }
    board = new Uint8Array(frame);
    uniformIndex += 1;
    metricValue = manhattan(board, size);
    if (uniformIndex >= uniformFrames.length) beginSearch();
    else fadeTo = uniformFrames[uniformIndex] ?? null;
  }

  function stepSearch(): void {
    if (!search) return;
    search.step(SEARCH_CHUNK);
    nodes = baseNodes + search.nodes;
    searchMs = baseMs + search.elapsedMs;
    if (search.found) {
      beginPlayback();
      return;
    }
    if (search.aborted && settings.solver === 'ida' && !fellBack) {
      fellBack = true;
      baseNodes = nodes;
      baseMs = searchMs;
      message =
        'IDA* exceeded node budget, fell back to weighted A* (w=2.0), so the solution may not be optimal.';
      search = createWeightedAStar(scrambled, size, 2);
      return;
    }
    if (search.failed || search.aborted) fail('No solution found.');
  }

  function stepPlay(): void {
    if (pendingMove === null) {
      finish();
      return;
    }
    applyMove(board, pendingMove, size);
    playIndex += 1;
    pendingMove = solution[playIndex] ?? null;
    metricValue = manhattan(board, size);
    if (pendingMove === null) finish();
  }

  function render(alpha: number): void {
    if (!context) return;
    drawPuzzle(context, {
      board,
      size,
      width,
      height,
      dpr,
      pendingMove,
      alpha,
      showNumbers,
      fadeTo: phase === 'scramble' ? fadeTo : null,
      solvedAt: phase === 'solved' && !failed ? solvedAt : 0,
      reducedMotion,
    });
  }

  function toolbar(): BarPiece[] {
    return host.transport();
  }

  function getStatus(): SimStatus {
    const manhattan: BarPiece = { type: 'metric', id: 'manhattan', label: 'Manhattan', value: metricValue };
    const solvedAside = (): BarPiece[] => [
      { type: 'readout', id: 'moves', label: 'moves', value: String(solution.length) },
      { type: 'readout', id: 'optimal', label: 'optimal', value: optimal ? 'yes' : 'no' },
      { type: 'readout', id: 'solver', label: 'solver', value: solverLabel() },
      { type: 'readout', id: 'nodes', label: 'nodes', value: formatCount(nodes) },
    ];

    if (phase === 'scramble') {
      const total = settings.scramble === 'walk' ? walkMoves.length : uniformFrames.length;
      const cursor = settings.scramble === 'walk' ? walkIndex : uniformIndex;
      return {
        done: false,
        note: message,
        row: [
          { type: 'label', id: 'phase', text: 'Scrambling' },
          { type: 'progress', id: 'progress', value: total === 0 ? 0 : cursor / total },
          manhattan,
        ],
        aside: [{ type: 'readout', id: 'move', label: 'move', value: `${cursor}/${total}` }],
      };
    }

    if (phase === 'search' && search) {
      nodes = baseNodes + search.nodes;
      searchMs = baseMs + search.elapsedMs;
      const seconds = searchMs / 1000;
      const rate = seconds > 0.05 ? nodes / seconds : 0;
      return {
        done: false,
        computing: true,
        note: message,
        row: [
          { type: 'label', id: 'phase', text: 'Searching' },
          { type: 'progress', id: 'progress', value: null },
          manhattan,
        ],
        aside: [
          { type: 'readout', id: 'nodes', label: 'nodes', value: formatCount(nodes) },
          { type: 'readout', id: 'rate', label: 'nodes/s', value: seconds > 0.05 ? formatCount(rate) : '—' },
          ...(search.bound !== null
            ? [{ type: 'readout' as const, id: 'bound', label: 'bound', value: String(search.bound) }]
            : []),
          ...(search.openSize !== null
            ? [{ type: 'readout' as const, id: 'open', label: 'open', value: String(search.openSize) }]
            : []),
          { type: 'readout', id: 'time', label: 'time', value: formatSeconds(searchMs) },
        ],
      };
    }

    if (phase === 'play') {
      const left = solution.length - playIndex;
      const row: BarPiece[] = [
        { type: 'label', id: 'phase', text: 'Playing' },
        { type: 'progress', id: 'progress', value: solution.length === 0 ? 1 : playIndex / solution.length },
      ];
      if (left > 0 && host.speed > 0) {
        row.push({ type: 'readout', id: 'left', label: 'left', value: formatRemaining(left / host.speed) });
      }
      row.push(manhattan);
      return {
        done: false,
        note: message,
        row,
        aside: [
          { type: 'readout', id: 'moves', label: 'moves', value: `${playIndex}/${solution.length}` },
          { type: 'readout', id: 'optimal', label: 'optimal', value: optimal ? 'yes' : 'no' },
          { type: 'readout', id: 'solver', label: 'solver', value: solverLabel() },
          { type: 'readout', id: 'nodes', label: 'nodes', value: formatCount(nodes) },
        ],
      };
    }

    const title = failed ? 'Stopped' : 'Solved';
    return {
      done: true,
      note: message,
      banner: title,
      row: [
        { type: 'label', id: 'phase', text: title },
        { type: 'progress', id: 'progress', value: 1 },
        manhattan,
      ],
      aside: solvedAside(),
    };
  }

  function solverLabel(): string {
    if (fellBack) return 'A* w=2 fallback';
    if (settings.solver === 'ida') return 'IDA*';
    if (settings.solver === 'human') return settings.order === 'inward' ? 'Human inward' : 'Human rows';
    return `A* w=${settings.weight.toFixed(1)}`;
  }

  return {
    reset,
    step,
    render,
    getStatus,
    toolbar,
    setParams(_changed, all) {
      const next = readParams(all);
      settings = { ...settings, showNumbers: next.showNumbers };
      showNumbers = next.showNumbers;
    },
    resize(nextWidth, nextHeight, nextDpr) {
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
    },
    dispose() {
      search = null;
      context = null;
    },
  };
}

function paramsDefault(): Params {
  const values: Params = {};
  for (const [key, def] of Object.entries(params)) values[key] = def.default;
  return values;
}

function readParams(all: Params): PuzzleParams {
  const legal = legalize(all);
  return {
    size: legal.size,
    scramble: legal.scramble,
    walkLength: legal.walkLength,
    solver: legal.solver,
    order: legal.order,
    weight: legal.weight,
    nodeBudget: clamp(Math.round(numberParam(all.nodeBudget, 2e7)), 1e6, 5e7),
    animateScramble: Boolean(all.animateScramble),
    showNumbers: Boolean(all.showNumbers),
  };
}

function numberParam(value: Params[string] | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatRemaining(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 1) return `${rest}s`;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

export const sim: SimModule = { params, normalize: applyLegal, create };
