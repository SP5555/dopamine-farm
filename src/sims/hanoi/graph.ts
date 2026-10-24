export interface Move {
  /** 0 is the smallest disk. */
  disk: number;
  to: number;
}

export interface Point {
  x: number;
  y: number;
}

export function stateCount(disks: number): number {
  return 3 ** disks;
}

/** Peg of one disk. Disk 0 is the smallest. */
export function pegOf(state: number, disk: number): number {
  let value = state;
  for (let index = 0; index < disk; index += 1) value = Math.floor(value / 3);
  return value % 3;
}

export function moveDisk(state: number, disk: number, to: number): number {
  const from = pegOf(state, disk);
  return state + (to - from) * 3 ** disk;
}

/** Every disk on one peg. These three states are the corners of the triangle. */
export function solved(disks: number, peg: number): number {
  let state = 0;
  let place = 1;
  for (let disk = 0; disk < disks; disk += 1) {
    state += peg * place;
    place *= 3;
  }
  return state;
}

/** The peg every disk sits on, or -1 when the tower is not solved. */
export function solvedPeg(state: number, disks: number): number {
  const peg = pegOf(state, 0);
  for (let disk = 1; disk < disks; disk += 1) if (pegOf(state, disk) !== peg) return -1;
  return peg;
}

/** A disk may move when it is the top of its peg and the destination has nothing smaller. */
export function legalMoves(state: number, disks: number): Move[] {
  const top = [-1, -1, -1];
  for (let disk = disks - 1; disk >= 0; disk -= 1) top[pegOf(state, disk)] = disk;
  const moves: Move[] = [];
  for (let from = 0; from < 3; from += 1) {
    const disk = top[from] ?? -1;
    if (disk < 0) continue;
    for (let to = 0; to < 3; to += 1) {
      if (to === from) continue;
      const cover = top[to] ?? -1;
      if (cover >= 0 && cover < disk) continue;
      moves.push({ disk, to });
    }
  }
  return moves;
}

/** Each legal move once. The smaller state index comes first. */
export function legalEdges(disks: number): Array<[number, number]> {
  const lines: Array<[number, number]> = [];
  for (let state = 0; state < stateCount(disks); state += 1) {
    for (const move of legalMoves(state, disks)) {
      const next = moveDisk(state, move.disk, move.to);
      if (next > state) lines.push([state, next]);
    }
  }
  return lines;
}

/**
 * A shortest legal walk. Moving the biggest disk straight across is sometimes
 * longer than stepping it onto the spare peg first, so the walk is searched.
 */
export function shortestMoves(from: number, to: number, disks: number): Move[] {
  if (from === to) return [];
  const count = stateCount(disks);
  const cameFrom = new Int32Array(count);
  const viaDisk = new Int8Array(count);
  const viaPeg = new Int8Array(count);
  cameFrom.fill(-1);
  const queue = new Int32Array(count);
  const place = new Int32Array(disks);
  place[0] = 1;
  for (let disk = 1; disk < disks; disk += 1) place[disk] = place[disk - 1]! * 3;
  let head = 0;
  let tail = 1;
  queue[0] = from;
  cameFrom[from] = from;
  const top = [-1, -1, -1];

  while (head < tail) {
    const state = queue[head]!;
    head += 1;
    if (state === to) break;
    top[0] = -1;
    top[1] = -1;
    top[2] = -1;
    for (let disk = disks - 1; disk >= 0; disk -= 1) top[pegOf(state, disk)] = disk;
    for (let peg = 0; peg < 3; peg += 1) {
      const disk = top[peg] ?? -1;
      if (disk < 0) continue;
      for (let dest = 0; dest < 3; dest += 1) {
        if (dest === peg) continue;
        const cover = top[dest] ?? -1;
        if (cover >= 0 && cover < disk) continue;
        const next = state + (dest - peg) * place[disk]!;
        if (cameFrom[next] !== -1) continue;
        cameFrom[next] = state;
        viaDisk[next] = disk;
        viaPeg[next] = dest;
        queue[tail] = next;
        tail += 1;
      }
    }
  }

  if (cameFrom[to] === -1) return [];
  const moves: Move[] = [];
  for (let state = to; state !== from; state = cameFrom[state]!) {
    moves.push({ disk: viaDisk[state]!, to: viaPeg[state]! });
  }
  moves.reverse();
  return moves;
}

/**
 * Every arrangement gets its own dot. The three solved towers stay on the corners.
 * The two dots next to a corner swap places, and that swap repeats inside every
 * smaller copy, so a move never crosses another move. A tower of k disks fills
 * 2^k − 1 equal steps along a side, and the step between two copies is one of
 * those same steps, so every move has the same length. Carrying the whole tower
 * from one peg to another then walks only along the outer edge.
 */
export function pointOf(state: number, disks: number, corners: readonly [Point, Point, Point]): Point {
  return place(state, disks - 1, corners);
}

/**
 * Arrangements reachable by moving this disk and every smaller one.
 * Larger disks stay put. The bottom disk can reach the whole triangle.
 * The top disk can reach the three corners of the smallest triangle.
 */
export function regionOf(
  state: number,
  disks: number,
  disk: number,
  corners: readonly [Point, Point, Point],
): [Point, Point, Point] {
  let box: [Point, Point, Point] = [corners[0]!, corners[1]!, corners[2]!];
  for (let level = disks - 1; level > disk; level -= 1) box = nest(state, level, box);
  return box;
}

function place(state: number, disk: number, corners: readonly [Point, Point, Point]): Point {
  if (disk === 0) return corners[pegOf(state, disk)]!;
  return place(state, disk - 1, nest(state, disk, corners));
}

function nest(state: number, disk: number, corners: readonly [Point, Point, Point]): [Point, Point, Point] {
  return copyCorners(pegOf(state, disk), disk, corners);
}

/** Corners of the copy where `disk` sits on `peg`. The other two corners slide in along the sides. */
export function copyCorners(peg: number, disk: number, corners: readonly [Point, Point, Point]): [Point, Point, Point] {
  const along = (2 ** disk - 1) / (2 ** (disk + 1) - 1);
  const sub: [Point, Point, Point] = [corners[0]!, corners[1]!, corners[2]!];
  for (let other = 0; other < 3; other += 1) {
    if (other === peg) continue;
    sub[3 - peg - other] = between(corners[peg]!, corners[other]!, along);
  }
  return sub;
}

/** The one-step link between the copies where `disk` sits on peg `a` and peg `b`. */
export function bridgeOf(disk: number, a: number, b: number, corners: readonly [Point, Point, Point]): [Point, Point] {
  const along = (2 ** disk - 1) / (2 ** (disk + 1) - 1);
  return [between(corners[a]!, corners[b]!, along), between(corners[b]!, corners[a]!, along)];
}

function between(from: Point, toward: Point, along: number): Point {
  return { x: from.x + (toward.x - from.x) * along, y: from.y + (toward.y - from.y) * along };
}
