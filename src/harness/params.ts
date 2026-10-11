import type { ParamDef, ParamSchema, Params } from './types';

export function defaultParams(schema: ParamSchema): Params {
  const params: Params = {};
  for (const [key, def] of Object.entries(schema)) {
    params[key] = def.default;
  }
  return params;
}

export function isStructural(def: ParamDef): boolean {
  return def.reset === true;
}

export function parseParam(def: ParamDef | undefined, raw: string): Params[string] | undefined {
  if (!def) return undefined;
  if (def.type === 'boolean') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return undefined;
  }
  if (def.type === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < def.min || value > def.max) return undefined;
    return snapNumber(def, value);
  }
  if (def.options.some((option) => option.value === raw)) return raw;
  return undefined;
}

export function applyQuery(schema: ParamSchema, query: Record<string, string>): Params {
  const params = defaultParams(schema);
  for (const [key, raw] of Object.entries(query)) {
    const parsed = parseParam(schema[key], raw);
    if (parsed !== undefined) params[key] = parsed;
  }
  return params;
}

function snapNumber(def: Extract<ParamDef, { type: 'number' }>, value: number): number {
  if (!def.step || def.step <= 0) return value;
  const steps = Math.round((value - def.min) / def.step);
  let snapped = def.min + steps * def.step;
  if (def.step < 1) {
    const decimals = Math.min(6, Math.max(0, Math.round(-Math.log10(def.step))));
    snapped = Number(snapped.toFixed(decimals));
  } else {
    snapped = Math.round(snapped);
  }
  return Math.min(def.max, Math.max(def.min, snapped));
}

export function differsFromDefault(def: ParamDef, value: Params[string]): boolean {
  if (def.type === 'number' && typeof value === 'number') {
    return Math.abs(value - def.default) > 1e-9;
  }
  return value !== def.default;
}

export function serializeParam(def: ParamDef, value: Params[string]): string {
  if (def.type === 'number' && typeof value === 'number') {
    if (def.step && def.step < 1) {
      const decimals = Math.min(6, Math.max(0, Math.round(-Math.log10(def.step))));
      return value.toFixed(decimals);
    }
    return String(Math.round(value));
  }
  return String(value);
}
