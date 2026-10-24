import { bridgeOf, copyCorners, moveDisk, pegOf, pointOf, regionOf, solved, solvedPeg, stateCount, type Move, type Point } from './graph';

const PEG_COLOR = ['#e0a45a', '#8eb4d4', '#9dcea8'] as const;
/** Smallest disk, the one on top. */
const DISK_LIGHT = [183, 235, 192] as const;
/** Largest disk, the one on the bottom. */
const DISK_DARK = [20, 102, 60] as const;

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  points: Point[];
  /** Every move has this length: the side split into 2^n − 1 equal steps. */
  edgeLength: number;
  pegX: [number, number, number];
  baseY: number;
  pegTop: number;
  /** Nothing below this is part of the zoom. The towers start under it. */
  clipBottom: number;
  focus: Point;
  /** The three solved towers, in peg order. Sub-triangles are measured from these. */
  corners: [Point, Point, Point];
  /** Unzoomed triangle box. The reset button sits in its top-right corner. */
  bounds: Box;
  diskH: number;
  diskW: number[];
  nodeR: number;
  hitR: number;
}

export interface Scene {
  disks: number;
  state: number;
  move: Move | null;
  alpha: number;
  queue: readonly Move[];
  hover: number;
  /** Disk under the cursor, or -1. It and every smaller disk can still move. */
  diskHover: number;
  goal: number | null;
  reducedMotion: boolean;
}

/** Center-to-center thickness of a disk. A short tower is fewer of these, not thinner ones. */
const DISK_H = 16;
/** Width of the top disk. Each disk below grows so the stack's sides sit at 60°. */
const TOP_DISK_W = 26;
/** Space between the edges of the two widest disks when they sit on neighboring pegs. */
const TOWER_CLEARANCE = 20;
const EDGE = 28;
const PEG_TIP = 22;
const GAP = 64;
const GAP_MIN = 32;
/** Shrink the gap before the triangle gets shorter than this. */
const TRIANGLE_FLOOR = 96;
/** One float of the hovered disks, and one breath of their triangle. Independent of the hop speed. */
const FLOAT_MS = 1600;
const FLOAT_PX = 3.5;

interface Frame {
  corners: [Point, Point, Point];
  side: number;
  pegTop: number;
  baseY: number;
  clipBottom: number;
  focus: Point;
  bounds: Box;
}

export function layoutOf(disks: number, width: number, height: number): Layout {
  const towers = towerShape(disks, Math.max(64, width - EDGE * 2));
  const frame = frameOf(disks, width, height, towers.diskH, towers.pegTip);
  const points = Array.from({ length: stateCount(disks) }, (_, state) => pointOf(state, disks, frame.corners));
  const edgeLength = frame.side / (2 ** disks - 1);
  const center = frame.corners[2].x;
  return {
    points,
    edgeLength,
    pegX: [center - towers.pegSpacing, center + towers.pegSpacing, center],
    baseY: frame.baseY,
    pegTop: frame.pegTop,
    clipBottom: frame.clipBottom,
    focus: frame.focus,
    corners: frame.corners,
    bounds: frame.bounds,
    diskH: towers.diskH,
    diskW: towers.diskW,
    nodeR: Math.max(0.35, Math.min(6.5, edgeLength * 0.34)),
    hitR: Math.max(10, Math.min(22, edgeLength * 0.55)),
  };
}

