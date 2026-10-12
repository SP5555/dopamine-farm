import type { Params, SelectOption } from '../../harness/types';

const SOLVERS = ['ida', 'wastar', 'human', 'pairs'] as const;

export type SolverId = (typeof SOLVERS)[number];
export type ScrambleId = 'walk' | 'uniform';
export type PlacementOrder = 'rows' | 'inward';

export interface LegalRun {
  size: number;
  scramble: ScrambleId;
  solver: SolverId;
  order: PlacementOrder;
  walkLength: number;
  weight: number;
}

export function boardSize(value: Params[string] | undefined): number {
  if (typeof value !== 'string') return 4;
  const size = Number(value);
  if (Number.isInteger(size) && size >= 3 && size <= 14) return size;
  return 4;
}

export function legalize(params: Params): LegalRun {
  const size = boardSize(params.size);
  let solver = solverId(params.solver);
  const order = placementOrder(params);
  let scramble: ScrambleId = params.scramble === 'uniform' ? 'uniform' : 'walk';
  let walkLength = clamp(Math.round(numberParam(params.walkLength, 50)), 10, 200);
  let weight = clamp(Math.round(numberParam(params.weight, 2) * 10) / 10, 1, 5);

  if (!solverFits(solver, size)) {
    solver = SOLVERS.find((candidate) => solverFits(candidate, size)) ?? 'human';
  }

  return { size, scramble, solver, order, walkLength, weight };
}

export function applyLegal(params: Params): void {
  const legal = legalize(params);
  params.size = String(legal.size);
  params.scramble = legal.scramble;
  params.solver = legal.solver;
  params.order = legal.order;
  params.walkLength = legal.walkLength;
  params.weight = legal.weight;
}

export function solverOptionAvailable(option: SelectOption, params: Params): boolean | { note: string; detail: string } {
  const size = boardSize(params.size);
  if (option.value === 'human' || option.value === 'pairs') return true;
  if (option.value === 'ida') {
    return size <= 4 ? true : { note: 'too big', detail: 'Optimal search only runs on a 3×3 or 4×4.' };
  }
  if (option.value === 'wastar') {
    return size <= 4 ? true : { note: 'too big', detail: 'The fast solver only runs on a 3×3 or 4×4.' };
  }
  return { note: 'unavailable', detail: 'This option is not available.' };
}

function solverFits(solver: SolverId, size: number): boolean {
  if (solver === 'human' || solver === 'pairs') return true;
  return size <= 4;
}

function solverId(value: Params[string] | undefined): SolverId {
  if (value === 'frame') return 'human';
  if (value === 'ida' || value === 'wastar' || value === 'human' || value === 'pairs') return value;
  return 'wastar';
}

function placementOrder(params: Params): PlacementOrder {
  if (params.order === 'inward' || params.order === 'rows') return params.order;
  return params.solver === 'frame' ? 'inward' : 'rows';
}

function numberParam(value: Params[string] | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
