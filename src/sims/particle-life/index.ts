import { createRng, randomSeed, type Rng, type SimModule } from '../../harness/author';
import type { ParamSchema, Params, SimContext, SimHost, SimInstance, SimStatus } from '../../harness/types';
import {
  MAX_SUBSTEPS,
  STEP_DT,
  balanceSpecies,
  createScratch,
  createWorld,
  meanSpeed,
  placeParticles,
  stepWorld,
  type Scratch,
  type World,
} from './physics';
import { ParticleGpu } from './gpu';
import { createMatrixEditor, type MatrixEditor } from './matrix-editor';
import { PRESETS, nextRule, permuteBehaviors, presetById, ruleFor, writeMatrix, type Preset } from './presets';
import { drawLife, speciesPalette, trailCover, type Rgb } from './render';

/** CPU neighbor search gets heavy past this. WebGPU runs the full count. */
const CPU_CAP = 8000;

export const params: ParamSchema = {
  preset: {
    type: 'select',
    label: 'Preset',
    default: 'lines',
    reset: true,
    group: 'World',
    options: PRESETS.map((preset) => ({ value: preset.id, label: preset.label, detail: preset.detail })),
  },
  species: {
    type: 'number',
    label: 'Species',
    default: 2,
    min: 2,
    max: 6,
    step: 1,
    group: 'World',
  },
  particles: {
    type: 'number',
    label: 'Particles',
    default: 50000,
    min: 1000,
    max: 50000,
    step: 1000,
    reset: true,
    group: 'World',
  },
  radius: {
    type: 'number',
    label: 'Radius',
    detail: 'How far a particle can feel another, as a fraction of the world. Larger gathers bigger crowds.',
    default: 0.095,
    min: 0.03,
    max: 0.12,
    step: 0.005,
    group: 'Motion',
  },
  friction: {
    type: 'number',
    label: 'Half-life',
    detail: 'Seconds a particle keeps its speed. Shorter is more drag, so clusters tighten and slow down.',
    default: 0.8,
    min: 0.05,
    max: 2,
    step: 0.01,
    group: 'Motion',
  },
  force: {
    type: 'number',
    label: 'Force',
    detail: 'How hard the matrix pushes. Higher makes particles gather and flee faster. Zero lets them coast to a stop.',
    default: 3.2,
    min: 0,
    max: 8,
    step: 0.1,
    group: 'Motion',
  },
  trails: {
    type: 'boolean',
    label: 'Trails',
    default: true,
    group: 'Look',
  },
  trail: {
    type: 'number',
    label: 'Trail length',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    group: 'Look',
    when: (all) => all.trails === true,
  },
  dot: {
    type: 'number',
    label: 'Dot size',
    default: 0.2,
    min: 0.2,
    max: 3,
    step: 0.1,
    group: 'Look',
  },
};

interface Settings {
  preset: Preset;
  species: number;
  particles: number;
  radius: number;
  friction: number;
  force: number;
  trails: boolean;
  trail: number;
  dot: number;
}

