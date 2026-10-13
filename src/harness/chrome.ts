import type { SimChrome, SimModule } from './types';

export type ResolvedChrome = Required<SimChrome>;

export function resolveChrome(module: Pick<SimModule, 'chrome' | 'params'>): ResolvedChrome {
  const declared = module.chrome ?? {};
  const hasParams = Object.keys(module.params).length > 0;
  return {
    params: declared.params ?? hasParams,
    seed: declared.seed ?? true,
  };
}
