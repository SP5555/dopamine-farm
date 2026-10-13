import { delta, type Move } from './board';

export interface DrawState {
  board: Uint8Array;
  size: number;
  width: number;
  height: number;
  dpr: number;
  pendingMove: Move | null;
  alpha: number;
  showNumbers: boolean;
  palette: PaletteId;
  /** Tiles glide from the solved grid toward this board. `progress` runs from 0 to 1. */
  travel: { board: Uint8Array; progress: number } | null;
  solvedAt: number;
  reducedMotion: boolean;
  focusTiles: readonly number[];
}

interface Layout {
  size: number;
  originX: number;
  originY: number;
  cell: number;
  tile: number;
  radius: number;
  plateX: number;
  plateY: number;
  plateSize: number;
  plateRadius: number;
}

const STAGE = '#12141a';
const PLATE = '#232733';
const HOME_BORDER = '#ffffff';
const FOCUS_BORDER = '#ff2436';
const FOCUS_PULSE_MS = 1800;

export const PALETTES = ['tide', 'ember', 'moss', 'dusk', 'spectrum', 'checker'] as const;
export type PaletteId = (typeof PALETTES)[number];

export function paletteId(value: string | undefined): PaletteId {
  for (const id of PALETTES) if (id === value) return id;
  return 'tide';
}

export function drawPuzzle(ctx: CanvasRenderingContext2D, state: DrawState): void {
  const { width, height, dpr } = state;
  if (width < 2 || height < 2) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = STAGE;
  ctx.fillRect(0, 0, width, height);

  const layout = layoutBoard(state.size, width, height);
  drawPlate(ctx, layout);
  const alpha = clamp01(state.alpha);

  if (state.travel) {
    drawTravel(ctx, state.travel.board, state.size, layout, state.showNumbers, state.palette, state.travel.progress);
  } else {
    drawTiles(
      ctx,
      state.board,
      state.size,
      layout,
      state.showNumbers,
      state.palette,
      state.pendingMove,
      alpha,
      state.focusTiles,
      state.reducedMotion,
    );
  }

  if (state.solvedAt > 0 && !state.reducedMotion) {
    drawFlourish(ctx, layout, state.solvedAt);
  }
}

function layoutBoard(size: number, width: number, height: number): Layout {
  const margin = Math.max(28, Math.min(width, height) * 0.08);
  const side = Math.max(size, Math.min(width, height) - margin * 2);
  const cell = side / size;
  const gap = cell * 0.075;
  const tile = cell - gap;
  const originX = (width - side) / 2;
  const originY = (height - side) / 2;
  const pad = Math.max(8, gap);
  return {
    size,
    originX,
    originY,
    cell,
    tile,
    radius: Math.max(4, tile * 0.16),
    plateX: originX - pad,
    plateY: originY - pad,
    plateSize: side + pad * 2,
    plateRadius: Math.max(10, tile * 0.22),
  };
}

function drawPlate(ctx: CanvasRenderingContext2D, layout: Layout): void {
  ctx.fillStyle = PLATE;
  ctx.beginPath();
  ctx.roundRect(layout.plateX, layout.plateY, layout.plateSize, layout.plateSize, layout.plateRadius);
  ctx.fill();
}

function drawTravel(
  ctx: CanvasRenderingContext2D,
  board: Uint8Array,
  size: number,
  layout: Layout,
  showNumbers: boolean,
  palette: PaletteId,
  progress: number,
): void {
  const cells = size * size;
  const target = new Int32Array(cells);
  for (let index = 0; index < cells; index += 1) target[board[index]!] = index;
  const fontSize = labelFontSize(ctx, layout.tile, size);
  const along = clamp01(progress);
  const flying: { tile: number; origin: { x: number; y: number }; home: number; lift: number }[] = [];
  for (let tile = 1; tile < cells; tile += 1) {
    const from = tile - 1;
    const to = target[tile]!;
    const start = ringDeparture(from, size);
    const eased = ease(clamp01((along - start) / 0.45));
    flying.push({
      tile,
      origin: arcOrigin(layout, from, to, eased),
      home: to === from ? 1 : 1 - eased,
      lift: Math.sin(Math.PI * eased),
    });
  }
  flying.sort((a, b) => a.lift - b.lift);
  for (const tile of flying) {
    paintTile(ctx, layout, tile.tile, size, palette, tile.origin, showNumbers, fontSize, tile.home, false);
  }
}

/** Center tiles leave first, corners last, across the first part of the glide. */
function ringDeparture(cell: number, size: number): number {
  const col = cell % size;
  const row = Math.floor(cell / size);
  const center = (size - 1) / 2;
  const dist = Math.hypot(col - center, row - center);
  const max = Math.hypot(center, center) || 1;
  return (dist / max) * 0.55;
}

