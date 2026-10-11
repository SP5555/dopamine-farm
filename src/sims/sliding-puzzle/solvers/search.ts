import type { Move } from '../board';

export interface Search {
  step(maxNodes?: number): void;
  solution(): Move[];
  readonly found: boolean;
  readonly aborted: boolean;
  readonly failed: boolean;
  readonly nodes: number;
  readonly bound: number | null;
  readonly openSize: number | null;
  readonly elapsedMs: number;
}
