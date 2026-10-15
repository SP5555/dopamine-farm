import { FLIP_ANGLE, fitLayout, project, type Layout } from './geometry';
import { visitFaces, type Orient } from './heightmap';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Palette {
  id: string;
  label: string;
  detail: string;
  top: Rgb;
  left: Rgb;
  right: Rgb;
  outline: string;
}

export const PALETTES: Palette[] = [
  {
    id: 'amber',
    label: 'Amber',
    detail: 'Warm stone. Light across the top faces.',
    top: { r: 243, g: 224, b: 196 },
    left: { r: 196, g: 122, b: 74 },
    right: { r: 138, g: 74, b: 48 },
    outline: 'rgba(48, 26, 16, 0.45)',
  },
  {
    id: 'moss',
    label: 'Moss',
    detail: 'Soft green cubes.',
    top: { r: 220, g: 232, b: 206 },
    left: { r: 118, g: 156, b: 104 },
    right: { r: 58, g: 84, b: 60 },
    outline: 'rgba(20, 36, 22, 0.45)',
  },
  {
    id: 'rgb',
    label: 'RGB',
    detail: 'Soft red, green, and blue. One hue on each face.',
    top: { r: 224, g: 150, b: 146 },
    left: { r: 138, g: 186, b: 150 },
    right: { r: 142, g: 170, b: 210 },
    outline: 'rgba(36, 32, 40, 0.4)',
  },
];

export const ANIMATIONS = [
  { id: 'rotate', label: 'Rotate', detail: 'The three lozenges turn into the hole they leave. A move on screen finishes first.' },
  {
    id: 'slide',
    label: 'Slide',
    detail: 'Each lozenge slides onto the parallel face. The three faces leave in a random order, one after another. A move on screen finishes first.',
  },
] as const;

export type AnimationId = (typeof ANIMATIONS)[number]['id'];

export function animationById(id: string): AnimationId {
  for (const item of ANIMATIONS) {
    if (item.id === id) return item.id;
  }
  return 'rotate';
}

const STAGE = '#12141a';

/** A +60° turn carries each lozenge onto the hole face of this orientation. */
const LANDS_ON: Record<Orient, Orient> = {
  ab: 'ca',
  bc: 'ab',
  ca: 'bc',
};

/** A −60° turn is that cycle run backward. */
const LANDS_BACK: Record<Orient, Orient> = {
  ab: 'bc',
  bc: 'ca',
  ca: 'ab',
};

/**
 * Lattice step onto the parallel face.
 * Removal lowers the top and sends each front wall across the cube.
 * Addition is that step reversed. `distance` is 1 for one cube and the box size for the finale.
 */
export function faceSlide(orient: Orient, removing: boolean, distance = 1): [number, number, number] {
  const step = (removing ? -1 : 1) * distance;
  if (orient === 'ab') return [0, 0, step];
  if (orient === 'bc') return [step, 0, 0];
  return [0, step, 0];
}

/** Larger is closer to the camera. `turn` is how far this lozenge has slid, 0 to 1. */
export function slidDepth(
  orient: Orient,
  i: number,
  j: number,
  k: number,
  turn: number,
  removing: boolean,
  distance: number,
): number {
  const [di, dj, dk] = faceSlide(orient, removing, distance);
  return i + j + k + (di + dj + dk) * turn;
}

/** One face's share of the step, as a fraction of the whole move. */
export interface SlideWindow {
  start: number;
  end: number;
}

/** First face, then second, then third. `order` is a permutation of the three orientations. */
const SLIDE_SLOTS: readonly SlideWindow[] = [
  { start: 0, end: 0.6 },
  { start: 0.2, end: 0.8 },
  { start: 0.4, end: 1 },
];

export function slideWindows(order: readonly Orient[]): Record<Orient, SlideWindow> {
  const windows = { ab: SLIDE_SLOTS[0]!, bc: SLIDE_SLOTS[1]!, ca: SLIDE_SLOTS[2]! };
  for (let index = 0; index < order.length; index += 1) windows[order[index]!] = SLIDE_SLOTS[index]!;
  return windows;
}

/** Held until `start`, arrived at `end`, eased in between. `alpha` runs 0 to 1 across the step. */
export function slideProgress(alpha: number, window: SlideWindow): number {
  return smooth((alpha - window.start) / (window.end - window.start));
}

