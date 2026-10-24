import { createRng, randomSeed, type SimModule } from '../../harness/author';
import type { BarPiece, ParamSchema, Params, SimContext, SimHost, SimInstance, SimStatus } from '../../harness/types';
import { moveDisk, shortestMoves, stateCount, type Move } from './graph';
import { diskUnder, drawHanoi, fitButton, inBox, layoutOf, nearestState, screenToWorld, type Layout, type Scene, type View } from './render';

/** Hops per second when the sim opens. One speed tick is one hop. */
const OPEN_SPEED = 4;
const SPEED_MIN = 0.5;
const SPEED_MAX = 12;
const SLIDER_MAX = 1000;
/** How long Reset spends easing the triangle back to the fitted view. */
const FIT_MS = 420;

export const params: ParamSchema = {
  height: {
    type: 'number',
    label: 'Height',
    default: 4,
    min: 1,
    max: 10,
    step: 1,
    reset: true,
    detail: 'How many disks. Scroll the triangle to look closer when it gets crowded.',
  },
};

export const sim: SimModule = {
  params,
  chrome: { seed: false },
  create,
};

function speedSlider(host: SimHost): BarPiece {
  const speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, host.speed));
  const text = speed < 10 ? speed.toFixed(1) : String(Math.round(speed));
  return {
    type: 'slider',
    id: 'speed',
    label: 'Speed',
    min: 0,
    max: SLIDER_MAX,
    step: 1,
    value: Math.round(speedToSlider(speed)),
    text: `${text}/s`,
    onChange: (value) => host.setSpeed(sliderToSpeed(value)),
  };
}

function sliderToSpeed(slider: number): number {
  const t = Math.min(SLIDER_MAX, Math.max(0, slider)) / SLIDER_MAX;
  return Math.exp(Math.log(SPEED_MIN) + t * (Math.log(SPEED_MAX) - Math.log(SPEED_MIN)));
}

function speedToSlider(speed: number): number {
  const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
  return ((Math.log(clamped) - Math.log(SPEED_MIN)) / (Math.log(SPEED_MAX) - Math.log(SPEED_MIN))) * SLIDER_MAX;
}

