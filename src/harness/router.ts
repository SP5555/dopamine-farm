import { differsFromDefault, serializeParam } from './params';
import type { ParamSchema, Params } from './types';

export interface Route {
  simId: string | null;
  seed: number | null;
  params: Record<string, string>;
}

export function parseRoute(value: string): Route {
  const body = value.startsWith('#') ? value.slice(1) : value;
  const queryAt = body.indexOf('?');
  const path = queryAt === -1 ? body : body.slice(0, queryAt);
  const query = queryAt === -1 ? '' : body.slice(queryAt + 1);
  const simId = decodeURIComponent(path.replace(/^\/+/, '')) || null;
  const search = new URLSearchParams(query);
  let seed: number | null = null;
  const params: Record<string, string> = {};
  for (const [key, value] of search) {
    if (key === 'seed') {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff) {
        seed = parsed;
      }
      continue;
    }
    params[key] = value;
  }
  return { simId, seed, params };
}

export function buildRoute(
  simId: string,
  seed: number,
  schema: ParamSchema,
  params: Params,
  includeSeed = true,
): string {
  const search = new URLSearchParams();
  if (includeSeed) search.set('seed', String(seed >>> 0));
  for (const [key, def] of Object.entries(schema)) {
    const value = params[key];
    if (value === undefined || !differsFromDefault(def, value)) continue;
    search.set(key, serializeParam(def, value));
  }
  const query = search.toString();
  const path = `/${encodeURIComponent(simId)}`;
  return query.length === 0 ? path : `${path}?${query}`;
}