/** Triangle above, towers below, and the pair centered when the window has room. */
function frameOf(disks: number, width: number, height: number, diskH: number, pegTip: number): Frame {
  const towerH = diskH * disks + pegTip;
  const gap = Math.max(GAP_MIN, Math.min(GAP, height - towerH - TRIANGLE_FLOOR));
  const roomH = Math.max(48, height - towerH - gap - 16);
  const roomW = Math.max(64, width - EDGE * 2);
  const side = Math.min(roomW, (roomH * 2) / Math.sqrt(3));
  const triH = (side * Math.sqrt(3)) / 2;
  const contentH = triH + gap + towerH;
  const top = Math.max(8, (height - contentH) / 2);
  const left = (width - side) / 2;
  const bottom = top + triH;
  const pegTop = bottom + gap;
  return {
    side,
    pegTop,
    baseY: pegTop + towerH,
    clipBottom: pegTop - 8,
    focus: { x: left + side / 2, y: top + triH / 2 },
    bounds: { x: left, y: top, w: side, h: triH },
    corners: [
      { x: left, y: bottom },
      { x: left + side, y: bottom },
      { x: left + side / 2, y: top },
    ],
  };
}

interface Towers {
  diskH: number;
  diskW: number[];
  pegSpacing: number;
  pegTip: number;
}

/**
 * The top disk is a fixed width. Each disk below is wider by the same step,
 * the step that puts the side edges on a 60° line. The pegs are then just
 * far enough apart that the two widest disks do not meet. A narrow window
 * scales the whole tower, which keeps the angle.
 */
function towerShape(disks: number, maxWidth: number): Towers {
  const step = (2 * DISK_H) / Math.sqrt(3);
  const diskW = Array.from({ length: disks }, (_, disk) => TOP_DISK_W + step * disk);
  const widest = diskW[disks - 1] ?? TOP_DISK_W;
  const beside = diskW[Math.max(0, disks - 2)] ?? widest;
  const pegSpacing = (widest + beside) / 2 + TOWER_CLEARANCE;
  const span = pegSpacing * 2 + widest;
  const scale = Math.min(1, maxWidth / Math.max(span, 1));
  return {
    diskH: DISK_H * scale,
    diskW: diskW.map((width) => width * scale),
    pegSpacing: pegSpacing * scale,
    pegTip: PEG_TIP * scale,
  };
}

const FIT_W = 58;
const FIT_H = 26;

export function fitButton(layout: Layout): Box {
  return { x: layout.bounds.x + layout.bounds.w - FIT_W - 8, y: layout.bounds.y + 8, w: FIT_W, h: FIT_H };
}

