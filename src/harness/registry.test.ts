import { describe, expect, it } from 'vitest';
import { compareMetas } from './registry';
import type { SimMeta } from './types';

function meta(partial: Pick<SimMeta, 'id' | 'title'> & { order?: number }): SimMeta {
  return { description: '', ...partial };
}

describe('compareMetas', () => {
  it('puts a numbered sim ahead of one that only has a title', () => {
    const ordered = [meta({ id: 'pipe', title: 'Pipe Network' }), meta({ id: 'puzzle', title: 'Sliding Puzzle', order: 0 })];
    expect(ordered.sort(compareMetas).map((item) => item.id)).toEqual(['puzzle', 'pipe']);
  });

  it('uses title only among sims that omit order', () => {
    const ordered = [meta({ id: 'b', title: 'Beta' }), meta({ id: 'a', title: 'Alpha' })];
    expect(ordered.sort(compareMetas).map((item) => item.id)).toEqual(['a', 'b']);
  });
});
