import type { Move } from '../board';

export interface Search {
  step(maxNodes?: number): void;
  solution(): Move[];
  /** Tiles each solution move is seating. Empty, or absent, means no highlight. */
  focus?(): readonly (readonly number[])[];
  readonly found: boolean;
  readonly aborted: boolean;
  readonly failed: boolean;
  readonly nodes: number;
  readonly bound: number | null;
  readonly openSize: number | null;
  readonly elapsedMs: number;
}
