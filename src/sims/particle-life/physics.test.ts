import { describe, expect, it } from 'vitest';
import { createRng } from '../../harness/author';
import {
  BETA,
  STEP_DT,
  bruteNeighbors,
  createScratch,
  createWorld,
  gridNeighbors,
  meanKinetic,
  meanSpeed,
  pairForce,
  balanceSpecies,
  placeParticles,
  stepWorld,
  wrap01,
} from './physics';
import { PRESETS, permuteBehaviors, writeMatrix } from './presets';

describe('particle life', () => {
  it('gives a new species an equal share of the existing particles', () => {
    const world = createWorld(90, 2);
    placeParticles(world, createRng(3));
    const x = world.x[0];
    world.species = 3;
    balanceSpecies(world);
    const counts = [0, 0, 0];
    for (let index = 0; index < world.count; index += 1) counts[world.type[index] ?? 0] += 1;
    expect(counts).toEqual([30, 30, 30]);
    expect(world.x[0]).toBe(x);
    world.species = 2;
    balanceSpecies(world);
    const shrunk = [0, 0];
    for (let index = 0; index < world.count; index += 1) {
      const type = world.type[index] ?? 0;
      expect(type).toBeLessThan(2);
      shrunk[type] += 1;
    }
    expect(shrunk).toEqual([45, 45]);
  });

  it('matches the force law at the marked distances', () => {
    expect(pairForce(0, 0.5)).toBeCloseTo(-1);
    expect(pairForce(BETA, 0.5)).toBeCloseTo(0);
    expect(pairForce((1 + BETA) / 2, 0.4)).toBeCloseTo(0.4);
    expect(pairForce((1 + BETA) / 2, -0.7)).toBeCloseTo(-0.7);
    expect(pairForce(1, 1)).toBe(0);
    expect(pairForce(1.4, 1)).toBe(0);
  });

  it('finds the same neighbors as a full search, including across the wrap', () => {
    const world = createWorld(36, 3);
    const scratch = createScratch(36);
    const rng = createRng(7);
    placeParticles(world, rng);
    world.x[0] = 0.01;
    world.y[0] = 0.02;
    world.x[1] = 0.98;
    world.y[1] = 0.99;
    for (const radius of [0.08, 0.45]) {
      for (let index = 0; index < world.count; index += 1) {
        expect(gridNeighbors(world, scratch, radius, index)).toEqual(bruteNeighbors(world, radius, index));
      }
    }
  });

  it('keeps every particle inside the unit square', () => {
    const world = createWorld(24, 2);
    const scratch = createScratch(24);
    placeParticles(world, createRng(3));
    world.x[0] = 0.99;
    world.vx[0] = 2;
    world.y[1] = 0.01;
    world.vy[1] = -2;
    writeMatrix(PRESETS[0]!, 4, createRng(1), world.matrix);
    stepWorld(world, scratch, 0.06, 0.2, 0, STEP_DT);
    expect(world.x[0]).toBeGreaterThanOrEqual(0);
    expect(world.x[0]).toBeLessThan(1);
    expect(world.x[0]).toBeLessThan(0.2);
    expect(world.y[1]).toBeGreaterThan(0.8);
    for (let index = 0; index < world.count; index += 1) {
      expect(world.x[index]).toBeGreaterThanOrEqual(0);
      expect(world.x[index]).toBeLessThan(1);
      expect(world.y[index]).toBeGreaterThanOrEqual(0);
      expect(world.y[index]).toBeLessThan(1);
    }
    expect(wrap01(-0.25)).toBeCloseTo(0.75);
    expect(wrap01(1.25)).toBeCloseTo(0.25);
  });

  it('fills a random matrix with small values and many exact zeros', () => {
    const random = PRESETS.find((preset) => preset.id === 'random');
    expect(random).toBeTruthy();
    const into = new Float32Array(16);
    let zeros = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      writeMatrix(random!, 4, createRng(seed), into);
      for (const value of into) {
        const shown = Math.round(value * 100) / 100;
        expect(shown).toBeGreaterThanOrEqual(-0.2);
        expect(shown).toBeLessThanOrEqual(0.2);
        expect(shown).toBeCloseTo(value, 5);
        if (value === 0) zeros += 1;
      }
    }
    expect(zeros).toBeGreaterThan(200);
    expect(zeros).toBeLessThan(440);
  });

  it('moves each species behavior onto another species', () => {
    const matrix = [0, -0.4, 0.32, -0.5];
    const into = new Float32Array(4);
    permuteBehaviors(matrix, 2, [1, 0], into);
    expect(Array.from(into).map((value) => Math.round(value * 100) / 100)).toEqual([-0.5, 0.32, -0.4, 0]);
  });

  it('repeats positions and a random matrix from the same seed', () => {
    const first = spawn(11, 80, 5);
    const second = spawn(11, 80, 5);
    expect(Array.from(first.x)).toEqual(Array.from(second.x));
    expect(Array.from(first.y)).toEqual(Array.from(second.y));
    expect(Array.from(first.type)).toEqual(Array.from(second.type));
    expect(Array.from(first.matrix)).toEqual(Array.from(second.matrix));
    const other = spawn(12, 80, 5);
    expect(Array.from(other.matrix)).not.toEqual(Array.from(first.matrix));
  });

  it('lets a symmetric matrix lose its motion', () => {
    const matrix = [0.55, 0.2, -0.08, 0.2, 0.5, 0.16, -0.08, 0.16, 0.48];
    const species = 3;
    for (let row = 0; row < species; row += 1) {
      for (let column = 0; column < species; column += 1) {
        expect(matrix[row * species + column]).toBeCloseTo(matrix[column * species + row]!);
      }
    }
    const world = createWorld(70, species);
    const scratch = createScratch(70);
    placeParticles(world, createRng(4));
    for (let index = 0; index < matrix.length; index += 1) world.matrix[index] = matrix[index]!;
    const kick = createRng(9);
    for (let index = 0; index < world.count; index += 1) {
      world.vx[index] = (kick.next() - 0.5) * 0.5;
      world.vy[index] = (kick.next() - 0.5) * 0.5;
    }
    const started = meanKinetic(world);
    for (let step = 0; step < 360; step += 1) stepWorld(world, scratch, 0.07, 0.12, 2, STEP_DT);
    expect(meanKinetic(world)).toBeLessThan(started * 0.05);
    expect(meanSpeed(world)).toBeLessThan(0.03);
  });
});

function spawn(seed: number, count: number, species: number) {
  const world = createWorld(count, species);
  placeParticles(world, createRng(seed >>> 0));
  const random = PRESETS.find((preset) => preset.id === 'random')!;
  writeMatrix(random, species, createRng((seed + 1) >>> 0), world.matrix);
  return world;
}
