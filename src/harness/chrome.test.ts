import { describe, expect, it } from 'vitest';
import { resolveChrome } from './chrome';
import type { ParamSchema } from './types';

const rings: ParamSchema = {
  rings: { type: 'number', label: 'Rings', default: 4, min: 1, max: 12 },
};

describe('resolveChrome', () => {
  it('shows Config when the schema has a param', () => {
    expect(resolveChrome({ params: rings })).toEqual({ params: true, seed: true });
  });

  it('hides Config when the schema is empty', () => {
    expect(resolveChrome({ params: {} })).toEqual({ params: false, seed: true });
  });

  it('keeps Config when asked, even with an empty schema', () => {
    expect(resolveChrome({ params: {}, chrome: { params: true } })).toEqual({ params: true, seed: true });
  });

  it('hides Config when asked', () => {
    expect(resolveChrome({ params: rings, chrome: { params: false } })).toEqual({ params: false, seed: true });
  });

  it('hides the seed when asked', () => {
    expect(resolveChrome({ params: rings, chrome: { seed: false } })).toEqual({ params: true, seed: false });
  });
});