function arcOrigin(
  layout: Layout,
  from: number,
  to: number,
  eased: number,
): { x: number; y: number } {
  const start = cellOrigin(layout, from);
  const end = cellOrigin(layout, to);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const lift = Math.sin(Math.PI * eased) * layout.cell * 0.22;
  if (length < 0.001) return start;
  return {
    x: start.x + dx * eased + (-dy / length) * lift,
    y: start.y + dy * eased + (dx / length) * lift,
  };
}

function drawTiles(
  ctx: CanvasRenderingContext2D,
  board: Uint8Array,
  size: number,
  layout: Layout,
  showNumbers: boolean,
  palette: PaletteId,
  pendingMove: Move | null,
  alpha: number,
  focusTiles: readonly number[],
  reducedMotion: boolean,
): void {
  const placed = placedTiles(board, size, layout, pendingMove, alpha);
  const fontSize = labelFontSize(ctx, layout.tile, size);
  const focus = new Set(focusTiles);
  const wave = focusWave(reducedMotion);
  for (const tile of placed) {
    paintTile(ctx, layout, tile.tile, size, palette, tile.origin, showNumbers, fontSize, tile.home, focus.has(tile.tile));
  }
  for (const tile of placed) {
    if (focus.has(tile.tile)) drawFocus(ctx, layout, tile.origin, wave);
  }
}

interface PlacedTile {
  tile: number;
  origin: { x: number; y: number };
  home: number;
}

function placedTiles(
  board: Uint8Array,
  size: number,
  layout: Layout,
  pendingMove: Move | null,
  alpha: number,
): PlacedTile[] {
  const moving = pendingMove === null ? null : movingTile(board, pendingMove, size);
  const eased = ease(clamp01(alpha));
  const placed: PlacedTile[] = [];

  for (let index = 0; index < board.length; index += 1) {
    const tile = board[index]!;
    if (tile === 0) continue;
    if (moving && index === moving.from) continue;
    placed.push({
      tile,
      origin: cellOrigin(layout, index),
      home: index + 1 === tile ? 1 : 0,
    });
  }

  if (!moving) return placed;

  const from = cellOrigin(layout, moving.from);
  const to = cellOrigin(layout, moving.to);
  placed.push({
    tile: moving.tile,
    origin: {
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
    },
    home: slideHome(moving.tile, moving.from, moving.to, eased),
  });
  return placed;
}

function slideHome(tile: number, from: number, to: number, eased: number): number {
  const home = tile - 1;
  const leaving = from === home ? 1 - eased : 0;
  const arriving = to === home ? eased : 0;
  return leaving > arriving ? leaving : arriving;
}

function labelFontSize(ctx: CanvasRenderingContext2D, tilePx: number, size: number): number {
  const widest = '8'.repeat(digitCount(size * size - 1));
  const cap = tilePx * 0.56;
  ctx.font = `600 ${cap}px ui-monospace, monospace`;
  const measured = ctx.measureText(widest).width;
  const target = tilePx * 0.8;
  const fitted = measured > target ? cap * (target / measured) : cap;
  return Math.max(8, Math.floor(fitted));
}

function digitCount(value: number): number {
  if (value >= 100) return 3;
  if (value >= 10) return 2;
  return 1;
}

function movingTile(
  board: Uint8Array,
  move: Move,
  size: number,
): { from: number; to: number; tile: number } | null {
  const to = board.indexOf(0);
  const from = to + delta(move, size);
  if (from < 0 || from >= board.length) return null;
  const tile = board[from]!;
  if (tile === 0) return null;
  return { from, to, tile };
}

