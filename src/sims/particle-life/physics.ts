import type { Rng } from '../../harness/author';

/** Inner zone that always repels, as a fraction of the interaction radius. */
export const BETA = 0.3;

/** World-widths per second. Stops a bad matrix from running away. */
export const MAX_SPEED = 1.5;

/** Fixed integrator slice. A painted frame may run several of these. */
export const STEP_DT = 1 / 60;

/** How many slices one painted frame will run before it drops leftover time. */
export const MAX_SUBSTEPS = 16;

const MAX_COLS = 50;

/**
 * Force on a particle from one neighbor at normalized distance `r` (0 at the
 * same point, 1 at the interaction radius). Positive pulls toward the neighbor.
 * `attraction` is in [−1, 1].
 */
export function pairForce(r: number, attraction: number, beta = BETA): number {
  if (!(r >= 0) || r >= 1) return 0;
  if (r < beta) return r / beta - 1;
  const span = 1 - beta;
  return attraction * (1 - Math.abs(2 * r - 1 - beta) / span);
}

export interface World {
  count: number;
  species: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  type: Uint8Array;
  /** Row-major. `matrix[self * species + other]` is how `self` feels about `other`. */
  matrix: Float32Array;
}

export interface Scratch {
  counts: Int32Array;
  offsets: Int32Array;
  indices: Int32Array;
  cursor: Int32Array;
  cellOf: Int32Array;
  nearby: Int32Array;
  x0: Float32Array;
  y0: Float32Array;
  capacity: number;
}

export function createWorld(count: number, species: number): World {
  return {
    count,
    species,
    x: new Float32Array(count),
    y: new Float32Array(count),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    type: new Uint8Array(count),
    matrix: new Float32Array(species * species),
  };
}

export function createScratch(capacity: number): Scratch {
  const cells = MAX_COLS * MAX_COLS;
  return {
    counts: new Int32Array(cells),
    offsets: new Int32Array(cells + 1),
    indices: new Int32Array(capacity),
    cursor: new Int32Array(cells),
    cellOf: new Int32Array(capacity),
    nearby: new Int32Array(cells),
    x0: new Float32Array(capacity),
    y0: new Float32Array(capacity),
    capacity,
  };
}

/**
 * Give every species the same count. A particle keeps its color when that color
 * still has room. Extra particles, and any color that was just removed, fill the
 * species that are short, so a new color gets its share without moving anyone.
 */
export function balanceSpecies(world: World): void {
  const { count, species, type } = world;
  if (species < 1 || count === 0) return;
  const target = new Int32Array(species);
  const base = Math.floor(count / species);
  let extra = count % species;
  for (let index = 0; index < species; index += 1) {
    target[index] = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
  }
  const filled = new Int32Array(species);
  const spare: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const current = type[index] ?? 0;
    if (current < species && (filled[current] ?? 0) < (target[current] ?? 0)) {
      filled[current] = (filled[current] ?? 0) + 1;
    } else {
      spare.push(index);
    }
  }
  let cursor = 0;
  for (const index of spare) {
    while (cursor < species && (filled[cursor] ?? 0) >= (target[cursor] ?? 0)) cursor += 1;
    const assigned = cursor < species ? cursor : species - 1;
    type[index] = assigned;
    filled[assigned] = (filled[assigned] ?? 0) + 1;
  }
}

/** Even species counts, shuffled, so every color is on screen. Velocities start at rest. */
export function placeParticles(world: World, rng: Rng): void {
  const { count, species, x, y, vx, vy, type } = world;
  for (let index = 0; index < count; index += 1) {
    x[index] = rng.next();
    y[index] = rng.next();
    vx[index] = 0;
    vy[index] = 0;
    type[index] = index % species;
  }
  for (let index = count - 1; index > 0; index -= 1) {
    const swap = rng.int(index + 1);
    const current = type[index]!;
    type[index] = type[swap]!;
    type[swap] = current;
  }
}

export function wrap01(value: number): number {
  const wrapped = value - Math.floor(value);
  return wrapped === 1 ? 0 : wrapped;
}

