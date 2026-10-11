import type { SimMeta, SimModule } from './types';

interface MetaModule {
  meta: SimMeta;
}

interface SimFile {
  sim: SimModule;
}

const metaModules = import.meta.glob('../sims/*/meta.ts', {
  eager: true,
}) as Record<string, MetaModule>;

const simLoaders = import.meta.glob('../sims/*/index.ts') as Record<
  string,
  () => Promise<SimFile>
>;

export function compareMetas(a: SimMeta, b: SimMeta): number {
  const orderA = a.order ?? Number.POSITIVE_INFINITY;
  const orderB = b.order ?? Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  return a.title.localeCompare(b.title);
}

export function listMetas(): SimMeta[] {
  return Object.values(metaModules)
    .map((module) => module.meta)
    .sort(compareMetas);
}

export async function loadSim(id: string): Promise<SimModule> {
  const entry = Object.entries(simLoaders).find(([path]) => path.endsWith(`/sims/${id}/index.ts`));
  if (!entry) {
    throw new Error(`Unknown sim: ${id}`);
  }
  const file = await entry[1]();
  return file.sim;
}