export interface LozengeDraw {
  heights: Uint8Array;
  a: number;
  b: number;
  c: number;
  pending: { i: number; j: number } | null;
  /** +1 removes a cube, −1 adds one, 0 draws the committed tiling. */
  flip: number;
  /** +1 spins clockwise, the way a cube leaves. −1 spins the other way. */
  spin: number;
  alpha: number;
  /** Per-face timing for Slide. Rotate ignores it. */
  windows: Record<Orient, SlideWindow>;
  animation: AnimationId;
  palette: string;
  width: number;
  height: number;
  dpr: number;
  reducedMotion: boolean;
}

const xy = new Float64Array(8);

export function drawLozenges(ctx: CanvasRenderingContext2D, state: LozengeDraw): void {
  const { width, height, dpr } = state;
  if (width < 2 || height < 2) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = STAGE;
  ctx.fillRect(0, 0, width, height);

  const layout = fitLayout(state.a, state.b, state.c, width, height);
  const palette = paletteById(state.palette);
  const slide = state.animation === 'slide';
  const animate = !state.reducedMotion && state.alpha > 0;
  const showSpin = state.spin !== 0 && animate;
  if (showSpin) {
    if (slide) drawSlideSpin(ctx, state, layout, palette);
    else drawSpin(ctx, state, layout, palette, state.spin > 0 ? LANDS_ON : LANDS_BACK);
    return;
  }

  const pending = state.pending;
  const adding = state.flip < 0;
  const cubeHeight = pending ? state.heights[pending.i * state.b + pending.j]! : 0;
  const showFlip = pending !== null && state.flip !== 0 && animate;
  const turn = showFlip ? smooth(state.alpha) : 0;

  const paths = emptyPaths();
  visitFaces(state.heights, state.a, state.b, state.c, (orient, i, j, k) => {
    if (showFlip && pending && skipsFace(adding, orient, i, j, k, pending.i, pending.j, cubeHeight)) return;
    writeFace(orient, i, j, k, layout);
    outset(0.45);
    addPath(paths[orient]);
  });

  ctx.fillStyle = rgb(palette.right);
  ctx.fill(paths.bc);
  ctx.fillStyle = rgb(palette.left);
  ctx.fill(paths.ca);
  ctx.fillStyle = rgb(palette.top);
  ctx.fill(paths.ab);
  strokePaths(ctx, paths, palette, layout.edge);

  if (!showFlip || !pending) return;
  const faces = movingFaces(adding, pending.i, pending.j, cubeHeight);
  if (slide) {
    const removing = !adding;
    for (const [orient, i, j, k] of faces) {
      drawSliding(ctx, orient, i, j, k, layout, slideProgress(state.alpha, state.windows[orient]), removing, palette);
    }
    return;
  }
  const level = adding ? cubeHeight : cubeHeight - 1;
  const [cx, cy] = project(pending.i, pending.j, level, layout.originX, layout.originY, layout.edge);
  const angle = (adding ? -turn : turn) * FLIP_ANGLE;
  const lands = adding ? LANDS_BACK : LANDS_ON;
  for (const [orient, i, j, k] of faces) {
    drawTurning(ctx, orient, i, j, k, layout, cx, cy, angle, turn, palette, lands);
  }
}

export function paletteById(id: string): Palette {
  return PALETTES.find((item) => item.id === id) ?? PALETTES[0]!;
}

function drawSlideSpin(
  ctx: CanvasRenderingContext2D,
  state: LozengeDraw,
  layout: Layout,
  palette: Palette,
): void {
  const removing = state.spin > 0;
  const paths = emptyPaths();
  const depthSum: Record<Orient, number> = { ab: 0, bc: 0, ca: 0 };
  const count: Record<Orient, number> = { ab: 0, bc: 0, ca: 0 };
  visitFaces(state.heights, state.a, state.b, state.c, (orient, i, j, k) => {
    writeFace(orient, i, j, k, layout);
    outset(0.45);
    const distance = orient === 'ab' ? state.c : orient === 'bc' ? state.a : state.b;
    const turn = slideProgress(state.alpha, state.windows[orient]);
    const [di, dj, dk] = faceSlide(orient, removing, distance);
    shiftScratch(di * turn, dj * turn, dk * turn, layout);
    addPath(paths[orient]);
    depthSum[orient] += slidDepth(orient, i, j, k, turn, removing, distance);
    count[orient] += 1;
  });
  // Farther sheet first. Its grid is painted with it, so a nearer sheet covers both.
  const order: Orient[] = ['bc', 'ca', 'ab'];
  order.sort((left, right) => depthSum[left] / count[left] - depthSum[right] / count[right]);
  markOutline(ctx, palette, layout.edge);
  for (const orient of order) {
    ctx.fillStyle = rgb(shade(palette, orient));
    ctx.fill(paths[orient]);
    ctx.stroke(paths[orient]);
  }
}

