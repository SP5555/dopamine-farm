import { FLIP_ANGLE, HEX_COS, fitLayout, project, type Layout } from './geometry';
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
  { id: 'rotate', label: 'Rotate', detail: 'The three lozenges turn into the hole they leave.' },
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
  const animate = state.animation === 'rotate' && !state.reducedMotion && state.alpha > 0;
  const showSpin = state.spin !== 0 && animate;
  if (showSpin) {
    drawSpin(ctx, state, layout, palette, state.spin > 0 ? LANDS_ON : LANDS_BACK);
    return;
  }

  const pending = state.pending;
  const adding = state.flip < 0;
  const cubeHeight = pending ? state.heights[pending.i * state.b + pending.j]! : 0;
  const showFlip = pending !== null && state.flip !== 0 && animate;
  const turn = showFlip ? smooth(state.alpha) : 0;

  const paths: Record<Orient, Path2D> = {
    ab: new Path2D(),
    bc: new Path2D(),
    ca: new Path2D(),
  };
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

  if (showFlip && pending) {
    const level = adding ? cubeHeight : cubeHeight - 1;
    const [cx, cy] = project(pending.i, pending.j, level, layout.originX, layout.originY, layout.edge);
    const angle = (adding ? -turn : turn) * FLIP_ANGLE;
    const lands = adding ? LANDS_BACK : LANDS_ON;
    if (adding) {
      drawTurning(ctx, 'ab', pending.i, pending.j, cubeHeight, layout, cx, cy, angle, turn, palette, lands);
      drawTurning(ctx, 'bc', pending.i, pending.j, cubeHeight, layout, cx, cy, angle, turn, palette, lands);
      drawTurning(ctx, 'ca', pending.i, pending.j, cubeHeight, layout, cx, cy, angle, turn, palette, lands);
    } else {
      drawTurning(ctx, 'ab', pending.i, pending.j, cubeHeight, layout, cx, cy, angle, turn, palette, lands);
      drawTurning(ctx, 'bc', pending.i + 1, pending.j, cubeHeight - 1, layout, cx, cy, angle, turn, palette, lands);
      drawTurning(ctx, 'ca', pending.i, pending.j + 1, cubeHeight - 1, layout, cx, cy, angle, turn, palette, lands);
    }
  }
}

export function paletteById(id: string): Palette {
  return PALETTES.find((item) => item.id === id) ?? PALETTES[0]!;
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
  const paths: Record<Orient, Path2D> = {
    ab: new Path2D(),
    bc: new Path2D(),
    ca: new Path2D(),
  };
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
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = outlineWidth(layout.edge);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function strokePaths(
  ctx: CanvasRenderingContext2D,
  paths: Record<Orient, Path2D>,
  palette: Palette,
  edge: number,
): void {
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = outlineWidth(edge);
  ctx.lineJoin = 'round';
  ctx.stroke(paths.ab);
  ctx.stroke(paths.bc);
  ctx.stroke(paths.ca);
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
  xy[offset] = layout.originX + (i - j) * layout.edge * HEX_COS;
  xy[offset + 1] = layout.originY + (i + j) * layout.edge * 0.5 - k * layout.edge;
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