export function inBox(box: Box, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

/** Undo the triangle zoom. The towers are never in this space. */
export function screenToWorld(point: Point, layout: Layout, view: View): Point {
  return {
    x: layout.focus.x + (point.x - layout.focus.x - view.panX) / view.zoom,
    y: layout.focus.y + (point.y - layout.focus.y - view.panY) / view.zoom,
  };
}

export function nearestState(layout: Layout, x: number, y: number, zoom = 1): number {
  const hit = layout.hitR / Math.max(zoom, 1);
  let best = -1;
  let bestD = hit * hit;
  for (let index = 0; index < layout.points.length; index += 1) {
    const point = layout.points[index]!;
    const dx = point.x - x;
    const dy = point.y - y;
    const dist = dx * dx + dy * dy;
    if (dist <= bestD) {
      best = index;
      bestD = dist;
    }
  }
  return best;
}

export function drawHanoi(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  layout: Layout,
  scene: Scene,
  view: View,
): void {
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.lineCap = 'butt';
  context.fillStyle = '#12141a';
  context.fillRect(0, 0, width, height);

  context.save();
  context.beginPath();
  context.rect(0, 0, width, layout.clipBottom);
  context.clip();
  applyView(context, layout.focus, view);
  drawGraph(context, width, layout, scene, view);
  context.restore();

  drawFit(context, fitButton(layout));
  drawTower(context, layout, scene);
}

function applyView(context: CanvasRenderingContext2D, focus: Point, view: View): void {
  context.translate(focus.x + view.panX, focus.y + view.panY);
  context.scale(view.zoom, view.zoom);
  context.translate(-focus.x, -focus.y);
}

function drawGraph(context: CanvasRenderingContext2D, width: number, layout: Layout, scene: Scene, view: View): void {
  const seen = visibleWorld(width, layout, view);
  context.lineWidth = 1 / view.zoom;
  context.strokeStyle = 'rgba(186, 182, 174, 0.55)';
  context.beginPath();
  drawCopy(context, layout.corners, scene.disks - 1, view.zoom, seen);
  context.stroke();

  const walking = pathStates(scene);
  if (walking.length > 1) {
    context.strokeStyle = 'rgba(224, 164, 90, 0.9)';
    context.lineWidth = 1.6 / view.zoom;
    context.beginPath();
    for (let index = 1; index < walking.length; index += 1) {
      const from = walking[index - 1]!;
      const to = walking[index]!;
      if (index === 1 && scene.move && !scene.reducedMotion) {
        const start = layout.points[from]!;
        const end = layout.points[to]!;
        const t = smooth(scene.alpha);
        line(context, { x: lerp(start.x, end.x, t), y: lerp(start.y, end.y, t) }, end);
      } else {
        line(context, layout.points[from]!, layout.points[to]!);
      }
    }
    context.stroke();
  }

  if (scene.diskHover >= 0) drawRegion(context, layout, scene, view);

  for (let peg = 0; peg < 3; peg += 1) {
    const point = layout.points[solved(scene.disks, peg)];
    if (point) fillDot(context, point, markerRadius(layout, view, true), PEG_COLOR[peg]!);
  }
  if (scene.hover >= 0 && solvedPeg(scene.hover, scene.disks) < 0) {
    const point = layout.points[scene.hover];
    if (point) fillDot(context, point, markerRadius(layout, view, false), '#3c4250');
  }

  const here = layout.points[scene.state];
  const next = scene.move ? layout.points[moveDisk(scene.state, scene.move.disk, scene.move.to)] : null;
  const ringWidth = 1.5 / view.zoom;
  const hereR = shownRadius(layout, view, false);
  if (here) {
    const t = here && next && scene.move && !scene.reducedMotion ? smooth(scene.alpha) : 0;
    const x = next ? lerp(here.x, next.x, t) : here.x;
    const y = next ? lerp(here.y, next.y, t) : here.y;
    // The corner dots already mark a solved tower. Anywhere else, the dot is the only fill.
    if (scene.move || solvedPeg(scene.state, scene.disks) < 0) fillDot(context, { x, y }, hereR, '#f4efe6');
    drawHereRipple(context, x, y, hereR, view.zoom, ringWidth, scene.reducedMotion);
  }
  if (scene.goal !== null && scene.goal !== scene.state) {
    const goal = layout.points[scene.goal];
    if (goal) ring(context, goal.x, goal.y, hereR + 5.5 / view.zoom, '#d5dbe6', ringWidth);
  }
  if (scene.hover >= 0 && scene.hover !== scene.state) {
    const hover = layout.points[scene.hover];
    const peg = solvedPeg(scene.hover, scene.disks);
    if (hover) ring(context, hover.x, hover.y, markerRadius(layout, view, peg >= 0) + 2.5 / view.zoom, 'rgba(244, 239, 230, 0.7)', ringWidth);
  }
}

/**
 * Draw this copy of the graph. A straight side is many equal steps laid end to end,
 * so the outline is one line, not a row of short ones. Below a few pixels the inside
 * would only gray the hole, so the outline stands in for it. The walk is drawn later.
 */
function drawCopy(
  context: CanvasRenderingContext2D,
  corners: readonly [Point, Point, Point],
  disk: number,
  zoom: number,
  seen: { x0: number; y0: number; x1: number; y1: number },
): void {
  if (triangleMisses(corners, seen)) return;
  const span = Math.hypot(corners[1]!.x - corners[0]!.x, corners[1]!.y - corners[0]!.y);
  if (disk <= 0 || span * zoom < 8) {
    line(context, corners[0]!, corners[1]!);
    line(context, corners[1]!, corners[2]!);
    line(context, corners[2]!, corners[0]!);
    return;
  }
  for (let a = 0; a < 3; a += 1) {
    for (let b = a + 1; b < 3; b += 1) {
      const [from, to] = bridgeOf(disk, a, b, corners);
      line(context, from, to);
    }
  }
  for (let peg = 0; peg < 3; peg += 1) drawCopy(context, copyCorners(peg, disk, corners), disk - 1, zoom, seen);
}

function triangleMisses(corners: readonly [Point, Point, Point], box: { x0: number; y0: number; x1: number; y1: number }): boolean {
  let minX = corners[0]!.x;
  let maxX = minX;
  let minY = corners[0]!.y;
  let maxY = minY;
  for (let index = 1; index < 3; index += 1) {
    const point = corners[index]!;
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return maxX < box.x0 || minX > box.x1 || maxY < box.y0 || minY > box.y1;
}

/** One ring leaves the dot and fades. The next is already on its way. Own clock, not the hop speed. */
const RIPPLE_MS = 1600;

function drawHereRipple(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  hereR: number,
  zoom: number,
  ringWidth: number,
  reducedMotion: boolean,
): void {
  if (reducedMotion) {
    ring(context, x, y, hereR + 4 / zoom, 'rgba(244, 239, 230, 0.85)', ringWidth);
    return;
  }
  const now = performance.now();
  for (const offset of [0, 0.5]) {
    const phase = (now / RIPPLE_MS + offset) % 1;
    const radius = hereR + (1.5 + phase * 14) / zoom;
    ring(context, x, y, radius, `rgba(244, 239, 230, ${0.72 * (1 - phase)})`, ringWidth);
  }
}

/** Dot size in world units. On screen it grows with the zoom, then stops so a close view stays a graph. */
function shownRadius(layout: Layout, view: View, solved: boolean): number {
  const screen = Math.min(solved ? 11 : 7, layout.nodeR * view.zoom * (solved ? 1.7 : 1));
  return screen / view.zoom;
}

/** Same as a graph dot, but never smaller than a few pixels, so a corner stays visible. */
function markerRadius(layout: Layout, view: View, solved: boolean): number {
  const grown = layout.nodeR * view.zoom * (solved ? 1.7 : 1);
  return Math.min(solved ? 11 : 7, Math.max(5, grown)) / view.zoom;
}

/** Where this disk and the smaller ones can go. The wash breathes in time with their float. */
function drawRegion(context: CanvasRenderingContext2D, layout: Layout, scene: Scene, view: View): void {
  const [a, b, c] = regionOf(scene.state, scene.disks, scene.diskHover, layout.corners);
  const breath = scene.reducedMotion ? 0.55 : floatWave();
  const span = Math.hypot(a.x - b.x, a.y - b.y) + Math.hypot(b.x - c.x, b.y - c.y);
  if (span < 1e-3) {
    fillDot(context, a, markerRadius(layout, view, false), `rgba(214, 240, 214, ${0.45 + 0.5 * breath})`);
    ring(context, a.x, a.y, markerRadius(layout, view, false) + 3.5 / view.zoom, `rgba(214, 240, 214, ${0.45 + 0.5 * breath})`, 1.5 / view.zoom);
    return;
  }
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.lineTo(c.x, c.y);
  context.closePath();
  context.fillStyle = `rgba(183, 235, 192, ${0.05 + 0.18 * breath})`;
  context.fill();
  context.strokeStyle = `rgba(214, 240, 214, ${0.35 + 0.6 * breath})`;
  context.lineWidth = 1.75 / view.zoom;
  context.stroke();
}

/** 0 on the resting spot, 1 at the top of the rise. The disk never drops below where it sits. */
function floatWave(): number {
  return (1 - Math.cos((performance.now() / FLOAT_MS) * Math.PI * 2)) / 2;
}

/** How far a disk rises while it, or a larger disk, is hovered. Canvas y grows downward. */
function floatOf(layout: Layout, scene: Scene, disk: number): number {
  if (scene.diskHover < 0 || disk > scene.diskHover || scene.reducedMotion) return 0;
  return floatWave() * FLOAT_PX * (layout.diskH / DISK_H);
}

/** The disk drawn under a canvas point, or -1. The moving disk is tested last because it is painted on top. */
export function diskUnder(layout: Layout, scene: Scene, x: number, y: number): number {
  const moving = scene.move?.disk ?? -1;
  let hit = -1;
  for (let peg = 0; peg < 3; peg += 1) {
    const stack: number[] = [];
    for (let disk = scene.disks - 1; disk >= 0; disk -= 1) {
      if (disk === moving) continue;
      if (pegOf(scene.state, disk) === peg) stack.push(disk);
    }
    stack.forEach((disk, height) => {
      const at = layout.baseY - layout.diskH * (height + 0.5) - floatOf(layout, scene, disk);
      if (inDisk(layout, disk, layout.pegX[peg]!, at, x, y)) hit = disk;
    });
  }
  if (scene.move) {
    const fromPeg = pegOf(scene.state, scene.move.disk);
    const toPeg = scene.move.to;
    const fromCount = countOn(scene.state, scene.disks, fromPeg, scene.move.disk);
    const toCount = countOn(scene.state, scene.disks, toPeg, scene.move.disk);
    const y0 = layout.baseY - layout.diskH * (fromCount + 0.5);
    const y1 = layout.baseY - layout.diskH * (toCount + 0.5);
    const t = scene.reducedMotion ? 1 : smooth(scene.alpha);
    const lift = scene.reducedMotion ? 0 : Math.sin(t * Math.PI) * layout.diskH * (1.4 + 18 / DISK_H);
    const atX = lerp(layout.pegX[fromPeg]!, layout.pegX[toPeg]!, t);
    const atY = lerp(y0, y1, t) - lift - floatOf(layout, scene, scene.move.disk);
    if (inDisk(layout, scene.move.disk, atX, atY, x, y)) hit = scene.move.disk;
  }
  return hit;
}

function inDisk(layout: Layout, disk: number, x: number, y: number, px: number, py: number): boolean {
  const width = (layout.diskW[disk] ?? 20) + 6;
  const height = layout.diskH * ((DISK_H - 2) / DISK_H) + 6;
  return Math.abs(px - x) <= width / 2 && Math.abs(py - y) <= height / 2;
}

function fillDot(context: CanvasRenderingContext2D, point: Point, radius: number, color: string): void {
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

function visibleWorld(width: number, layout: Layout, view: View): { x0: number; y0: number; x1: number; y1: number } {
  const origin = screenToWorld({ x: 0, y: 0 }, layout, view);
  const far = screenToWorld({ x: width, y: layout.clipBottom }, layout, view);
  const pad = layout.nodeR + 4 / view.zoom;
  return {
    x0: Math.min(origin.x, far.x) - pad,
    y0: Math.min(origin.y, far.y) - pad,
    x1: Math.max(origin.x, far.x) + pad,
    y1: Math.max(origin.y, far.y) + pad,
  };
}

function drawFit(context: CanvasRenderingContext2D, box: Box): void {
  context.fillStyle = 'rgba(24, 27, 33, 0.92)';
  context.strokeStyle = 'rgba(236, 232, 225, 0.28)';
  context.lineWidth = 1;
  roundRect(context, box.x, box.y, box.w, box.h, 6);
  context.fill();
  context.stroke();
  context.fillStyle = '#ece8e1';
  context.font = '12px ui-sans-serif, system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('Reset', box.x + box.w / 2, box.y + box.h / 2 + 0.5);
}

function drawTower(context: CanvasRenderingContext2D, layout: Layout, scene: Scene): void {
  const moving = scene.move?.disk ?? -1;
  for (let peg = 0; peg < 3; peg += 1) {
    const x = layout.pegX[peg]!;
    context.strokeStyle = PEG_COLOR[peg]!;
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x, layout.pegTop);
    context.lineTo(x, layout.baseY);
    context.stroke();
  }
  context.strokeStyle = 'rgba(236, 232, 225, 0.28)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(layout.pegX[0]! - layout.diskW[scene.disks - 1]! / 2, layout.baseY);
  context.lineTo(layout.pegX[1]! + layout.diskW[scene.disks - 1]! / 2, layout.baseY);
  context.stroke();

  for (let peg = 0; peg < 3; peg += 1) {
    const stack: number[] = [];
    for (let disk = scene.disks - 1; disk >= 0; disk -= 1) {
      if (disk === moving) continue;
      if (pegOf(scene.state, disk) === peg) stack.push(disk);
    }
    stack.forEach((disk, height) => {
      const at = layout.baseY - layout.diskH * (height + 0.5) - floatOf(layout, scene, disk);
      diskAt(context, layout, scene, disk, layout.pegX[peg]!, at);
    });
  }

  if (scene.move) {
    const fromPeg = pegOf(scene.state, scene.move.disk);
    const toPeg = scene.move.to;
    const fromCount = countOn(scene.state, scene.disks, fromPeg, scene.move.disk);
    const toCount = countOn(scene.state, scene.disks, toPeg, scene.move.disk);
    const y0 = layout.baseY - layout.diskH * (fromCount + 0.5);
    const y1 = layout.baseY - layout.diskH * (toCount + 0.5);
    const t = scene.reducedMotion ? 1 : smooth(scene.alpha);
    const lift = scene.reducedMotion ? 0 : Math.sin(t * Math.PI) * layout.diskH * (1.4 + 18 / DISK_H);
    diskAt(
      context,
      layout,
      scene,
      scene.move.disk,
      lerp(layout.pegX[fromPeg]!, layout.pegX[toPeg]!, t),
      lerp(y0, y1, t) - lift - floatOf(layout, scene, scene.move.disk),
    );
  }
}

function countOn(state: number, disks: number, peg: number, ignore: number): number {
  let count = 0;
  for (let disk = 0; disk < disks; disk += 1) {
    if (disk !== ignore && pegOf(state, disk) === peg) count += 1;
  }
  return count;
}

function diskAt(context: CanvasRenderingContext2D, layout: Layout, scene: Scene, disk: number, x: number, y: number): void {
  const width = layout.diskW[disk] ?? 20;
  const height = layout.diskH * ((DISK_H - 2) / DISK_H);
  context.save();
  context.globalAlpha = diskAlpha(scene, disk);
  context.fillStyle = diskColor(disk, layout.diskW.length);
  roundRect(context, x - width / 2, y - height / 2, width, height, Math.min(6, height / 2));
  context.fill();
  context.restore();
}

/** The rising disks thin out at the top of the float and turn solid again when they settle. */
function diskAlpha(scene: Scene, disk: number): number {
  if (scene.diskHover < 0 || disk > scene.diskHover || scene.reducedMotion) return 1;
  return 1 - 0.28 * floatWave();
}

/** One green. Disk 0 is the top, so it is the light end. */
function diskColor(disk: number, disks: number): string {
  const t = disks <= 1 ? 0 : disk / (disks - 1);
  const channel = (light: number, dark: number): number => Math.round(light + (dark - light) * t);
  return `rgb(${channel(DISK_LIGHT[0], DISK_DARK[0])}, ${channel(DISK_LIGHT[1], DISK_DARK[1])}, ${channel(DISK_LIGHT[2], DISK_DARK[2])})`;
}

function pathStates(scene: Scene): number[] {
  const states = [scene.state];
  let cursor = scene.state;
  const moves = scene.move ? [scene.move, ...scene.queue] : scene.queue;
  for (const move of moves) {
    cursor = moveDisk(cursor, move.disk, move.to);
    states.push(cursor);
  }
  return states;
}

function ring(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, lineWidth: number): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.stroke();
}

function line(context: CanvasRenderingContext2D, from: Point, to: Point): void {
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function smooth(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
