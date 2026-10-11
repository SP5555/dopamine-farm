import { describe, expect, it } from 'vitest';
import { applyQuery } from './params';
import { buildRoute, parseRoute } from './router';
import type { ParamSchema } from './types';

const schema: ParamSchema = {
  size: {
    type: 'select',
    label: 'Size',
    default: '4',
    options: [
      { value: '3', label: '3×3' },
      { value: '4', label: '4×4' },
    ],
  },
  showNumbers: { type: 'boolean', label: 'Numbers', default: true },
  weight: { type: 'number', label: 'Weight', default: 2, min: 1, max: 5, step: 0.1 },
};

describe('router', () => {
  it('reads a sim, seed, and params from the path', () => {
    const route = parseRoute('/demo?seed=17&size=3&showNumbers=false&nope=1');
    expect(route.simId).toBe('demo');
    expect(route.seed).toBe(17);
    expect(route.params).toEqual({ size: '3', showNumbers: 'false', nope: '1' });
  });

  it('writes the seed and only non-default params', () => {
    const path = buildRoute('demo', 17, schema, {
      size: '3',
      showNumbers: true,
      weight: 2.5,
    });
    expect(path.startsWith('/demo?')).toBe(true);
    expect(path.includes('#')).toBe(false);
    const route = parseRoute(path);
    expect(route.simId).toBe('demo');
    expect(route.seed).toBe(17);
    expect(route.params.size).toBe('3');
    expect(route.params.weight).toBe('2.5');
    expect(route.params.showNumbers).toBeUndefined();
  });

  it('ignores an invalid seed', () => {
    expect(parseRoute('/demo?seed=nope').seed).toBeNull();
    expect(parseRoute('#/demo?seed=17').simId).toBe('demo');
  });

  it('drops unknown and out-of-range params', () => {
    const params = applyQuery(schema, {
      size: '3',
      showNumbers: 'false',
      weight: '9',
      nope: '1',
    });
    expect(params.size).toBe('3');
    expect(params.showNumbers).toBe(false);
    expect(params.weight).toBe(2);
    expect(params.nope).toBeUndefined();
  });
});