function drawSliding(
  ctx: CanvasRenderingContext2D,
  orient: Orient,
  i: number,
  j: number,
  k: number,
  layout: Layout,
  turn: number,
  removing: boolean,
  palette: Palette,
): void {
  writeFace(orient, i, j, k, layout);
  outset(0.45);
  const [di, dj, dk] = faceSlide(orient, removing);
  shiftScratch(di * turn, dj * turn, dk * turn, layout);
  traceScratch(ctx);
  ctx.fillStyle = rgb(shade(palette, orient));
  ctx.fill();
  markOutline(ctx, palette, layout.edge);
  ctx.stroke();
}

function drawSpin(
  ctx: CanvasRenderingContext2D,
  state: LozengeDraw,
  layout: Layout,
  palette: Palette,
  lands: Record<Orient, Orient>,
): void {
  const turn = smooth(state.alpha);
  const angle = (state.spin > 0 ? turn : -turn) * FLIP_ANGLE;
  const [cx, cy] = project(state.a / 2, state.b / 2, state.c / 2, layout.originX, layout.originY, layout.edge);
  const paths = emptyPaths();
  visitFaces(state.heights, state.a, state.b, state.c, (orient, i, j, k) => {
    writeFace(orient, i, j, k, layout);
    outset(0.45);
    rotateScratch(cx, cy, angle);
    addPath(paths[orient]);
  });
  ctx.fillStyle = mix(shade(palette, 'bc'), shade(palette, lands.bc), turn);
  ctx.fill(paths.bc);
  ctx.fillStyle = mix(shade(palette, 'ca'), shade(palette, lands.ca), turn);
  ctx.fill(paths.ca);
  ctx.fillStyle = mix(shade(palette, 'ab'), shade(palette, lands.ab), turn);
  ctx.fill(paths.ab);
  strokePaths(ctx, paths, palette, layout.edge);
}

function drawTurning(
  ctx: CanvasRenderingContext2D,
  orient: Orient,
  i: number,
  j: number,
  k: number,
  layout: Layout,
  cx: number,
  cy: number,
  angle: number,
  turn: number,
  palette: Palette,
  lands: Record<Orient, Orient>,
): void {
  writeFace(orient, i, j, k, layout);
  outset(0.45);
  rotateScratch(cx, cy, angle);
  traceScratch(ctx);
  ctx.fillStyle = mix(shade(palette, orient), shade(palette, lands[orient]), turn);
  ctx.fill();
  markOutline(ctx, palette, layout.edge);
  ctx.stroke();
}

function emptyPaths(): Record<Orient, Path2D> {
  return { ab: new Path2D(), bc: new Path2D(), ca: new Path2D() };
}

function movingFaces(
  adding: boolean,
  i: number,
  j: number,
  height: number,
): Array<[Orient, number, number, number]> {
  if (adding) {
    return [
      ['ab', i, j, height],
      ['bc', i, j, height],
      ['ca', i, j, height],
    ];
  }
  const level = height - 1;
  return [
    ['ab', i, j, height],
    ['bc', i + 1, j, level],
    ['ca', i, j + 1, level],
  ];
}

function strokePaths(
  ctx: CanvasRenderingContext2D,
  paths: Record<Orient, Path2D>,
  palette: Palette,
  edge: number,
): void {
  markOutline(ctx, palette, edge);
  ctx.stroke(paths.ab);
  ctx.stroke(paths.bc);
  ctx.stroke(paths.ca);
}

function markOutline(ctx: CanvasRenderingContext2D, palette: Palette, edge: number): void {
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = outlineWidth(edge);
  ctx.lineJoin = 'round';
}

