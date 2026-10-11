import { describe, expect, it } from 'vitest';
import { generateNetwork, startNetwork } from './generate';
import { collectSolve, createSolver, type SolveEvent } from './solver';
import {
  applyRotations,
  connectedCount,
  countLeaks,
  degree,
  quarterDelta,
  undirectedEdges,
  uniqueRotations,
} from './tiles';
import type { Network } from './generate';

describe('pipe network', () => {
  it('builds a spanning tree and scrambles only distinct rotations', () => {
    for (const wrap of [false, true]) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const network = generateNetwork(6, seed, wrap);
        const count = network.size * network.size;
        const tree = treeMasks(network);
        expect(network.growth).toHaveLength(count);
        expect(new Set(network.growth)).toHaveLength(count);
        expect(undirectedEdges(tree)).toBe(count - 1);
        expect(countLeaks(tree, network.size, wrap)).toBe(0);
        expect(connectedCount(tree, network.size, wrap, network.source)).toBe(count);
        for (let index = 0; index < count; index += 1) {
          const turns = uniqueRotations(network.mask[index]!);
          expect(turns).toContain(network.scramble[index]);
          expect(turns).toContain(network.solution[index]);
          expect(degree(network.mask[index]!)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('turns 270° into 0° by one quarter, and keeps 180° as 180°', () => {
    expect(quarterDelta(3, 0)).toBe(1);
    expect(quarterDelta(0, 3)).toBe(-1);
    expect(quarterDelta(0, 2)).toBe(2);
    expect(quarterDelta(2, 0)).toBe(2);
    expect(quarterDelta(1, 1)).toBe(0);
    for (let from = 0; from < 4; from += 1) {
      for (let to = 0; to < 4; to += 1) {
        const delta = quarterDelta(from, to);
        expect(Math.abs(delta)).toBeLessThanOrEqual(2);
        expect((((from + delta) % 4) + 4) % 4).toBe(to);
      }
    }
  });
  it('puts the source on different cells across seeds', () => {
    const sources = new Set<number>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const network = generateNetwork(6, seed, false);
      expect(network.source).toBeGreaterThanOrEqual(0);
      expect(network.source).toBeLessThan(36);
      sources.add(network.source);
    }
    expect(sources.size).toBeGreaterThan(8);
  });

  it('matches a chunked build to the finished network', () => {
    const whole = generateNetwork(8, 3, false);
    const build = startNetwork(8, 3, false);
    let part: Network | null = null;
    for (let guard = 0; part === null && guard < 10_000; guard += 1) part = build.advance(3);
    expect(part).toEqual(whole);
    expect(build.progress).toBe(1);
  });

  it('repeats the same tree for the same seed', () => {
    const first = generateNetwork(9, 42, false);
    const second = generateNetwork(9, 42, false);
    expect(second.mask).toEqual(first.mask);
    expect(second.solution).toEqual(first.solution);
    expect(second.scramble).toEqual(first.scramble);
    expect(second.source).toBe(first.source);
    expect(second.growth).toEqual(first.growth);
  });

  it('solves to one leak-free network and repeats the same decisions', () => {
    for (const wrap of [false, true]) {
      for (let seed = 1; seed <= 6; seed += 1) {
        const network = generateNetwork(5, seed, wrap);
        const first = collectSolve(network.mask, network.size, wrap);
        const second = collectSolve(network.mask, network.size, wrap);
        expect(first.status, `seed ${seed} wrap ${wrap}`).toBe('solved');
        expect(second.events).toEqual(first.events);
        const solved = settle(network.mask, network.scramble, first.events);
        const count = network.size * network.size;
        expect(countLeaks(solved, network.size, wrap)).toBe(0);
        expect(connectedCount(solved, network.size, wrap, network.source)).toBe(count);
      }
    }
  });

  it('solves a larger board', () => {
    const network = generateNetwork(10, 7, false);
    const solvedRun = collectSolve(network.mask, network.size, false);
    expect(solvedRun.status).toBe('solved');
    const solved = settle(network.mask, network.scramble, solvedRun.events);
    expect(countLeaks(solved, 10, false)).toBe(0);
    expect(connectedCount(solved, 10, false, network.source)).toBe(100);
  });

  it('keeps a pipe on a turn that is still possible', () => {
    let leftScramble = false;
    for (let seed = 1; seed <= 8; seed += 1) {
      const network = generateNetwork(8, seed, false);
      const solver = createSolver(network.mask, network.size, false, network.scramble, seed);
      const count = network.size * network.size;
      for (let step = 0; step < 20_000; step += 1) {
        for (let index = 0; index < count; index += 1) {
          const options = solver.remaining(index);
          const turn = solver.facing[index]!;
          expect(options & (1 << turn)).not.toBe(0);
          if ((options & (options - 1)) !== 0 && turn !== network.scramble[index]) leftScramble = true;
        }
        const tick = solver.next(4_000);
        if (tick === 'solved' || tick === 'failed') break;
      }
    }
    expect(leftScramble).toBe(true);
  });
});

function treeMasks(network: Network): Uint8Array {
  return applyRotations(network.mask, network.solution);
}

function settle(base: Uint8Array, scramble: Uint8Array, events: SolveEvent[]): Uint8Array {
  const rotation = new Uint8Array(scramble);
  const locked = new Uint8Array(base.length);
  for (const event of events) {
    if (event.type === 'lock') {
      rotation[event.index] = event.rotation;
      locked[event.index] = 1;
      continue;
    }
    if (locked[event.index] !== 1) {
      throw new Error(`unlocked a tile that was not locked (${event.index})`);
    }
    rotation[event.index] = scramble[event.index]!;
    locked[event.index] = 0;
  }
  for (let index = 0; index < locked.length; index += 1) {
    if (locked[index] !== 1) throw new Error(`tile ${index} was never locked`);
  }
  return applyRotations(base, rotation);
}
