import { createRng, randomSeed, type Rng } from '../../harness/author';
import type { BarPiece, ParamSchema, Params, SimContext, SimHost, SimInstance, SimModule, SimStatus } from '../../harness/types';
import { chooseRemoval, collectAddable, collectRemovable, isOrder, type Order } from './heightmap';
import { ANIMATIONS, PALETTES, animationById, drawLozenges, type AnimationId } from './render';

const OPEN_SPEED = 2;
/** The finale holds the clock for this many speed ticks. `alpha` still runs 0 to 1 across all of them. */
const SPIN_TICKS = 3;

export const params: ParamSchema = {
  size: {
    type: 'number',
    label: 'Size',
    default: 10,
    min: 3,
    max: 30,
    step: 1,
    reset: true,
  },
  order: {
    type: 'select',
    label: 'Order',
    default: 'random',
    reset: true,
    group: 'Run',
    options: [
      { value: 'random', label: 'Random', detail: 'Uniform among the cubes that can move now.' },
      { value: 'nearest', label: 'Nearest corner', detail: 'The legal cube closest to the front corner.' },
      { value: 'layers', label: 'Layer by layer', detail: 'Tallest legal cubes first, then toward the front.' },
      { value: 'diagonal', label: 'Diagonal sweep', detail: 'Front diagonals first, one wave at a time.' },
    ],
  },
  mode: {
    type: 'select',
    label: 'Mode',
    default: 'removal',
    group: 'Run',
    options: [
      {
        value: 'removal',
        label: 'Removal',
        detail: 'Take cubes away, then spin the empty box back to full. A move on screen finishes first.',
      },
      {
        value: 'addition',
        label: 'Addition',
        detail: 'Put cubes back, then spin the full box back to empty. A move on screen finishes first.',
      },
    ],
  },
  palette: {
    type: 'select',
    label: 'Palette',
    default: 'amber',
    group: 'Look',
    options: PALETTES.map((item) => ({ value: item.id, label: item.label, detail: item.detail })),
  },
  animation: {
    type: 'select',
    label: 'Animation',
    default: 'rotate',
    group: 'Look',
    options: ANIMATIONS.map((item) => ({ value: item.id, label: item.label, detail: item.detail })),
  },
};

type Mode = 'removal' | 'addition';

interface BoxSettings {
  size: number;
  order: Order;
  mode: Mode;
  palette: string;
  animation: AnimationId;
}

type Pending =
  | { kind: 'cube'; packed: number; flip: 1 | -1 }
  | { kind: 'spin'; sign: number; mode: Mode };

