import { quarterDelta, rotateMask } from './tiles';

export interface PipeCell {
  present: boolean;
  rot: number;
  /**
   * Painted turn count. 4 is iron, even when the tile has fewer distinct turns.
   * 2 or 3 is the in-progress blue. A lock paints mint, and a guess paints brass, through `role`.
   */
  options: number;
  /** Distinct turns this tile had before the solver removed any. */
  baseline: number;
  role: 'open' | 'deduction' | 'guess';
}

export type PipePending =
  | { type: 'lock'; index: number; from: number; to: number; kind: 'deduction' | 'guess' }
  | { type: 'unlock'; index: number; from: number; to: number; options: number }
  | { type: 'turn'; index: number; from: number; to: number; options: number }
  | { type: 'tint'; index: number; options: number };

export interface PipeDraw {
  cells: PipeCell[];
  base: Uint8Array;
  size: number;
  pending: PipePending | null;
  alpha: number;
  width: number;
  height: number;
  dpr: number;
  solvedAt: number;
  reducedMotion: boolean;
}

interface Layout {
  originX: number;
  originY: number;
  cell: number;
  /** Full pipe width: 3-unit channel plus a 1-unit wall on each side. */
  outer: number;
  /** Channel width, 3 units. */
  inner: number;
  /** Centerline radius of a bend. Larger than half the pipe, so the inner wall stays open. */
  bend: number;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const STAGE = '#12141a';
const PLATE = '#232733';
const SOCKET = '#1a1e27';
const OPEN: Rgba = { r: 63, g: 67, b: 74, a: 1 };
const OPEN_CORE: Rgba = { r: 34, g: 37, b: 42, a: 1 };
const NARROWED: Rgba = { r: 106, g: 168, b: 201, a: 1 };
const NARROWED_CORE: Rgba = { r: 46, g: 92, b: 118, a: 1 };
const DEDUCED: Rgba = { r: 125, g: 206, b: 160, a: 1 };
const DEDUCED_CORE: Rgba = { r: 46, g: 108, b: 78, a: 1 };
const GUESS: Rgba = { r: 212, g: 160, b: 74, a: 1 };
const GUESS_CORE: Rgba = { r: 122, g: 86, b: 32, a: 1 };
const SOLVED_PULSE: Rgba = { r: 229, g: 246, b: 236, a: 1 };

export function drawNetwork(ctx: CanvasRenderingContext2D, state: PipeDraw): void {
  const { width, height, dpr } = state;
  if (width < 2 || height < 2) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = STAGE;
  ctx.fillRect(0, 0, width, height);

  const layout = layoutGrid(state.size, width, height);
  drawPlate(ctx, layout, state.size);
  const alpha = clamp01(state.alpha);
  const progress = state.reducedMotion ? 1 : ease(alpha);

  for (let index = 0; index < state.cells.length; index += 1) {
    drawSocket(ctx, layout, state.size, index);
  }
  for (let index = 0; index < state.cells.length; index += 1) {
    drawCell(ctx, state, layout, index, progress);
  }
  if (state.solvedAt > 0 && !state.reducedMotion && !state.pending) {
    drawPulse(ctx, layout, state.size, state.solvedAt);
  }
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  state: PipeDraw,
  layout: Layout,
  index: number,
  progress: number,
): void {
  const cell = state.cells[index]!;
  if (!cell.present) return;

  const pending = state.pending?.index === index ? state.pending : null;
  const shown = appearance(cell, pending, progress);
  const point = cellOrigin(layout, state.size, index);
  const mask = rotateMask(state.base[index]!, shown.rot);
  const half = layout.cell / 2;
  const reach = half + 0.75;

  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(shown.angle);
  ctx.globalAlpha = shown.alpha;
  fillPipe(ctx, mask, reach, layout.outer, shown.body, layout.bend);
  fillPipe(ctx, mask, reach, layout.inner, shown.core, layout.bend);
  ctx.restore();
}

function appearance(
  cell: PipeCell,
  pending: PipePending | null,
  progress: number,
): { rot: number; angle: number; alpha: number; body: string; core: string } {
  let fromRole = cell.role;
  let toRole = cell.role;
  let fromOptions = cell.options;
  let toOptions = cell.options;
  let from = cell.rot;
  let to = cell.rot;
  let blend = 0;
  if (pending?.type === 'lock') {
    from = pending.from;
    to = pending.to;
    fromRole = 'open';
    toRole = pending.kind;
    toOptions = 1;
    blend = progress;
  } else if (pending?.type === 'unlock') {
    from = pending.from;
    to = pending.to;
    fromRole = cell.role;
    toRole = 'open';
    toOptions = pending.options;
    blend = progress;
  } else if (pending?.type === 'turn') {
    from = pending.from;
    to = pending.to;
    fromRole = 'open';
    toRole = 'open';
    toOptions = pending.options;
    blend = progress;
  } else if (pending?.type === 'tint') {
    fromRole = 'open';
    toRole = 'open';
    toOptions = pending.options;
    blend = progress;
  }

  const start = pipeColor(fromRole, fromOptions);
  const end = pipeColor(toRole, toOptions);
  return {
    rot: from,
    angle: quarterDelta(from, to) * blend * (Math.PI / 2),
    alpha: start.alpha + (end.alpha - start.alpha) * blend,
    body: mix(start.body, end.body, blend),
    core: mix(start.core, end.core, blend),
  };
}

function pipeColor(role: PipeCell['role'], options: number): { body: Rgba; core: Rgba; alpha: number } {
  if (role === 'guess') return { body: GUESS, core: GUESS_CORE, alpha: 1 };
  if (role === 'deduction') return { body: DEDUCED, core: DEDUCED_CORE, alpha: 1 };
  if (options < 4) return { body: NARROWED, core: NARROWED_CORE, alpha: 1 };
  return { body: OPEN, core: OPEN_CORE, alpha: 1 };
}

/**
 * One pipe outline. Ends stop flat at `reach` so neighbors meet on a straight
 * edge. A bend is two concentric arcs around one center, and a dead end
 * closes with a semicircle, so the wall stays one unit thick through both.
 */
function fillPipe(
  ctx: CanvasRenderingContext2D,
  mask: number,
  reach: number,
  width: number,
  color: string,
  bend: number,
): void {
  const h = width / 2;
  if (h <= 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  const open: number[] = [];
  for (let dir = 0; dir < 4; dir += 1) {
    if ((mask & (1 << dir)) !== 0) open.push(dir);
  }
  if (open.length === 1) traceStub(ctx, open[0]!, reach, h);
  else if (open.length === 2 && open[1]! - open[0]! === 2) traceStraight(ctx, open[0]!, reach, h);
  else if (open.length === 2) traceElbow(ctx, open[0]!, open[1]!, reach, h, bend);
  else if (open.length === 3) {
    const closed = [0, 1, 2, 3].find((dir) => (mask & (1 << dir)) === 0)!;
    traceTee(ctx, (closed + 2) & 3, reach, h, bend);
  } else if (open.length === 4) traceCross(ctx, reach, h, bend);
  ctx.fill();
}

const OUT_X = [0, 1, 0, -1];
const OUT_Y = [-1, 0, 1, 0];
const RIGHT_X = [1, 0, -1, 0];
const RIGHT_Y = [0, 1, 0, -1];

function armPoint(dir: number, along: number, side: number): { x: number; y: number } {
  return {
    x: OUT_X[dir]! * along + RIGHT_X[dir]! * side,
    y: OUT_Y[dir]! * along + RIGHT_Y[dir]! * side,
  };
}

function traceStub(ctx: CanvasRenderingContext2D, dir: number, reach: number, h: number): void {
  const capL = armPoint(dir, reach, -h);
  const capR = armPoint(dir, reach, h);
  const shoulderR = armPoint(dir, 0, h);
  const shoulderL = armPoint(dir, 0, -h);
  const tip = armPoint(dir, -h, 0);
  ctx.moveTo(capL.x, capL.y);
  ctx.lineTo(capR.x, capR.y);
  ctx.lineTo(shoulderR.x, shoulderR.y);
  semicircle(ctx, shoulderR, shoulderL, tip);
  ctx.closePath();
}

/** Semicircle through `tip`. Both halves are the same length, so the short-arc rule would flip a coin. */
function semicircle(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  tip: { x: number; y: number },
): void {
  const a0 = Math.atan2(from.y, from.x);
  const a1 = Math.atan2(to.y, to.x);
  const at = Math.atan2(tip.y, tip.x);
  const wrap = (delta: number) => {
    const turned = delta % (Math.PI * 2);
    return turned < 0 ? turned + Math.PI * 2 : turned;
  };
  const forward = wrap(at - a0) <= wrap(a1 - a0) + 1e-4;
  ctx.arc(0, 0, Math.hypot(from.x, from.y), a0, a1, !forward);
}

function traceStraight(ctx: CanvasRenderingContext2D, dir: number, reach: number, h: number): void {
  if (dir === 0 || dir === 2) ctx.rect(-h, -reach, h * 2, reach * 2);
  else ctx.rect(-reach, -h, reach * 2, h * 2);
}

function traceElbow(
  ctx: CanvasRenderingContext2D,
  a: number,
  b: number,
  reach: number,
  h: number,
  bend: number,
): void {
  if (((a + 1) & 3) !== b) [a, b] = [b, a];
  const capAL = armPoint(a, reach, -h);
  const capAR = armPoint(a, reach, h);
  const innerA = armPoint(a, bend, h);
  const innerB = armPoint(b, bend, -h);
  const capBL = armPoint(b, reach, -h);
  const capBR = armPoint(b, reach, h);
  const outerB = armPoint(b, bend, h);
  const outerA = armPoint(a, bend, -h);
  const center = bendCenter(a, b, bend);
  ctx.moveTo(capAL.x, capAL.y);
  ctx.lineTo(capAR.x, capAR.y);
  ctx.lineTo(innerA.x, innerA.y);
  shortArc(ctx, center, bend - h, innerA, innerB);
  ctx.lineTo(capBL.x, capBL.y);
  ctx.lineTo(capBR.x, capBR.y);
  ctx.lineTo(outerB.x, outerB.y);
  shortArc(ctx, center, bend + h, outerB, outerA);
  ctx.closePath();
}

function traceTee(
  ctx: CanvasRenderingContext2D,
  branch: number,
  reach: number,
  h: number,
  bend: number,
): void {
  const ccw = (branch + 3) & 3;
  const cw = (branch + 1) & 3;
  const capL = armPoint(ccw, reach, -h);
  ctx.moveTo(capL.x, capL.y);
  ctx.lineTo(armPoint(ccw, reach, h).x, armPoint(ccw, reach, h).y);
  ctx.lineTo(armPoint(ccw, bend, h).x, armPoint(ccw, bend, h).y);
  shortArc(ctx, bendCenter(ccw, branch, bend), bend - h, armPoint(ccw, bend, h), armPoint(branch, bend, -h));
  ctx.lineTo(armPoint(branch, reach, -h).x, armPoint(branch, reach, -h).y);
  ctx.lineTo(armPoint(branch, reach, h).x, armPoint(branch, reach, h).y);
  ctx.lineTo(armPoint(branch, bend, h).x, armPoint(branch, bend, h).y);
  shortArc(ctx, bendCenter(branch, cw, bend), bend - h, armPoint(branch, bend, h), armPoint(cw, bend, -h));
  ctx.lineTo(armPoint(cw, reach, -h).x, armPoint(cw, reach, -h).y);
  ctx.lineTo(armPoint(cw, reach, h).x, armPoint(cw, reach, h).y);
  ctx.closePath();
}

function traceCross(ctx: CanvasRenderingContext2D, reach: number, h: number, bend: number): void {
  ctx.moveTo(armPoint(0, reach, -h).x, armPoint(0, reach, -h).y);
  for (let dir = 0; dir < 4; dir += 1) {
    const next = (dir + 1) & 3;
    ctx.lineTo(armPoint(dir, reach, h).x, armPoint(dir, reach, h).y);
    ctx.lineTo(armPoint(dir, bend, h).x, armPoint(dir, bend, h).y);
    shortArc(ctx, bendCenter(dir, next, bend), bend - h, armPoint(dir, bend, h), armPoint(next, bend, -h));
    ctx.lineTo(armPoint(next, reach, -h).x, armPoint(next, reach, -h).y);
  }
  ctx.closePath();
}

function bendCenter(a: number, b: number, bend: number): { x: number; y: number } {
  return {
    x: (OUT_X[a]! + OUT_X[b]!) * bend,
    y: (OUT_Y[a]! + OUT_Y[b]!) * bend,
  };
}

function shortArc(
  ctx: CanvasRenderingContext2D,
  center: { x: number; y: number },
  radius: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  if (radius <= 0) {
    ctx.lineTo(to.x, to.y);
    return;
  }
  const a0 = Math.atan2(from.y - center.y, from.x - center.x);
  const a1 = Math.atan2(to.y - center.y, to.x - center.x);
  let delta = a1 - a0;
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  ctx.arc(center.x, center.y, radius, a0, a1, delta < 0);
}

function drawPlate(ctx: CanvasRenderingContext2D, layout: Layout, size: number): void {
  const pad = Math.max(8, layout.cell * 0.16);
  const side = layout.cell * size + pad * 2;
  ctx.fillStyle = PLATE;
  ctx.beginPath();
  ctx.roundRect(layout.originX - pad, layout.originY - pad, side, side, Math.max(10, layout.cell * 0.2));
  ctx.fill();
}

function drawSocket(ctx: CanvasRenderingContext2D, layout: Layout, size: number, index: number): void {
  const point = cellOrigin(layout, size, index);
  const well = layout.cell * 0.84;
  ctx.fillStyle = SOCKET;
  ctx.beginPath();
  ctx.roundRect(point.x - well / 2, point.y - well / 2, well, well, Math.max(4, layout.cell * 0.16));
  ctx.fill();
}

function drawPulse(ctx: CanvasRenderingContext2D, layout: Layout, size: number, solvedAt: number): void {
  const age = performance.now() - solvedAt;
  if (age < 0 || age > 2600) return;
  const fade = 1 - age / 2600;
  ctx.save();
  ctx.globalAlpha = 0.18 * fade;
  ctx.strokeStyle = rgbaCss(SOLVED_PULSE);
  ctx.lineWidth = 6;
  const pad = Math.max(8, layout.cell * 0.16);
  const side = layout.cell * size + pad * 2;
  const grow = 1 - fade;
  ctx.strokeRect(
    layout.originX - pad - grow * 10,
    layout.originY - pad - grow * 10,
    side + grow * 20,
    side + grow * 20,
  );
  ctx.restore();
}

function layoutGrid(size: number, width: number, height: number): Layout {
  const margin = Math.max(28, Math.min(width, height) * 0.08);
  const side = Math.max(size, Math.min(width, height) - margin * 2);
  const cell = side / size;
  const unit = cell / 16;
  return {
    originX: (width - side) / 2,
    originY: (height - side) / 2,
    cell,
    outer: unit * 5,
    inner: unit * 3,
    bend: unit * 4,
  };
}

function cellOrigin(layout: Layout, size: number, index: number): { x: number; y: number } {
  const row = Math.floor(index / size);
  const col = index % size;
  return {
    x: layout.originX + (col + 0.5) * layout.cell,
    y: layout.originY + (row + 0.5) * layout.cell,
  };
}

function mix(from: Rgba, to: Rgba, t: number): string {
  return rgbaCss({
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
    a: 1,
  });
}

function rgbaCss(color: Rgba): string {
  return `rgba(${color.r | 0}, ${color.g | 0}, ${color.b | 0}, ${color.a})`;
}

function ease(value: number): number {
  return value * value * (3 - 2 * value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