function skipsFace(
  adding: boolean,
  orient: Orient,
  i: number,
  j: number,
  k: number,
  cubeI: number,
  cubeJ: number,
  height: number,
): boolean {
  if (adding) return i === cubeI && j === cubeJ && k === height;
  return isFlip(orient, i, j, k, cubeI, cubeJ, height);
}

function isFlip(orient: Orient, i: number, j: number, k: number, cubeI: number, cubeJ: number, height: number): boolean {
  const level = height - 1;
  if (orient === 'ab') return i === cubeI && j === cubeJ && k === height;
  if (orient === 'bc') return i === cubeI + 1 && j === cubeJ && k === level;
  return i === cubeI && j === cubeJ + 1 && k === level;
}

function writeFace(orient: Orient, i: number, j: number, k: number, layout: Layout): void {
  if (orient === 'ab') {
    put(0, i, j, k, layout);
    put(2, i + 1, j, k, layout);
    put(4, i + 1, j + 1, k, layout);
    put(6, i, j + 1, k, layout);
    return;
  }
  if (orient === 'bc') {
    put(0, i, j, k, layout);
    put(2, i, j + 1, k, layout);
    put(4, i, j + 1, k + 1, layout);
    put(6, i, j, k + 1, layout);
    return;
  }
  put(0, i, j, k, layout);
  put(2, i + 1, j, k, layout);
  put(4, i + 1, j, k + 1, layout);
  put(6, i, j, k + 1, layout);
}

function put(offset: number, i: number, j: number, k: number, layout: Layout): void {
  const [x, y] = project(i, j, k, layout.originX, layout.originY, layout.edge);
  xy[offset] = x;
  xy[offset + 1] = y;
}

function outset(pad: number): void {
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < 8; index += 2) {
    cx += xy[index]!;
    cy += xy[index + 1]!;
  }
  cx /= 4;
  cy /= 4;
  for (let index = 0; index < 8; index += 2) {
    const dx = xy[index]! - cx;
    const dy = xy[index + 1]! - cy;
    const len = Math.hypot(dx, dy) || 1;
    xy[index] = xy[index]! + (dx / len) * pad;
    xy[index + 1] = xy[index + 1]! + (dy / len) * pad;
  }
}

function rotateScratch(cx: number, cy: number, angle: number): void {
  if (angle === 0) return;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let index = 0; index < 8; index += 2) {
    const dx = xy[index]! - cx;
    const dy = xy[index + 1]! - cy;
    xy[index] = cx + dx * cos - dy * sin;
    xy[index + 1] = cy + dx * sin + dy * cos;
  }
}

function shiftScratch(di: number, dj: number, dk: number, layout: Layout): void {
  if (di === 0 && dj === 0 && dk === 0) return;
  const [dx, dy] = project(di, dj, dk, 0, 0, layout.edge);
  for (let index = 0; index < 8; index += 2) {
    xy[index] = xy[index]! + dx;
    xy[index + 1] = xy[index + 1]! + dy;
  }
}

function addPath(path: Path2D): void {
  path.moveTo(xy[0]!, xy[1]!);
  path.lineTo(xy[2]!, xy[3]!);
  path.lineTo(xy[4]!, xy[5]!);
  path.lineTo(xy[6]!, xy[7]!);
  path.closePath();
}

function traceScratch(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(xy[0]!, xy[1]!);
  ctx.lineTo(xy[2]!, xy[3]!);
  ctx.lineTo(xy[4]!, xy[5]!);
  ctx.lineTo(xy[6]!, xy[7]!);
  ctx.closePath();
}

function shade(palette: Palette, orient: Orient): Rgb {
  if (orient === 'ab') return palette.top;
  if (orient === 'bc') return palette.right;
  return palette.left;
}

function rgb(color: Rgb): string {
  return `rgb(${color.r} ${color.g} ${color.b})`;
}

function mix(from: Rgb, to: Rgb, t: number): string {
  const r = Math.round(from.r + (to.r - from.r) * t);
  const g = Math.round(from.g + (to.g - from.g) * t);
  const b = Math.round(from.b + (to.b - from.b) * t);
  return `rgb(${r} ${g} ${b})`;
}

function outlineWidth(edge: number): number {
  return Math.max(0.6, Math.min(1.35, edge * 0.055));
}

function smooth(alpha: number): number {
  const t = Math.min(1, Math.max(0, alpha));
  return t * t * (3 - 2 * t);
}
