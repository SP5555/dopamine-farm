export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: T[]): void;
}

/** mulberry32. The same seed always yields the same stream. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(maxExclusive: number): number {
      return Math.floor(next() * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error('Cannot pick from an empty list');
      }
      return items[Math.floor(next() * items.length)]!;
    },
    shuffle<T>(items: T[]): void {
      for (let index = items.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1));
        const current = items[index]!;
        items[index] = items[swap]!;
        items[swap] = current;
      }
    },
  };
}

/** The only unseeded randomness in the app. Used when a run starts, never inside a sim. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296);
}
