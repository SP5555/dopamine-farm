import { createRng, randomSeed, type Rng } from '../../harness/author';
import type { BarPiece, ParamSchema, Params, SimContext, SimHost, SimInstance, SimModule, SimStatus } from '../../harness/types';
import { chooseRemoval, collectAddable, collectRemovable, isOrder, type Order, type Orient } from './heightmap';
import { ANIMATIONS, PALETTES, animationById, drawLozenges, slideWindows, type AnimationId, type SlideWindow } from './render';

const OPEN_SPEED = 4;
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
    group: 'Run',
    options: [
      { value: 'random', label: 'Random', detail: 'Uniform among the cubes that can move now.' },
      {
        value: 'depth',
        label: 'Depth',
        detail: 'Removal peels the closest plane, highest cubes first. Addition fills the farthest plane the same way.',
      },
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

type FaceWindows = Record<Orient, SlideWindow>;

type Pending =
  | { kind: 'cube'; packed: number; flip: 1 | -1; windows: FaceWindows; animation: AnimationId }
  | { kind: 'spin'; sign: number; mode: Mode; windows: FaceWindows; animation: AnimationId };

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
  /** Alpha of the latest frame. Above 0, the move on screen has started and a setting change lets it finish. */
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

  function armNext(): void {
    if (heights.length === 0) {
      pending = null;
      frontier = 0;
      clock = 1;
      return;
    }
    const n = box.size;
    const removing = box.mode === 'removal';
    frontier = removing ? collectRemovable(heights, n, n, scratch) : collectAddable(heights, n, n, n, scratch);
    if (frontier === 0) {
      armSpin(removing ? -1 : 1);
      return;
    }
    clock = 1;
    pending = {
      kind: 'cube',
      packed: chooseRemoval(box.order, heights, n, scratch, frontier, rng, removing),
      flip: removing ? 1 : -1,
      ...motion(),
    };
  }

  function armSpin(sign: number): void {
    clock = reducedMotion ? 1 : SPIN_TICKS;
    pending = { kind: 'spin', sign, mode: box.mode, ...motion() };
    frontier = 0;
  }

  function motion(): { windows: FaceWindows; animation: AnimationId } {
    return { windows: rollWindows(), animation: box.animation };
  }

  function rollWindows(): FaceWindows {
    const order: Orient[] = ['ab', 'bc', 'ca'];
    rng.shuffle(order);
    return slideWindows(order);
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

  function inFlight(): boolean {
    return loopAlpha > 0 && pending !== null;
  }

  function onModeChange(): void {
    reseed();
    if (inFlight()) return;
    armNext();
  }

  function onOrderChange(): void {
    if (inFlight()) return;
    armNext();
  }

  function onAnimationChange(): void {
    if (inFlight() || !pending) return;
    pending.animation = box.animation;
  }

  function render(alpha: number): void {
    loopAlpha = alpha;
    if (!context) return;
    const n = box.size;
    const cube = pending?.kind === 'cube' ? pending : null;
    drawLozenges(context, {
      heights,
      a: n,
      b: n,
      c: n,
      pending: cube ? { i: Math.floor(cube.packed / n), j: cube.packed % n } : null,
      flip: cube?.flip ?? 0,
      spin: pending?.kind === 'spin' ? pending.sign : 0,
      alpha,
      windows: pending?.windows ?? FULL_WINDOWS,
      animation: pending?.animation ?? box.animation,
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
      const orderChanged = next.order !== box.order;
      const animationChanged = next.animation !== box.animation;
      box = next;
      if (heights.length === 0) return;
      if (modeChanged && changed.mode !== undefined) onModeChange();
      else if (orderChanged && changed.order !== undefined) onOrderChange();
      else if (animationChanged && changed.animation !== undefined) onAnimationChange();
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

const FULL: SlideWindow = { start: 0, end: 1 };
const FULL_WINDOWS: FaceWindows = { ab: FULL, bc: FULL, ca: FULL };

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

function normalize(values: Params): void {
  const order = values.order;
  if (typeof order !== 'string' || !isOrder(order)) values.order = 'random';
}

export const sim: SimModule = { params, chrome: { seed: false }, normalize, create };
