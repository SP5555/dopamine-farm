import type { Rng } from '../../harness/author';

export interface Preset {
  id: string;
  label: string;
  /** One line under the counters, and the hover text on the preset menu. */
  detail: string;
  /** Species count applied when this preset is chosen. */
  species: number;
  /** Row-major. Entry `self * species + other` is how `self` feels about `other`. Null means fill from the seed. */
  matrix: readonly number[] | null;
  /** Applied when this preset is chosen. Later slider edits are kept. */
  motion?: {
    radius?: number;
    friction?: number;
    force?: number;
    particles?: number;
    trails?: boolean;
    trail?: number;
    dot?: number;
  };
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'lines',
    label: 'Lines',
    detail: 'Each color pushes its own and leaves the other alone.',
    species: 2,
    matrix: [-0.1, 0, 0, -0.1],
    motion: { radius: 0.1, friction: 0.8, force: 1.8, particles: 50000, trail: 0.2 },
  },
  {
    id: 'groups',
    label: 'Groups',
    detail: 'Both colors push their own and each other, and they settle into separate groups.',
    species: 2,
    matrix: [-0.12, -0.13, -0.12, -0.12],
    motion: { radius: 0.12, friction: 1.5, force: 2.4, particles: 50000, trails: true, trail: 0.2, dot: 0.2 },
  },
  {
    id: 'waves',
    label: 'Waves',
    detail: 'One color pushes the other, and the other pulls back, so the bands travel.',
    species: 2,
    matrix: [0, -0.4, 0.32, -0.5],
    motion: { radius: 0.09, friction: 0.1, force: 0.1, particles: 50000, trails: false, trail: 0, dot: 0.3 },
  },
  {
    id: 'weave',
    label: 'Weave',
    detail: 'Two colors push into pods, and the third sits in the gaps, so the three lock into a weave.',
    species: 3,
    matrix: [-0.13, -0.04, 0, -0.11, -0.13, 0, 0, -0.01, 0],
    motion: { radius: 0.12, friction: 0.12, force: 1.8, particles: 50000, trails: true, trail: 0.2, dot: 0.5 },
  },
  {
    id: 'ribbons',
    label: 'Ribbons',
    detail: 'Each color pushes itself and a partner, so the four settle into bending ribbons.',
    species: 4,
    matrix: [-0.1, -0.1, 0, -0.02, -0.1, -0.1, -0.02, 0, 0, -0.02, -0.1, -0.1, -0.02, 0, -0.1, -0.1],
    motion: { radius: 0.1, friction: 2, force: 1.6, particles: 50000, trails: true, trail: 0.2, dot: 0.2 },
  },
  {
    id: 'random',
    label: 'Random',
    detail: 'A new matrix of small values, half of them zero, and a new radius. Force stays at 0.1 and half-life at 0.4.',
    species: 4,
    matrix: null,
    motion: { friction: 0.4, force: 0.1 },
  },
];

export function presetById(id: string): Preset {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0]!;
}

/**
 * Move each species' behavior onto another species. `order[i]` is the species whose old row and column `i` now wears.
 * The particles and their colors stay where they are.
 */
export function permuteBehaviors(matrix: ArrayLike<number>, species: number, order: readonly number[], into: Float32Array): void {
  for (let row = 0; row < species; row += 1) {
    for (let column = 0; column < species; column += 1) {
      into[row * species + column] = matrix[(order[row] ?? row) * species + (order[column] ?? column)] ?? 0;
    }
  }
}

/** Half the time this is exactly 0. Otherwise it is a hundredth in [−0.2, 0.2]. */
export function randomRule(rng: Rng): number {
  if (rng.next() < 0.5) return 0;
  return Math.round((rng.next() * 2 - 1) * 0.2 * 100) / 100;
}

/** How `row` feels about `column`. A color never attracts itself: a positive same-color roll is stored as its negative. */
export function ruleFor(rng: Rng, row: number, column: number): number {
  const value = randomRule(rng);
  if (row === column && value > 0) return -value;
  return value;
}

/**
 * A new value for one cell. One roll, as in `ruleFor`.
 * If that roll is the value already there, one draw picks a different hundredth. No further rolls.
 */
export function nextRule(rng: Rng, current: number, sameColor: boolean): number {
  const rolled = ruleFor(rng, 0, sameColor ? 0 : 1);
  if (Math.round(rolled * 100) !== Math.round(current * 100)) return rolled;
  return differentHundredth(rng, Math.round(current * 100), sameColor);
}

/** One draw from the legal hundredths, with `step` left out when it is one of them. */
function differentHundredth(rng: Rng, step: number, sameColor: boolean): number {
  const min = -20;
  const max = sameColor ? 0 : 20;
  const span = max - min + 1;
  const inside = step >= min && step <= max;
  let pick = rng.int(inside ? span - 1 : span);
  if (inside && pick >= step - min) pick += 1;
  return (min + pick) / 100;
}

/** Curated entries are copied into the top-left block. Extra rows and columns stay 0. Random fills from `rng`, which must not be the position stream. */
export function writeMatrix(preset: Preset, species: number, rng: Rng, into: Float32Array): void {
  if (preset.matrix) {
    const from = preset.species;
    const keep = Math.min(from, species);
    for (let row = 0; row < keep; row += 1) {
      for (let column = 0; column < keep; column += 1) {
        into[row * species + column] = preset.matrix[row * from + column] ?? 0;
      }
    }
    return;
  }
  for (let index = 0; index < species * species; index += 1) into[index] = randomRule(rng);
}