function create(ctx: SimContext, host: SimHost): SimInstance<Params> {
  host.setSpeed(OPEN_SPEED);

  let width = ctx.width;
  let height = ctx.height;
  let dpr = ctx.dpr;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const context = ctx.canvas.getContext('2d');

  let disks = 4;
  let state = 0;
  let move: Move | null = null;
  let queue: Move[] = [];
  let goal: number | null = null;
  let hover = -1;
  let diskHover = -1;
  let cursor: { x: number; y: number } | null = null;
  let frameAlpha = 0;
  let layout: Layout | null = null;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let drag: { x: number; y: number; panX: number; panY: number; moved: boolean } | null = null;
  let swallowClick = false;
  let glide: { zoom: number; panX: number; panY: number; started: number } | null = null;

  const viewOf = (): View => ({ zoom, panX, panY });

  const pointFrom = (event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const rect = ctx.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
  };

  const onMove = (event: PointerEvent): void => {
    const point = pointFrom(event);
    const picture = ensureLayout();
    cursor = point;
    if (!point || !picture) {
      hover = -1;
      diskHover = -1;
      ctx.canvas.style.cursor = '';
      return;
    }
    if (drag) {
      const dx = point.x - drag.x;
      const dy = point.y - drag.y;
      if (zoom > 1 && dx * dx + dy * dy > 16) drag.moved = true;
      if (drag.moved) {
        panX = drag.panX + dx;
        panY = drag.panY + dy;
        clampPan(picture);
        hover = -1;
        diskHover = -1;
        ctx.canvas.style.cursor = 'grabbing';
        return;
      }
    }
    aim(picture);
  };

  const onLeave = (): void => {
    if (drag?.moved) return;
    cursor = null;
    hover = -1;
    diskHover = -1;
    ctx.canvas.style.cursor = '';
  };

  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const point = pointFrom(event);
    const picture = ensureLayout();
    if (!point || !picture) return;
    if (inBox(fitButton(picture), point.x, point.y)) {
      beginFit();
      drag = null;
      swallowClick = true;
      return;
    }
    glide = null;
    drag = { x: point.x, y: point.y, panX, panY, moved: false };
    try {
      ctx.canvas.setPointerCapture(event.pointerId);
    } catch {
      // The pointer can already be gone.
    }
  };

  const onUp = (event: PointerEvent): void => {
    const point = pointFrom(event);
    const picture = ensureLayout();
    const moved = drag?.moved ?? false;
    drag = null;
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    if (moved || !point || !picture || point.y >= picture.clipBottom) return;
    if (inBox(fitButton(picture), point.x, point.y)) return;
    if (diskUnder(picture, sceneOf(), point.x, point.y) >= 0) return;
    const world = screenToWorld(point, picture, viewOf());
    const hit = nearestState(picture, world.x, world.y, zoom);
    if (hit < 0) return;
    goal = hit;
    queue = shortestMoves(landed(), hit, disks);
  };

  const onWheel = (event: WheelEvent): void => {
    const point = pointFrom(event);
    const picture = ensureLayout();
    if (!point || !picture || point.y >= picture.clipBottom) return;
    if (diskUnder(picture, sceneOf(), point.x, point.y) >= 0) return;
    glide = null;
    event.preventDefault();
    const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * height : event.deltaY;
    const next = Math.min(48, Math.max(1, zoom * Math.exp(-dy * 0.0015)));
    const world = screenToWorld(point, picture, viewOf());
    zoom = next;
    if (zoom === 1) {
      panX = 0;
      panY = 0;
      return;
    }
    panX = point.x - picture.focus.x - (world.x - picture.focus.x) * zoom;
    panY = point.y - picture.focus.y - (world.y - picture.focus.y) * zoom;
    clampPan(picture);
  };

  ctx.canvas.addEventListener('pointerdown', onDown);
  ctx.canvas.addEventListener('pointermove', onMove);
  ctx.canvas.addEventListener('pointerup', onUp);
  ctx.canvas.addEventListener('pointerleave', onLeave);
  ctx.canvas.addEventListener('wheel', onWheel, { passive: false });

  /** Ease the triangle back to the fitted view. A second press waits for the one already running. */
  function beginFit(): void {
    if (glide) return;
    if (reducedMotion || (zoom === 1 && panX === 0 && panY === 0)) {
      zoom = 1;
      panX = 0;
      panY = 0;
      return;
    }
    glide = { zoom, panX, panY, started: performance.now() };
  }

  function advanceGlide(): void {
    if (!glide) return;
    const t = Math.min(1, (performance.now() - glide.started) / FIT_MS);
    const eased = 1 - (1 - t) ** 3;
    zoom = Math.exp(Math.log(glide.zoom) * (1 - eased));
    panX = glide.panX * (1 - eased);
    panY = glide.panY * (1 - eased);
    if (t < 1) return;
    zoom = 1;
    panX = 0;
    panY = 0;
    glide = null;
  }

  /** Point the cursor at a disk, or at a point on the triangle. */
  function aim(picture: Layout): void {
    if (!cursor) return;
    if (inBox(fitButton(picture), cursor.x, cursor.y)) {
      hover = -1;
      diskHover = -1;
      ctx.canvas.style.cursor = 'pointer';
      return;
    }
    const disk = diskUnder(picture, sceneOf(), cursor.x, cursor.y);
    if (disk >= 0) {
      diskHover = disk;
      hover = -1;
      ctx.canvas.style.cursor = 'pointer';
      return;
    }
    diskHover = -1;
    if (cursor.y >= picture.clipBottom) {
      hover = -1;
      ctx.canvas.style.cursor = '';
      return;
    }
    const world = screenToWorld(cursor, picture, viewOf());
    hover = nearestState(picture, world.x, world.y, zoom);
    ctx.canvas.style.cursor = hover >= 0 ? 'pointer' : zoom > 1 ? 'grab' : '';
  }

  function sceneOf(): Scene {
    return { disks, state, move, alpha: frameAlpha, queue, hover, diskHover, goal, reducedMotion };
  }

  /** Where the tower sits once the hop on screen has landed. */
  function landed(): number {
    return move ? moveDisk(state, move.disk, move.to) : state;
  }

  /**
   * Stop the pan once the triangle would leave the view.
   * A corner can sit inside the window, which the old center lock would not allow.
   */
  function clampPan(picture: Layout): void {
    const inset = 72;
    const maxX = Math.max(inset + 1, width - inset);
    const maxY = Math.max(inset + 1, picture.clipBottom - inset);
    const baseLeft = zoom * (picture.bounds.x - picture.focus.x) + picture.focus.x;
    const baseTop = zoom * (picture.bounds.y - picture.focus.y) + picture.focus.y;
    panX = Math.min(maxX - baseLeft, Math.max(inset - picture.bounds.w * zoom - baseLeft, panX));
    panY = Math.min(maxY - baseTop, Math.max(inset - picture.bounds.h * zoom - baseTop, panY));
  }

  function ensureLayout(): Layout | null {
    if (width < 2 || height < 2) return null;
    if (!layout) layout = layoutOf(disks, width, height);
    return layout;
  }

  function reset(all: Params): void {
    disks = Math.max(1, Math.min(10, Math.round(Number(all.height) || 4)));
    state = createRng(randomSeed()).int(stateCount(disks));
    move = null;
    queue = [];
    goal = null;
    hover = -1;
    diskHover = -1;
    zoom = 1;
    panX = 0;
    panY = 0;
    glide = null;
    layout = null;
  }

  function step(): void {
    if (move) state = moveDisk(state, move.disk, move.to);
    move = queue.shift() ?? null;
  }

  function render(alpha = 0): void {
    if (!context) return;
    advanceGlide();
    frameAlpha = alpha;
    const picture = ensureLayout();
    if (!picture) return;
    if (cursor && !drag?.moved) aim(picture);
    drawHanoi(context, width, height, dpr, picture, sceneOf(), viewOf());
  }

  function getStatus(): SimStatus {
    const left = queue.length + (move ? 1 : 0);
    return {
      done: false,
      row: [
        { type: 'label', id: 'phase', text: left > 0 ? 'Walking' : 'Still' },
        { type: 'readout', id: 'hops', label: 'Hops', value: String(left) },
      ],
      note: 'Hover a disk to see where it and the smaller ones can go. Click a point. The three corners are the solved towers.',
    };
  }

  return {
    reset,
    step,
    render,
    getStatus,
    toolbar: () => [speedSlider(host)],
    resize(nextWidth, nextHeight, nextDpr) {
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      layout = null;
    },
    dispose() {
      ctx.canvas.removeEventListener('pointerdown', onDown);
      ctx.canvas.removeEventListener('pointermove', onMove);
      ctx.canvas.removeEventListener('pointerup', onUp);
      ctx.canvas.removeEventListener('pointerleave', onLeave);
      ctx.canvas.removeEventListener('wheel', onWheel);
      ctx.canvas.style.cursor = '';
    },
  };
}
