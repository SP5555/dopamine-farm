import { createRng } from '../../harness/author';
import { neighbor, opposite, rotateMask, uniqueRotations } from './tiles';

export interface Network {
  size: number;
  wrap: boolean;
  /**
   * Canonical opening mask. Rotation 0 is the most compact orientation of the
   * tile, not the generated tree, so a search that tries low rotations first
   * is not handed the answer.
   */
  mask: Uint8Array;
  /** Clockwise turns from `mask` back to the generated tree. */
  solution: Uint8Array;
  /** Clockwise turns from `mask` after the scramble. Distinct orientations only. */
  scramble: Uint8Array;
  source: number;
  /** Cell indexes, source first, in the order the tree attaches. */
  growth: Uint16Array;
}

/** Incremental Kruskal build. `advance` returns the network once the tree and scramble exist. */
export interface NetworkBuild {
  readonly progress: number;
  advance(edgeBudget: number): Network | null;
}

interface Edge {
  from: number;
  dir: number;
}

/**
 * Random spanning tree via shuffled Kruskal. The source is any cell, chosen
 * from the same stream, and the scramble is applied before the build reports
 * done. `advance` yields so a large grid can show a progress bar between slices.
 */
export function startNetwork(size: number, seed: number, wrap: boolean): NetworkBuild {
  const count = size * size;
  const rng = createRng(seed);
  const edges = edgeList(size, wrap);
  rng.shuffle(edges);

  const parent = new Int32Array(count);
  for (let index = 0; index < count; index += 1) parent[index] = index;
  const mask = new Uint8Array(count);
  let joined = 0;
  let cursor = 0;
  let progress = edges.length === 0 ? 1 : 0;

  return {
    get progress() {
      return progress;
    },
    advance(edgeBudget: number): Network | null {
      const budget = Math.max(1, edgeBudget);
      let used = 0;
      while (cursor < edges.length && joined < count - 1 && used < budget) {
        const edge = edges[cursor]!;
        cursor += 1;
        used += 1;
        const rootFrom = find(parent, edge.from);
        const next = neighbor(edge.from, edge.dir, size, wrap);
        const rootNext = find(parent, next);
        if (rootFrom === rootNext) continue;
        parent[rootNext] = rootFrom;
        mask[edge.from] = mask[edge.from]! | (1 << edge.dir);
        mask[next] = mask[next]! | (1 << opposite(edge.dir));
        joined += 1;
      }
      if (joined < count - 1 && cursor < edges.length) {
        progress = cursor / edges.length;
        return null;
      }

      const source = rng.int(count);
      const growth = growthOrder(mask, size, wrap, source);
      const base = new Uint8Array(count);
      const solution = new Uint8Array(count);
      const scramble = new Uint8Array(count);
      for (let index = 0; index < count; index += 1) {
        const canonical = canonicalize(mask[index]!);
        base[index] = canonical.base;
        solution[index] = canonical.solution;
        const options = uniqueRotations(canonical.base);
        scramble[index] = options[rng.int(options.length)]!;
      }
      progress = 1;
      return { size, wrap, mask: base, solution, scramble, source, growth };
    },
  };
}

export function generateNetwork(size: number, seed: number, wrap: boolean): Network {
  const build = startNetwork(size, seed, wrap);
  let network: Network | null = null;
  while (network === null) network = build.advance(1_000_000);
  return network;
}

function canonicalize(treeMask: number): { base: number; solution: number } {
  let base = treeMask;
  for (let turn = 1; turn < 4; turn += 1) {
    const turned = rotateMask(treeMask, turn);
    if (turned < base) base = turned;
  }
  for (let turn = 0; turn < 4; turn += 1) {
    if (rotateMask(base, turn) === treeMask) return { base, solution: turn };
  }
  return { base, solution: 0 };
}

function edgeList(size: number, wrap: boolean): Edge[] {
  const edges: Edge[] = [];
  const count = size * size;
  for (let index = 0; index < count; index += 1) {
    const col = index % size;
    const row = Math.floor(index / size);
    if (wrap || col + 1 < size) edges.push({ from: index, dir: 1 });
    if (wrap || row + 1 < size) edges.push({ from: index, dir: 2 });
  }
  return edges;
}

function find(parent: Int32Array, index: number): number {
  let cursor = index;
  while (parent[cursor] !== cursor) cursor = parent[cursor]!;
  let compress = index;
  while (parent[compress] !== cursor) {
    const next = parent[compress]!;
    parent[compress] = cursor;
    compress = next;
  }
  return cursor;
}

function growthOrder(mask: Uint8Array, size: number, wrap: boolean, source: number): Uint16Array {
  const count = size * size;
  const order = new Uint16Array(count);
  const seen = new Uint8Array(count);
  const queue = [source];
  seen[source] = 1;
  let write = 0;
  let read = 0;
  while (read < queue.length) {
    const index = queue[read]!;
    read += 1;
    order[write] = index;
    write += 1;
    const openings = mask[index]!;
    for (let dir = 0; dir < 4; dir += 1) {
      if ((openings & (1 << dir)) === 0) continue;
      const next = neighbor(index, dir, size, wrap);
      if (next < 0 || seen[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return order;
}