/**
 * One fixed slice. Positions wrap on a unit torus. Neighbors come from a grid
 * whose cells are at least `rMax` wide, so each particle only looks at the
 * surrounding 3×3 (or every cell, when the world is fewer than 3 cells across).
 */
export function stepWorld(
  world: World,
  scratch: Scratch,
  rMax: number,
  halfLife: number,
  force: number,
  dt: number,
): void {
  const count = world.count;
  if (count === 0 || !(rMax > 0) || !(dt > 0) || !(halfLife > 0)) return;
  if (count > scratch.capacity) {
    throw new Error(`Scratch holds ${scratch.capacity} particles, not ${count}`);
  }

  const { x, y, vx, vy, type, matrix, species } = world;
  const { x0, y0, counts, offsets, indices, cursor, cellOf, nearby } = scratch;
  x0.set(x);
  y0.set(y);

  const cols = Math.max(1, Math.min(MAX_COLS, Math.floor(1 / rMax)));
  const cellCount = cols * cols;
  counts.fill(0, 0, cellCount);
  for (let index = 0; index < count; index += 1) {
    const cx = Math.min(cols - 1, Math.floor(x0[index]! * cols));
    const cy = Math.min(cols - 1, Math.floor(y0[index]! * cols));
    const cell = cy * cols + cx;
    cellOf[index] = cell;
    counts[cell] = (counts[cell] ?? 0) + 1;
  }
  let sum = 0;
  for (let cell = 0; cell < cellCount; cell += 1) {
    offsets[cell] = sum;
    sum += counts[cell] ?? 0;
  }
  offsets[cellCount] = sum;
  for (let cell = 0; cell < cellCount; cell += 1) cursor[cell] = offsets[cell]!;
  for (let index = 0; index < count; index += 1) {
    const cell = cellOf[index]!;
    indices[cursor[cell]!] = index;
    cursor[cell] = (cursor[cell] ?? 0) + 1;
  }

  const r2 = rMax * rMax;
  const invR = 1 / rMax;
  const impulse = rMax * force * dt;
  const damp = 0.5 ** (dt / halfLife);
  const wide = cols >= 3;

  for (let index = 0; index < count; index += 1) {
    const xi = x0[index]!;
    const yi = y0[index]!;
    const row = type[index]! * species;
    let fx = 0;
    let fy = 0;
    const cx = Math.min(cols - 1, Math.floor(xi * cols));
    const cy = Math.min(cols - 1, Math.floor(yi * cols));

    let nearCount = 0;
    if (wide) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const ny = (cy + oy + cols) % cols;
        const base = ny * cols;
        for (let ox = -1; ox <= 1; ox += 1) {
          nearby[nearCount] = base + ((cx + ox + cols) % cols);
          nearCount += 1;
        }
      }
    } else {
      for (let cell = 0; cell < cellCount; cell += 1) {
        nearby[cell] = cell;
      }
      nearCount = cellCount;
    }

    for (let near = 0; near < nearCount; near += 1) {
      const cell = nearby[near]!;
      const start = offsets[cell]!;
      const end = offsets[cell + 1]!;
      for (let cursorIndex = start; cursorIndex < end; cursorIndex += 1) {
        const other = indices[cursorIndex]!;
        if (other === index) continue;
        let dx = x0[other]! - xi;
        let dy = y0[other]! - yi;
        if (dx > 0.5) dx -= 1;
        else if (dx < -0.5) dx += 1;
        if (dy > 0.5) dy -= 1;
        else if (dy < -0.5) dy += 1;
        const dist2 = dx * dx + dy * dy;
        if (dist2 >= r2 || dist2 < 1e-12) continue;
        const dist = Math.sqrt(dist2);
        const pull = pairForce(dist * invR, matrix[row + type[other]!]!);
        const scale = pull / dist;
        fx += dx * scale;
        fy += dy * scale;
      }
    }

    let nextVx = vx[index]! * damp + fx * impulse;
    let nextVy = vy[index]! * damp + fy * impulse;
    const speed2 = nextVx * nextVx + nextVy * nextVy;
    const max2 = MAX_SPEED * MAX_SPEED;
    if (speed2 > max2) {
      const scale = MAX_SPEED / Math.sqrt(speed2);
      nextVx *= scale;
      nextVy *= scale;
    }
    vx[index] = nextVx;
    vy[index] = nextVy;
    x[index] = wrap01(xi + nextVx * dt);
    y[index] = wrap01(yi + nextVy * dt);
  }
}