function create(ctx: SimContext, host: SimHost): SimInstance<Params> {
  let width = ctx.width;
  let height = ctx.height;
  let dpr = ctx.dpr;
  let context: CanvasRenderingContext2D | null = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const card = host.card({ caption: 'Row feels about column' });
  const editor: MatrixEditor = createMatrixEditor(card.body, editRule);
  ctx.canvas.style.background = '#0e1014';

  let settings = readParams(paramsDefault());
  let world: World = createWorld(1, 1);
  let colors: readonly Rgb[] = speciesPalette(2);
  let scratch: Scratch = createScratch(1);
  let custom = false;
  let clear = true;
  let bank = 0;
  let fadeDt = 0;
  let simTime = 0;
  let speed = 0;
  let mode: 'boot' | 'gpu' | 'cpu' = 'boot';
  let gpu: ParticleGpu | null = null;
  let disposed = false;

  void ParticleGpu.open(ctx.canvas).then((opened) => {
    if (disposed) {
      opened?.destroy();
      return;
    }
    if (!opened) {
      useCpu();
      return;
    }
    gpu = opened;
    mode = 'gpu';
    gpu.resize(width, height, dpr);
    gpu.upload(world);
  });

  function useCpu(): void {
    mode = 'cpu';
    context = ctx.canvas.getContext('2d');
    if (world.count > CPU_CAP) world.count = CPU_CAP;
    scratch = createScratch(world.count);
  }

  function reset(all: Params, seed = 1): void {
    settings = readParams(all);
    const species = settings.species;
    const count = mode === 'cpu' ? Math.min(settings.particles, CPU_CAP) : settings.particles;
    world = createWorld(count, species);
    scratch = createScratch(count);
    placeParticles(world, createRng(seed >>> 0));
    writeMatrix(settings.preset, species, createRng((seed + 1) >>> 0), world.matrix);
    colors = speciesPalette(species);
    editor?.sync(world.matrix, world.species, colors);
    gpu?.upload(world);
    custom = false;
    clear = true;
    bank = 0;
    fadeDt = 0;
    simTime = 0;
    speed = 0;
  }

  function step(dt = 0): void {
    fadeDt = 0;
    if (mode === 'boot' || !(dt > 0)) return;
    bank += dt;
    let slices = 0;
    const trails = settings.trails && !reducedMotion;
    if (mode === 'gpu' && gpu) gpu.writeRules(world.matrix, world.species);
    while (bank >= STEP_DT && slices < MAX_SUBSTEPS) {
      if (mode === 'gpu' && gpu) {
        gpu.step(world.count, settings.radius, settings.friction, settings.force, STEP_DT);
      } else {
        stepWorld(world, scratch, settings.radius, settings.friction, settings.force, STEP_DT);
      }
      bank -= STEP_DT;
      slices += 1;
    }
    if (slices === MAX_SUBSTEPS) bank = 0;
    if (slices === 0) return;
    fadeDt = trails ? dt : 0;
    simTime += slices * STEP_DT;
    speed = mode === 'gpu' && gpu ? gpu.speed.current : meanSpeed(world);
  }

  function render(): void {
    const trails = settings.trails && !reducedMotion;
    if (mode === 'gpu' && gpu) {
      gpu.render({
        width,
        height,
        dpr,
        trails,
        keep: 1 - trailCover(settings.trail, fadeDt),
        clear,
        dot: settings.dot,
        colors,
      });
    } else if (context) {
      drawLife(context, {
        world,
        width,
        height,
        dpr,
        trails,
        trail: settings.trail,
        fadeDt,
        clear,
        dot: settings.dot,
        colors,
      });
    }
    clear = false;
    fadeDt = 0;
  }

  function getStatus(): SimStatus {
    const label = custom ? 'Custom' : settings.preset.label;
    const capped = mode === 'cpu' && settings.particles > world.count;
    const note = capped
      ? 'WebGPU is unavailable, so this run stays at 8,000 particles.'
      : custom
        ? 'Custom rules on these particles. Replay brings the preset matrix back.'
        : settings.preset.detail;
    return {
      done: false,
      row: [
        { type: 'label', id: 'phase', text: mode === 'boot' ? 'Starting' : 'Living' },
        { type: 'readout', id: 'device', label: 'Device', value: mode === 'gpu' ? 'WebGPU' : mode === 'cpu' ? 'CPU' : '…' },
        { type: 'readout', id: 'preset', label: 'Preset', value: label },
        { type: 'readout', id: 'particles', label: 'Particles', value: String(world.count) },
        { type: 'readout', id: 'species', label: 'Species', value: String(world.species) },
        { type: 'readout', id: 'time', label: 'Time', value: formatTime(simTime) },
      ],
      aside: [{ type: 'metric', id: 'speed', label: 'Speed', value: speed * 100 }],
      note,
    };
  }

  return {
    reset,
    step,
    render,
    getStatus,
    toolbar: () => [
      { type: 'button', id: 'scatter', label: 'Scatter', shortcut: { key: 's', hint: 'S scatter' }, onClick: scatter },
      { type: 'button', id: 'colors', label: 'Colors', shortcut: { key: 'c', hint: 'C new colors' }, onClick: recolor },
      { type: 'button', id: 'rules', label: 'Rules', shortcut: { key: 'n', hint: 'N new rules' }, onClick: randomize },
      { type: 'button', id: 'mutate', label: 'Mutate', shortcut: { key: 'm', hint: 'M reroll one cell' }, onClick: mutate },
      { type: 'button', id: 'shuffle', label: 'Shuffle', shortcut: { key: 'b', hint: 'B swap behaviors' }, onClick: shuffleBehaviors },
    ],
    setParams(changed, all) {
      settings = readParams(all);
      if (typeof changed.species === 'number') resizeSpecies(settings.species);
    },
    resize(nextWidth, nextHeight, nextDpr) {
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      clear = true;
      gpu?.resize(width, height, dpr);
    },
    dispose() {
      disposed = true;
      gpu?.destroy();
      gpu = null;
      editor.dispose();
      card.dispose();
      context = null;
    },
  };

  function resizeSpecies(next: number): void {
    const previous = world.species;
    if (next === previous) return;
    const matrix = new Float32Array(next * next);
    const keep = Math.min(previous, next);
    for (let row = 0; row < keep; row += 1) {
      for (let column = 0; column < keep; column += 1) {
        matrix[row * next + column] = world.matrix[row * previous + column] ?? 0;
      }
    }
    world.matrix = matrix;
    world.species = next;
    balanceSpecies(world);
    colors = next < previous ? colors.slice(0, next) : [...colors, ...speciesPalette(next - previous)];
    gpu?.upload(world);
    editor?.sync(world.matrix, world.species, colors);
  }

  function editRule(index: number, value: number): void {
    world.matrix[index] = value;
    custom = true;
    gpu?.writeRules(world.matrix, world.species);
  }

  function scatter(): void {
    const rng = createRng(randomSeed());
    for (let index = 0; index < world.count; index += 1) {
      world.x[index] = rng.next();
      world.y[index] = rng.next();
      world.vx[index] = 0;
      world.vy[index] = 0;
    }
    clear = true;
    gpu?.upload(world);
  }

  function recolor(): void {
    colors = speciesPalette(world.species);
    editor?.sync(world.matrix, world.species, colors);
  }

  function randomize(): void {
    const rng = createRng(randomSeed());
    const species = world.species;
    for (let row = 0; row < species; row += 1) {
      for (let column = 0; column < species; column += 1) {
        world.matrix[row * species + column] = ruleFor(rng, row, column);
      }
    }
    custom = true;
    editor?.sync(world.matrix, world.species, colors);
    gpu?.writeRules(world.matrix, world.species);
  }

  function mutate(): void {
    const rng = createRng(randomSeed());
    const species = world.species;
    const index = rng.int(species * species);
    const row = Math.floor(index / species);
    const column = index - row * species;
    world.matrix[index] = nextRule(rng, world.matrix[index] ?? 0, row === column);
    custom = true;
    editor?.sync(world.matrix, world.species, colors);
    gpu?.writeRules(world.matrix, world.species);
  }

  function shuffleBehaviors(): void {
    const species = world.species;
    const next = new Float32Array(species * species);
    permuteBehaviors(world.matrix, species, derange(species, createRng(randomSeed())), next);
    world.matrix = next;
    custom = true;
    editor?.sync(world.matrix, world.species, colors);
    gpu?.writeRules(world.matrix, world.species);
  }
}

