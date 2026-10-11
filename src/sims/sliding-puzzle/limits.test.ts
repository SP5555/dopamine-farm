import { describe, expect, it } from 'vitest';
import type { Params } from '../../harness/types';
import { applyLegal, legalize } from './limits';

describe('sliding puzzle limits', () => {
  it('keeps search solvers on 4×4 and gives larger boards to the human solver', () => {
    expect(legalize(bag({ size: '4', scramble: 'uniform', solver: 'ida', walkLength: 200, weight: 1 }))).toMatchObject({
      size: 4,
      scramble: 'uniform',
      solver: 'ida',
      walkLength: 200,
      weight: 1,
    });

    expect(legalize(bag({ size: '6', scramble: 'uniform', solver: 'wastar', walkLength: 80, weight: 1.4 }))).toMatchObject({
      size: 6,
      scramble: 'uniform',
      solver: 'human',
      walkLength: 80,
      weight: 1.4,
    });

    expect(legalize(bag({ size: '6', scramble: 'walk', solver: 'wastar', walkLength: 80, weight: 1.4 }))).toMatchObject({
      size: 6,
      scramble: 'walk',
      solver: 'human',
      walkLength: 80,
      weight: 1.4,
    });

    expect(legalize(bag({ size: '5', scramble: 'walk', solver: 'ida', walkLength: 50, weight: 2 }))).toMatchObject({
      size: 5,
      scramble: 'walk',
      solver: 'human',
      walkLength: 50,
      weight: 2,
    });

    expect(legalize(bag({ size: '10', scramble: 'uniform', solver: 'ida', walkLength: 50, weight: 2 }))).toMatchObject({
      size: 10,
      scramble: 'uniform',
      solver: 'human',
      walkLength: 50,
    });

    expect(legalize(bag({ size: '14', scramble: 'uniform', solver: 'frame', walkLength: 90, weight: 2 }))).toMatchObject({
      size: 14,
      scramble: 'uniform',
      solver: 'human',
      order: 'inward',
      walkLength: 90,
    });

    expect(legalize(bag({ size: '8', scramble: 'walk', solver: 'human', order: 'inward', walkLength: 40, weight: 2 }))).toMatchObject({
      solver: 'human',
      order: 'inward',
    });

    expect(legalize(bag({ size: '14', scramble: 'walk', solver: 'ida', walkLength: 40, weight: 2 }))).toMatchObject({
      size: 14,
      solver: 'human',
      walkLength: 40,
    });

    expect(legalize(bag({ size: '8', scramble: 'walk', solver: 'wastar', walkLength: 120, weight: 3 }))).toMatchObject({
      size: 8,
      scramble: 'walk',
      solver: 'human',
      walkLength: 120,
      weight: 3,
    });
  });

  it('writes the legal combination back onto the param bag', () => {
    const params = bag({ size: '6', scramble: 'uniform', solver: 'human', walkLength: 90, weight: 2 });
    applyLegal(params);
    expect(params.scramble).toBe('uniform');
    expect(params.solver).toBe('human');
    expect(params.order).toBe('rows');
    expect(params.walkLength).toBe(90);
  });
});

function bag(values: Params): Params {
  return { ...values };
}