/** Mean speed in world-widths per second. */
export function meanSpeed(world: World): number {
  const { count, vx, vy } = world;
  if (count === 0) return 0;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const sx = vx[index]!;
    const sy = vy[index]!;
    total += Math.sqrt(sx * sx + sy * sy);
  }
  return total / count;
}

/** Mean of ½|v|². */
export function meanKinetic(world: World): number {
  const { count, vx, vy } = world;
  if (count === 0) return 0;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    total += vx[index]! * vx[index]! + vy[index]! * vy[index]!;
  }
  return total / (2 * count);
}

export interface NeighborStats {
  mean: number;
  stdev: number;
  /** Among particles that have a neighbor, the share of those neighbors of the same species. */
  same: number;
}

/** Brute-force neighbor indexes within `rMax`, wrapping the unit torus. Sorted. */
export function bruteNeighbors(world: World, rMax: number, index: number): number[] {
  const found: number[] = [];
  const xi = world.x[index]!;
  const yi = world.y[index]!;
  const r2 = rMax * rMax;
  for (let other = 0; other < world.count; other += 1) {
    if (other === index) continue;
    let dx = world.x[other]! - xi;
    let dy = world.y[other]! - yi;
    if (dx > 0.5) dx -= 1;
    else if (dx < -0.5) dx += 1;
    if (dy > 0.5) dy -= 1;
    else if (dy < -0.5) dy += 1;
    if (dx * dx + dy * dy < r2) found.push(other);
  }
  found.sort((a, b) => a - b);
  return found;
}

/** Grid neighbor indexes for one particle. The grid is built from the current positions. */
export function gridNeighbors(world: World, scratch: Scratch, rMax: number, index: number): number[] {
  const snapshot = scratch.x0;
  const snapshotY = scratch.y0;
  snapshot.set(world.x);
  snapshotY.set(world.y);
  const count = world.count;
  const cols = Math.max(1, Math.min(MAX_COLS, Math.floor(1 / rMax)));
  const cellCount = cols * cols;
  const { counts, offsets, indices, cursor, cellOf } = scratch;
  counts.fill(0, 0, cellCount);
  for (let particle = 0; particle < count; particle += 1) {
    const cx = Math.min(cols - 1, Math.floor(world.x[particle]! * cols));
    const cy = Math.min(cols - 1, Math.floor(world.y[particle]! * cols));
    const cell = cy * cols + cx;
    cellOf[particle] = cell;
    counts[cell] = (counts[cell] ?? 0) + 1;
  }
  let sum = 0;
  for (let cell = 0; cell < cellCount; cell += 1) {
    offsets[cell] = sum;
    sum += counts[cell] ?? 0;
  }
  offsets[cellCount] = sum;
  for (let cell = 0; cell < cellCount; cell += 1) cursor[cell] = offsets[cell]!;
  for (let particle = 0; particle < count; particle += 1) {
    const cell = cellOf[particle]!;
    indices[cursor[cell]!] = particle;
    cursor[cell] = (cursor[cell] ?? 0) + 1;
  }

  const found: number[] = [];
  const xi = world.x[index]!;
  const yi = world.y[index]!;
  const r2 = rMax * rMax;
  const cx = Math.min(cols - 1, Math.floor(xi * cols));
  const cy = Math.min(cols - 1, Math.floor(yi * cols));
  const consider = (cell: number): void => {
    for (let cursorIndex = offsets[cell]!; cursorIndex < offsets[cell + 1]!; cursorIndex += 1) {
      const other = indices[cursorIndex]!;
      if (other === index) continue;
      let dx = world.x[other]! - xi;
      let dy = world.y[other]! - yi;
      if (dx > 0.5) dx -= 1;
      else if (dx < -0.5) dx += 1;
      if (dy > 0.5) dy -= 1;
      else if (dy < -0.5) dy += 1;
      if (dx * dx + dy * dy < r2) found.push(other);
    }
  };
  if (cols >= 3) {
    for (let oy = -1; oy <= 1; oy += 1) {
      const ny = (cy + oy + cols) % cols;
      for (let ox = -1; ox <= 1; ox += 1) consider(ny * cols + ((cx + ox + cols) % cols));
    }
  } else {
    for (let cell = 0; cell < cellCount; cell += 1) consider(cell);
  }
  found.sort((a, b) => a - b);
  return found;
}