/** A shuffle where every species wears a different species' old behavior. */
function derange(count: number, rng: Rng): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  if (count < 2) return order;
  do rng.shuffle(order);
  while (order.some((value, index) => value === index));
  return order;
}

function readParams(all: Params): Settings {
  const preset = presetById(typeof all.preset === 'string' ? all.preset : 'lines');
  return {
    preset,
    species: numberParam(all.species, 2),
    particles: numberParam(all.particles, 50000),
    radius: numberParam(all.radius, 0.095),
    friction: numberParam(all.friction, 0.8),
    force: numberParam(all.force, 3.2),
    trails: all.trails !== false,
    trail: numberParam(all.trail, 1),
    dot: numberParam(all.dot, 0.2),
  };
}

function numberParam(value: Params[string] | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function paramsDefault(): Params {
  const all: Params = {};
  for (const [key, def] of Object.entries(params)) all[key] = def.default;
  return all;
}

function randomRadius(): number {
  const min = 0.03;
  const step = 0.005;
  const steps = Math.round((0.12 - min) / step);
  const picked = min + Math.floor(Math.random() * (steps + 1)) * step;
  return Number(picked.toFixed(3));
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

let seenPreset = false;
let presetId = '';

/** Choosing a preset can set the motion it was tuned with. A later slider edit is left alone. */
function normalize(params: Params): void {
  const id = typeof params.preset === 'string' ? params.preset : 'lines';
  const chosen = seenPreset && id !== presetId;
  seenPreset = true;
  presetId = id;
  if (!chosen) return;
  const preset = presetById(id);
  params.species = preset.species;
  const motion = preset.motion;
  if (id === 'random') params.radius = randomRadius();
  if (!motion) return;
  if (motion.radius !== undefined) params.radius = motion.radius;
  if (motion.friction !== undefined) params.friction = motion.friction;
  if (motion.force !== undefined) params.force = motion.force;
  if (motion.particles !== undefined) params.particles = motion.particles;
  if (motion.trails !== undefined) params.trails = motion.trails;
  if (motion.trail !== undefined) params.trail = motion.trail;
  if (motion.dot !== undefined) params.dot = motion.dot;
}

export const sim: SimModule = {
  params,
  chrome: { pace: 'frame' },
  normalize,
  create,
};
