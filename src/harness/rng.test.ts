import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

describe('rng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const left = Array.from({ length: 8 }, () => a.next());
    const right = Array.from({ length: 8 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('diverges for a different seed', () => {
    const a = createRng(1);
    const b = createRng(2);
    const left = Array.from({ length: 4 }, () => a.next());
    const right = Array.from({ length: 4 }, () => b.next());
    expect(left).not.toEqual(right);
  });

  it('keeps next() inside [0, 1)', () => {
    const rng = createRng(0);
    for (let index = 0; index < 20; index += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
