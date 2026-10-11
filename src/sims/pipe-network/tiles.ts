/** North, east, south, west. Bit `d` of a mask is an opening facing that way. */
const DELTA_ROW = [-1, 0, 1, 0];
const DELTA_COL = [0, 1, 0, -1];

export function opposite(dir: number): number {
  return dir ^ 2;
}

export function rotateMask(mask: number, turns: number): number {
  const steps = ((turns % 4) + 4) % 4;
  let rotated = 0;
  for (let dir = 0; dir < 4; dir += 1) {
    if ((mask & (1 << dir)) !== 0) rotated |= 1 << ((dir + steps) & 3);
  }
  return rotated;
}

export function degree(mask: number): number {
  let count = 0;
  let bits = mask;
  while (bits) {
    count += 1;
    bits &= bits - 1;
  }
  return count;
}

/**
 * Signed quarter-turns from `from` to `to`: -1, 0, 1, or 2.
 * A change of 3 clockwise quarters is the same pose as one quarter the other way.
 */
export function quarterDelta(from: number, to: number): number {
  const clockwise = (((to - from) % 4) + 4) % 4;
  if (clockwise === 3) return -1;
  return clockwise;
}

/** Clockwise turns that produce a distinct opening mask. Crosses have one, straights two. */
export function uniqueRotations(mask: number): number[] {
  const seen = new Set<number>();
  const turns: number[] = [];
  for (let turn = 0; turn < 4; turn += 1) {
    const rotated = rotateMask(mask, turn);
    if (seen.has(rotated)) continue;
    seen.add(rotated);
    turns.push(turn);
  }
  return turns;
}

export function neighbor(index: number, dir: number, size: number, wrap: boolean): number {
  const row = Math.floor(index / size);
  const col = index % size;
  let nextRow = row + DELTA_ROW[dir]!;
  let nextCol = col + DELTA_COL[dir]!;
  if (wrap) {
    nextRow = (nextRow + size) % size;
    nextCol = (nextCol + size) % size;
  } else if (nextRow < 0 || nextCol < 0 || nextRow >= size || nextCol >= size) {
    return -1;
  }
  const next = nextRow * size + nextCol;
  return next === index ? -1 : next;
}

export function applyRotations(base: Uint8Array, rotation: ArrayLike<number>): Uint8Array {
  const masks = new Uint8Array(base.length);
  for (let index = 0; index < base.length; index += 1) {
    masks[index] = rotateMask(base[index]!, rotation[index] ?? 0);
  }
  return masks;
}

/** Each opening that does not meet a matching opening, including openings off the board. */
export function countLeaks(
  masks: Uint8Array,
  size: number,
  wrap: boolean,
  present?: Uint8Array,
): number {
  let leaks = 0;
  const count = size * size;
  for (let index = 0; index < count; index += 1) {
    if (present && !present[index]) continue;
    const mask = masks[index]!;
    for (let dir = 0; dir < 4; dir += 1) {
      if ((mask & (1 << dir)) === 0) continue;
      const next = neighbor(index, dir, size, wrap);
      if (next < 0 || (present && !present[next])) {
        leaks += 1;
        continue;
      }
      if ((masks[next]! & (1 << opposite(dir))) === 0) leaks += 1;
    }
  }
  return leaks;
}

/** Cells reachable from `source` through openings that meet. */
export function connectedCount(masks: Uint8Array, size: number, wrap: boolean, source: number): number {
  const count = size * size;
  const seen = new Uint8Array(count);
  const stack = [source];
  seen[source] = 1;
  let reached = 0;
  while (stack.length > 0) {
    const index = stack.pop()!;
    reached += 1;
    const mask = masks[index]!;
    for (let dir = 0; dir < 4; dir += 1) {
      if ((mask & (1 << dir)) === 0) continue;
      const next = neighbor(index, dir, size, wrap);
      if (next < 0 || seen[next]) continue;
      if ((masks[next]! & (1 << opposite(dir))) === 0) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }
  return reached;
}

export function undirectedEdges(masks: Uint8Array): number {
  let openings = 0;
  for (let index = 0; index < masks.length; index += 1) openings += degree(masks[index]!);
  return openings / 2;
}