function create(ctx: SimContext, host: SimHost): SimInstance<Params> {
  host.setSpeed(OPEN_SPEED);

  let width = ctx.width;
  let height = ctx.height;
  let dpr = ctx.dpr;
  let context = ctx.canvas.getContext('2d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let box = readParams(paramsDefault());
  let heights = new Uint8Array(0);
  let rng: Rng = createRng(1);
  const scratch: number[] = [];
  let pending: Pending | null = null;
  let frontier = 0;
  /** Speed ticks the event on screen lasts. Set when that event is armed, and left alone until it commits. */
  let clock = 1;
  /** Which pass this trace belongs to. A finale starts the next one. */
  let pass = 0;
  /** Alpha of the latest frame. A move with alpha above 0 has started, so a mode change lets it finish. */
  let loopAlpha = 0;

  function reset(all: Params): void {
    box = readParams(all);
    const count = box.size * box.size;
    if (heights.length !== count) heights = new Uint8Array(count);
    reseed();
    beginPass();
  }

  function reseed(): void {
    rng = createRng(randomSeed());
  }

  function beginPass(): void {
    pass = 0;
    heights.fill(box.mode === 'removal' ? box.size : 0);
    armNext();
  }

  function cubeTotal(): number {
    return box.size * box.size * box.size;
  }

  function absent(): number {
    let missing = 0;
    const n = box.size;
    for (const height of heights) missing += n - height;
    return missing;
  }

  function shouldAnimate(): boolean {
    return box.animation === 'rotate' && !reducedMotion;
  }

  function armNext(): void {
    if (heights.length === 0) {
      pending = null;
      frontier = 0;
      clock = 1;
      return;
    }
    const n = box.size;
    if (box.mode === 'removal') {
      frontier = collectRemovable(heights, n, n, scratch);
      if (frontier === 0) {
        armSpin(-1);
        return;
      }
    } else {
      frontier = collectAddable(heights, n, n, n, scratch);
      if (frontier === 0) {
        armSpin(1);
        return;
      }
    }
    clock = 1;
    const flip: 1 | -1 = box.mode === 'removal' ? 1 : -1;
    pending = { kind: 'cube', packed: chooseRemoval(box.order, heights, n, n, scratch, frontier, rng), flip };
  }

  function armSpin(sign: number): void {
    clock = shouldAnimate() ? SPIN_TICKS : 1;
    pending = { kind: 'spin', sign, mode: box.mode };
    frontier = 0;
  }

  function applyDestination(sign: number): void {
    heights.fill(sign < 0 ? box.size : 0);
    reseed();
    pass += 1;
    armNext();
  }

  function step(): void {
    if (!pending || heights.length === 0) return;
    if (pending.kind === 'spin') {
      applyDestination(pending.sign);
      return;
    }
    const packed = pending.packed;
    heights[packed] = heights[packed]! + (pending.flip > 0 ? -1 : 1);
    armNext();
  }

  function onModeChange(): void {
    reseed();
    if (loopAlpha > 0 && pending) return;
    armNext();
  }

  function render(alpha: number): void {
    loopAlpha = alpha;
    if (!context) return;
    const n = box.size;
    let flip = 0;
    let spin = 0;
    let packed = -1;
    if (pending?.kind === 'cube') {
      flip = pending.flip;
      packed = pending.packed;
    } else if (pending?.kind === 'spin') {
      spin = pending.sign;
    }
    drawLozenges(context, {
      heights,
      a: n,
      b: n,
      c: n,
      pending: packed < 0 ? null : { i: Math.floor(packed / n), j: packed % n },
      flip,
      spin,
      alpha,
      animation: box.animation,
      palette: box.palette,
      width,
      height,
      dpr,
      reducedMotion,
    });
  }

  function toolbar(): BarPiece[] {
    return host.transport().filter((piece) => piece.id === 'play' || piece.id === 'step' || piece.id === 'speed');
  }

  function getStatus(): SimStatus {
    const total = cubeTotal();
    const missing = absent();
    const adding = playingMode(pending, box.mode) === 'addition';
    const along = adding ? total - missing : missing;
    const turning = pending?.kind === 'spin';
    const phase = turning ? 'Turning' : adding ? 'Adding' : 'Removing';
    return {
      done: false,
      span: clock === 1 ? undefined : clock,
      row: [
        { type: 'label', id: 'phase', text: phase },
        { type: 'progress', id: 'progress', value: total === 0 ? 0 : along / total },
        {
          type: 'metric',
          id: 'frontier',
          label: adding ? 'Addable' : 'Removable',
          value: frontier,
          series: String(pass),
        },
      ],
      aside: [
        { type: 'readout', id: 'size', label: 'box', value: `${box.size}×${box.size}×${box.size}` },
        {
          type: 'readout',
          id: 'remaining',
          label: 'remaining',
          value: formatInt(adding ? missing : total - missing),
        },
        { type: 'readout', id: 'steps', label: 'steps', value: formatInt(along) },
      ],
    };
  }

  return {
    reset,
    step,
    render,
    getStatus,
    toolbar,
    setParams(changed, all) {
      const next = readParams(all);
      const modeChanged = next.mode !== box.mode;
      box = next;
      if (modeChanged && changed.mode !== undefined && heights.length > 0) onModeChange();
    },
    resize(nextWidth, nextHeight, nextDpr) {
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
    },
    dispose() {
      context = null;
    },
  };
}

function playingMode(pending: Pending | null, fallback: Mode): Mode {
  if (pending?.kind === 'cube') return pending.flip > 0 ? 'removal' : 'addition';
  if (pending?.kind === 'spin') return pending.mode;
  return fallback;
}

function paramsDefault(): Params {
  const values: Params = {};
  for (const [key, def] of Object.entries(params)) values[key] = def.default;
  return values;
}

function readParams(all: Params): BoxSettings {
  const orderValue = stringParam(all.order, 'random');
  return {
    size: clamp(Math.round(numberParam(all.size, 10)), 3, 30),
    order: isOrder(orderValue) ? orderValue : 'random',
    mode: stringParam(all.mode, 'removal') === 'addition' ? 'addition' : 'removal',
    palette: stringParam(all.palette, 'amber'),
    animation: animationById(stringParam(all.animation, 'rotate')),
  };
}

function formatInt(value: number): string {
  return value.toLocaleString('en-US');
}

function numberParam(value: Params[string] | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringParam(value: Params[string] | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const sim: SimModule = { params, chrome: { seed: false }, create };