function paintTile(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  tile: number,
  size: number,
  palette: PaletteId,
  origin: { x: number; y: number },
  showNumbers: boolean,
  fontSize: number,
  home: number,
  focused: boolean,
): void {
  const color = tileColor(size, tile, palette);
  ctx.beginPath();
  ctx.roundRect(origin.x, origin.y, layout.tile, layout.tile, layout.radius);
  ctx.fillStyle = color.fill;
  ctx.fill();
  if (!focused && home > 0.02) {
    ctx.save();
    ctx.clip();
    ctx.globalAlpha *= home;
    ctx.strokeStyle = color.edge;
    ctx.lineWidth = Math.max(2, Math.round(layout.tile * 0.028)) * 2;
    ctx.stroke();
    ctx.restore();
  }
  if (!showNumbers) return;
  ctx.fillStyle = color.text;
  ctx.font = `600 ${fontSize}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(tile), origin.x + layout.tile / 2, origin.y + layout.tile / 2 + 1);
}

/** 0 at the tile edge, 1 after the ring has grown out and faded. Then it starts over. */
function focusWave(reducedMotion: boolean): number | null {
  if (reducedMotion) return null;
  return (performance.now() % FOCUS_PULSE_MS) / FOCUS_PULSE_MS;
}

function drawFocus(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  origin: { x: number; y: number },
  wave: number | null,
): void {
  const lineWidth = Math.max(3, layout.tile * 0.055);
  ctx.save();
  ctx.strokeStyle = FOCUS_BORDER;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.roundRect(origin.x, origin.y, layout.tile, layout.tile, layout.radius);
  ctx.stroke();

  if (wave !== null && wave < 0.98) {
    const spread = wave * Math.max(10, layout.tile * 0.14);
    ctx.beginPath();
    ctx.roundRect(
      origin.x - spread,
      origin.y - spread,
      layout.tile + spread * 2,
      layout.tile + spread * 2,
      layout.radius + spread,
    );
    ctx.globalAlpha = 0.9 * (1 - wave);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFlourish(ctx: CanvasRenderingContext2D, layout: Layout, solvedAt: number): void {
  const t = (performance.now() - solvedAt) / 1400;
  if (t < 0 || t > 1) return;
  const sweep = layout.plateX + t * (layout.plateSize + 48) - 24;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(layout.plateX, layout.plateY, layout.plateSize, layout.plateSize, layout.plateRadius);
  ctx.clip();
  const gradient = ctx.createLinearGradient(sweep - 28, layout.plateY, sweep + 28, layout.plateY);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(layout.plateX, layout.plateY, layout.plateSize, layout.plateSize);
  ctx.restore();
}

function cellOrigin(layout: Layout, index: number): { x: number; y: number } {
  const col = index % layout.size;
  const row = Math.floor(index / layout.size);
  const inset = (layout.cell - layout.tile) / 2;
  return {
    x: layout.originX + col * layout.cell + inset,
    y: layout.originY + row * layout.cell + inset,
  };
}

const colorCache = new Map<string, { fill: string; text: string; edge: string }>();

interface Ramp {
  hue: number;
  hueSpan: number;
  light: number;
  lightDrop: number;
  chroma: number;
  chromaLift: number;
}

const RAMPS: Record<Exclude<PaletteId, 'spectrum' | 'checker'>, Ramp> = {
  tide: { hue: 198, hueSpan: 52, light: 0.76, lightDrop: 0.32, chroma: 0.1, chromaLift: 0.035 },
  ember: { hue: 22, hueSpan: 40, light: 0.74, lightDrop: 0.3, chroma: 0.13, chromaLift: 0.025 },
  moss: { hue: 118, hueSpan: 36, light: 0.74, lightDrop: 0.3, chroma: 0.115, chromaLift: 0.03 },
  dusk: { hue: 282, hueSpan: 48, light: 0.7, lightDrop: 0.26, chroma: 0.115, chromaLift: 0.03 },
};

function tileColor(size: number, tile: number, palette: PaletteId): { fill: string; text: string; edge: string } {
  const key = `${palette}:${size}:${tile}`;
  const cached = colorCache.get(key);
  if (cached) return cached;
  const goal = tile - 1;
  const row = Math.floor(goal / size);
  const col = goal % size;
  if (palette === 'checker') {
    const dark = (row + col) % 2 === 1;
    const value = dark
      ? { fill: '#1c1e26', text: '#f6f1e8', edge: HOME_BORDER }
      : { fill: '#f3efe6', text: '#24180f', edge: '#1c1e26' };
    colorCache.set(key, value);
    return value;
  }
  const x = size === 1 ? 0 : col / (size - 1);
  const y = size === 1 ? 0 : row / (size - 1);
  let hue: number;
  let light: number;
  let chroma: number;
  if (palette === 'spectrum') {
    hue = 32 + x * 248;
    light = 0.8 - y * 0.34;
    chroma = 0.11 + (1 - y) * 0.035;
  } else {
    const ramp = RAMPS[palette];
    hue = ramp.hue + x * ramp.hueSpan;
    light = ramp.light - y * ramp.lightDrop;
    chroma = ramp.chroma + (1 - y) * ramp.chromaLift;
  }
  const value = {
    fill: `oklch(${light.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)})`,
    text: light > 0.55 ? '#24180f' : '#f6f1e8',
    edge: HOME_BORDER,
  };
  colorCache.set(key, value);
  return value;
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