export function neighborStats(world: World, scratch: Scratch, rMax: number): NeighborStats {
  const count = world.count;
  if (count === 0) return { mean: 0, stdev: 0, same: 0 };
  const cols = Math.max(1, Math.min(MAX_COLS, Math.floor(1 / rMax)));
  fillGrid(world, scratch, cols);
  const { offsets, indices, nearby } = scratch;
  const r2 = rMax * rMax;
  const wide = cols >= 3;
  let total = 0;
  let total2 = 0;
  let same = 0;
  let crowded = 0;
  for (let index = 0; index < count; index += 1) {
    const xi = world.x[index]!;
    const yi = world.y[index]!;
    const species = world.type[index];
    const cx = Math.min(cols - 1, Math.floor(xi * cols));
    const cy = Math.min(cols - 1, Math.floor(yi * cols));
    let nearCount = 0;
    if (wide) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const ny = (cy + oy + cols) % cols;
        const base = ny * cols;
        for (let ox = -1; ox <= 1; ox += 1) {
          nearby[nearCount] = base + ((cx + ox + cols) % cols);
          nearCount += 1;
        }
      }
    } else {
      const cellCount = cols * cols;
      for (let cell = 0; cell < cellCount; cell += 1) nearby[cell] = cell;
      nearCount = cellCount;
    }
    let n = 0;
    let matching = 0;
    for (let near = 0; near < nearCount; near += 1) {
      const cell = nearby[near]!;
      for (let cursorIndex = offsets[cell]!; cursorIndex < offsets[cell + 1]!; cursorIndex += 1) {
        const other = indices[cursorIndex]!;
        if (other === index) continue;
        let dx = world.x[other]! - xi;
        let dy = world.y[other]! - yi;
        if (dx > 0.5) dx -= 1;
        else if (dx < -0.5) dx += 1;
        if (dy > 0.5) dy -= 1;
        else if (dy < -0.5) dy += 1;
        if (dx * dx + dy * dy >= r2) continue;
        n += 1;
        if (world.type[other] === species) matching += 1;
      }
    }
    total += n;
    total2 += n * n;
    if (n === 0) continue;
    crowded += 1;
    same += matching / n;
  }
  const mean = total / count;
  const variance = Math.max(0, total2 / count - mean * mean);
  return { mean, stdev: Math.sqrt(variance), same: crowded === 0 ? 0 : same / crowded };
}

function fillGrid(world: World, scratch: Scratch, cols: number): void {
  const count = world.count;
  const cellCount = cols * cols;
  const { counts, offsets, indices, cursor, cellOf } = scratch;
  counts.fill(0, 0, cellCount);
  for (let particle = 0; particle < count; particle += 1) {
    const cx = Math.min(cols - 1, Math.floor(world.x[particle]! * cols));
    const cy = Math.min(cols - 1, Math.floor(world.y[particle]! * cols));
    const cell = cy * cols + cx;
    cellOf[particle] = cell;
    counts[cell] = (counts[cell] ?? 0) + 1;
  }
  let sum = 0;
  for (let cell = 0; cell < cellCount; cell += 1) {
    offsets[cell] = sum;
    sum += counts[cell] ?? 0;
  }
  offsets[cellCount] = sum;
  for (let cell = 0; cell < cellCount; cell += 1) cursor[cell] = offsets[cell]!;
  for (let particle = 0; particle < count; particle += 1) {
    const cell = cellOf[particle]!;
    indices[cursor[cell]!] = particle;
    cursor[cell] = (cursor[cell] ?? 0) + 1;
  }
}
