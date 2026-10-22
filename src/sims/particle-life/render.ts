import type { World } from './physics';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * `count` hues evenly around the wheel. The first hue is a fresh roll, so two
 * species are opposite and the pair is not tied to the run's seed.
 */
export function speciesPalette(count: number): Rgb[] {
  const total = Math.max(1, Math.floor(count));
  const hue = Math.random() * 360;
  const colors: Rgb[] = [];
  for (let index = 0; index < total; index += 1) {
    colors.push(fromHue(hue + (index * 360) / total));
  }
  return colors;
}

const STAGE = '#0e1014';

export interface DrawLife {
  world: World;
  width: number;
  height: number;
  dpr: number;
  trails: boolean;
  /** 0 is a short trail, 1 is a long one. */
  trail: number;
  /** Seconds of the painted frame, used so trail length does not depend on the refresh rate. */
  fadeDt: number;
  clear: boolean;
  dot: number;
  colors: readonly Rgb[];
}

const sprites = new Map<string, HTMLCanvasElement>();

function sprite(color: Rgb): HTMLCanvasElement {
  const key = `${color.r},${color.g},${color.b}`;
  const existing = sprites.get(key);
  if (existing) return existing;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const paint = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  paint.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 0.95)`);
  paint.addColorStop(0.28, `rgba(${color.r}, ${color.g}, ${color.b}, 0.55)`);
  paint.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
  context.fillStyle = paint;
  context.fillRect(0, 0, 64, 64);
  sprites.set(key, canvas);
  return canvas;
}

function fromHue(hue: number): Rgb {
  const wrapped = ((hue % 360) + 360) % 360;
  const section = wrapped / 60;
  const chroma = (1 - Math.abs(2 * 0.62 - 1)) * 0.78;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const match = 0.62 - chroma / 2;
  let red = 0;
  let green = 0;
  let blue = 0;
  if (section < 1) {
    red = chroma;
    green = x;
  } else if (section < 2) {
    red = x;
    green = chroma;
  } else if (section < 3) {
    green = chroma;
    blue = x;
  } else if (section < 4) {
    green = x;
    blue = chroma;
  } else if (section < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }
  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  };
}

/** CSS pixels. The default size stays put when the slider's low end moves. */
export function dotRadius(dot: number): number {
  return 0.6 + dot * 2.8;
}

export function drawLife(ctx: CanvasRenderingContext2D, state: DrawLife): void {
  const { width, height, dpr, world } = state;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const fade = state.clear || !state.trails ? 1 : trailCover(state.trail, state.fadeDt);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = fade >= 1 ? STAGE : `rgba(14, 16, 20, ${fade})`;
  ctx.fillRect(0, 0, width, height);

  const margin = 28;
  const side = Math.max(1, Math.min(width, height) - margin * 2);
  const originX = (width - side) / 2;
  const originY = (height - side) / 2;
  const radius = dotRadius(state.dot);
  const reach = radius / side;

  ctx.globalCompositeOperation = 'lighter';
  const { count, x, y, type } = world;
  for (let index = 0; index < count; index += 1) {
    const image = sprite(state.colors[type[index] ?? 0] ?? state.colors[0] ?? { r: 255, g: 255, b: 255 });
    blit(ctx, image, originX, originY, side, x[index]!, y[index]!, radius, reach);
  }

  ctx.globalCompositeOperation = 'source-over';
}

/** How much of the previous frame the veil covers. 1 clears the picture. */
export function trailCover(strength: number, dt: number): number {
  const clamped = Math.max(0, Math.min(1, strength));
  const fadeAt60 = 0.1 + (1 - clamped) * 0.48;
  if (!(dt > 0)) return fadeAt60;
  const keep = 1 - fadeAt60;
  return 1 - keep ** (dt / (1 / 60));
}

function blit(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  originX: number,
  originY: number,
  side: number,
  x: number,
  y: number,
  radius: number,
  reach: number,
): void {
  stamp(ctx, image, originX + x * side, originY + y * side, radius);
  const left = x < reach;
  const right = x > 1 - reach;
  const up = y < reach;
  const down = y > 1 - reach;
  if (left) stamp(ctx, image, originX + (x + 1) * side, originY + y * side, radius);
  if (right) stamp(ctx, image, originX + (x - 1) * side, originY + y * side, radius);
  if (up) stamp(ctx, image, originX + x * side, originY + (y + 1) * side, radius);
  if (down) stamp(ctx, image, originX + x * side, originY + (y - 1) * side, radius);
  if (left && up) stamp(ctx, image, originX + (x + 1) * side, originY + (y + 1) * side, radius);
  if (left && down) stamp(ctx, image, originX + (x + 1) * side, originY + (y - 1) * side, radius);
  if (right && up) stamp(ctx, image, originX + (x - 1) * side, originY + (y + 1) * side, radius);
  if (right && down) stamp(ctx, image, originX + (x - 1) * side, originY + (y - 1) * side, radius);
}

function stamp(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
): void {
  const size = radius * 2;
  ctx.drawImage(image, x - radius, y - radius, size, size);
}
