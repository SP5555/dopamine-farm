import katex from 'katex';
import { children, type Expr } from './expr';

export type ProofFrame = {
  source: string;
  hot: string[];
  alpha: number;
  flip: boolean;
  fade: boolean;
  badge: { ok: boolean; text: string } | null;
  tree: Expr;
  dpr: number;
};

type Move = { dx: number; dy: number; born: boolean };
type Spot = { x: number; y: number };

const SWAP_END = 0.34;

export type ProofView = {
  frame(frame: ProofFrame): void;
  fit(): void;
  resize(dpr: number): void;
  destroy(): void;
};

export function mountProof(canvas: HTMLCanvasElement, treeBody: HTMLElement): ProofView {
  const parent = canvas.parentElement;
  if (!parent) throw new Error('Proof by intimidation needs a place to draw');

  const layer = document.createElement('div');
  layer.className = 'proof-layer';
  layer.innerHTML = `
    <div class="proof-badge" hidden></div>
    <div class="proof-stage">
      <div class="proof-fit"><div class="proof-formula"></div></div>
    </div>
  `;
  parent.appendChild(layer);

  treeBody.classList.add('proof-tree');
  treeBody.innerHTML = `
    <div class="proof-tree-head">
      <p class="proof-legend"><span class="is-trig">trig</span><span class="is-calc">calculus</span><span class="is-series">series</span><span class="is-complex">complex</span></p>
      <button type="button" class="proof-tree-reset">Reset</button>
    </div>
    <canvas></canvas>
  `;

  const stage = layer.querySelector('.proof-stage') as HTMLDivElement;
  const fit = layer.querySelector('.proof-fit') as HTMLDivElement;
  const formula = layer.querySelector('.proof-formula') as HTMLDivElement;
  const badge = layer.querySelector('.proof-badge') as HTMLDivElement;
  const treeCanvas = treeBody.querySelector('canvas') as HTMLCanvasElement;
  const treeReset = treeBody.querySelector('.proof-tree-reset') as HTMLButtonElement;
  const treeContext = treeCanvas.getContext('2d');

  let painted = '';
  let scale = 1;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let userMoved = false;
  let dpr = 1;
  let flipFrom = 0;
  let moves = new Map<string, Move>();
  let glide: Glide | null = null;
  let treeGlide: Glide | null = null;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastTree: Expr | null = null;
  let lastHot = '';
  let treeZoom = 1;
  let treePanX = 0;
  let treePanY = 0;
  let treeMoved = false;
  let treeDown = false;
  let treeDragging = false;
  let treeLastX = 0;
  let treeLastY = 0;
  let hotFade = 0;
  let hoverId: string | null = null;
  let treeSpots = new Map<string, TreeSpot>();

  const cleanups: Array<() => void> = [];
  const listen = (target: EventTarget, type: string, fn: EventListener, options?: AddEventListenerOptions) => {
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener(type, fn, options));
  };

  listen(stage, 'wheel', (event) => {
    const wheel = event as WheelEvent;
    wheel.preventDefault();
    glide = null;
    zoom = clamp(zoom * Math.exp(-wheel.deltaY * 0.0012), 0.25, 8);
    userMoved = true;
    place();
  }, { passive: false });

  listen(stage, 'pointerdown', (event) => {
    const pointer = event as PointerEvent;
    if (pointer.button !== 0) return;
    dragging = true;
    lastX = pointer.clientX;
    lastY = pointer.clientY;
    stage.classList.add('is-dragging');
    stage.setPointerCapture(pointer.pointerId);
  });

  listen(stage, 'pointermove', (event) => {
    if (!dragging) return;
    const pointer = event as PointerEvent;
    glide = null;
    panX += pointer.clientX - lastX;
    panY += pointer.clientY - lastY;
    lastX = pointer.clientX;
    lastY = pointer.clientY;
    userMoved = true;
    place();
  });

  const endDrag = () => {
    dragging = false;
    stage.classList.remove('is-dragging');
  };
  listen(stage, 'pointerup', endDrag);
  listen(stage, 'pointercancel', endDrag);

  listen(treeCanvas, 'wheel', (event) => {
    const wheel = event as WheelEvent;
    wheel.preventDefault();
    treeGlide = null;
    treeZoom = clamp(treeZoom * Math.exp(-wheel.deltaY * 0.0012), 0.25, 8);
    treeMoved = true;
    paintTree();
  }, { passive: false });

  listen(treeCanvas, 'pointerdown', (event) => {
    const pointer = event as PointerEvent;
    if (pointer.button !== 0) return;
    treeDown = true;
    treeDragging = false;
    treeLastX = pointer.clientX;
    treeLastY = pointer.clientY;
    treeCanvas.setPointerCapture(pointer.pointerId);
  });

  listen(treeCanvas, 'pointermove', (event) => {
    const pointer = event as PointerEvent;
    if (treeDown) {
      const dx = pointer.clientX - treeLastX;
      const dy = pointer.clientY - treeLastY;
      if (!treeDragging && Math.hypot(dx, dy) > 3) {
        treeDragging = true;
        treeGlide = null;
        treeCanvas.classList.add('is-dragging');
        treeCanvas.classList.remove('is-hovering');
        hoverId = null;
        applyHover();
      }
      if (treeDragging) {
        treePanX += dx;
        treePanY += dy;
        treeLastX = pointer.clientX;
        treeLastY = pointer.clientY;
        treeMoved = true;
        paintTree();
        return;
      }
    }
    const next = hitTree(pointer.clientX, pointer.clientY);
    treeCanvas.classList.toggle('is-hovering', next !== null);
    if (next === hoverId) return;
    hoverId = next;
    applyHover();
    paintTree();
  });

  const endTreeDrag = () => {
    treeDown = false;
    treeDragging = false;
    treeCanvas.classList.remove('is-dragging');
  };
  listen(treeCanvas, 'pointerup', endTreeDrag);
  listen(treeCanvas, 'pointercancel', endTreeDrag);
  listen(treeCanvas, 'pointerleave', () => {
    if (treeDown) return;
    treeCanvas.classList.remove('is-hovering');
    if (hoverId === null) return;
    hoverId = null;
    applyHover();
    paintTree();
  });
  listen(treeReset, 'click', () => resetTree());

  function baseFit(): number {
    const width = formula.scrollWidth;
    const height = formula.scrollHeight;
    if (width < 2 || height < 2) return 1;
    const availW = Math.max(40, stage.clientWidth - 48);
    const availH = Math.max(40, stage.clientHeight - 88);
    return clamp(Math.min(availW / width, availH / height), 0.12, 3.4);
  }

  function place(): void {
    scale = baseFit() * (userMoved ? zoom : 1);
    if (!userMoved) {
      panX = 0;
      panY = 0;
    }
    fit.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }

  function capture(): Map<string, Spot> {
    const origin = formula.getBoundingClientRect();
    const spots = new Map<string, Spot>();
    const current = scale || 1;
    formula.querySelectorAll<HTMLElement>('[id]').forEach((el) => {
      if (!/^p\d+$/.test(el.id)) return;
      const box = el.getBoundingClientRect();
      spots.set(el.id, { x: (box.left - origin.left) / current, y: (box.top - origin.top) / current });
    });
    return spots;
  }

  function parentMove(el: HTMLElement): Move | undefined {
    const parent = el.parentElement?.closest<HTMLElement>('[id]');
    if (!parent || !/^p\d+$/.test(parent.id)) return undefined;
    return moves.get(parent.id);
  }

  function applyMotion(alpha: number): void {
    const span = Math.max(0.08, 1 - flipFrom);
    const t = smooth(clamp((alpha - flipFrom) / span, 0, 1));
    formula.querySelectorAll<HTMLElement>('[id]').forEach((el) => {
      if (!/^p\d+$/.test(el.id)) return;
      const move = moves.get(el.id);
      el.classList.remove('proof-move');
      el.style.transform = '';
      el.style.opacity = '';
      if (!move) return;
      const above = parentMove(el);
      if (move.born) {
        if (above?.born) return;
        el.classList.add('proof-move');
        el.style.opacity = String(t);
        el.style.transform = `scale(${0.84 + 0.16 * t})`;
        return;
      }
      const dx = move.dx - (above && !above.born ? above.dx : 0);
      const dy = move.dy - (above && !above.born ? above.dy : 0);
      const k = 1 - t;
      if (Math.abs(dx * k) < 0.4 && Math.abs(dy * k) < 0.4) return;
      el.classList.add('proof-move');
      el.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    });
  }

  function settleTree(): void {
    treeGlide = null;
    treeMoved = false;
    treeZoom = 1;
    treePanX = 0;
    treePanY = 0;
    paintTree();
  }

  function resetTree(): void {
    if (reduceMotion() || !treeMoved || !cameraShifted(treeZoom, treePanX, treePanY)) {
      settleTree();
      return;
    }
    treeGlide = { fromZoom: treeZoom, fromPanX: treePanX, fromPanY: treePanY, start: performance.now() };
  }

  function advance(now: number): boolean {
    let repaint = false;
    if (glide) {
      const t = smooth(clamp((now - glide.start) / GLIDE_MS, 0, 1));
      zoom = mixZoom(glide.fromZoom, 1, t);
      panX = glide.fromPanX * (1 - t);
      panY = glide.fromPanY * (1 - t);
      if (t >= 1) {
        glide = null;
        userMoved = false;
        zoom = 1;
        panX = 0;
        panY = 0;
      }
    }
    if (treeGlide) {
      repaint = true;
      const t = smooth(clamp((now - treeGlide.start) / GLIDE_MS, 0, 1));
      treeZoom = mixZoom(treeGlide.fromZoom, 1, t);
      treePanX = treeGlide.fromPanX * (1 - t);
      treePanY = treeGlide.fromPanY * (1 - t);
      if (t >= 1) {
        treeGlide = null;
        treeMoved = false;
        treeZoom = 1;
        treePanX = 0;
        treePanY = 0;
      }
    }
    return repaint;
  }

  function paintTree(): void {
    if (!lastTree || !treeContext) return;
    treeSpots = drawTree(treeContext, treeCanvas, lastTree, new Set(lastHot.split(',').filter((id) => id.length > 0)), hoverId, hotFade, dpr, {
      zoom: treeMoved ? treeZoom : 1,
      panX: treeMoved ? treePanX : 0,
      panY: treeMoved ? treePanY : 0,
    });
  }

  function hitTree(clientX: number, clientY: number): string | null {
    const rect = treeCanvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const x = ((clientX - rect.left) / rect.width) * TREE_WIDTH;
    const y = ((clientY - rect.top) / rect.height) * TREE_HEIGHT;
    const near: { id: string; dist: number; depth: number }[] = [];
    for (const [id, spot] of treeSpots) {
      const dist = Math.hypot(spot.x - x, spot.y - y);
      if (dist <= 12) near.push({ id, dist, depth: spot.depth });
    }
    if (near.length === 0) return null;
    near.sort((a, b) => a.dist - b.dist);
    const closest = near[0]!;
    const tied = near.filter((item) => item.dist <= closest.dist + 3);
    tied.sort((a, b) => b.depth - a.depth);
    return tied[0]!.id;
  }

  function applyHover(): void {
    formula.querySelectorAll('.proof-hover').forEach((el) => el.classList.remove('proof-hover'));
    if (!hoverId) return;
    formula.querySelector<HTMLElement>(`[id="${hoverId}"]`)?.classList.add('proof-hover');
  }

  function applyHot(hot: string[], fade: boolean, alpha: number): void {
    formula.querySelectorAll<HTMLElement>('.proof-hot').forEach((el) => {
      el.classList.remove('proof-hot');
      el.style.color = '';
    });
    const color = fade ? hotInk((alpha - SWAP_END) / (1 - SWAP_END)) : '';
    for (const id of hot) {
      const el = formula.querySelector<HTMLElement>(`[id="${id}"]`);
      if (!el) continue;
      el.classList.add('proof-hot');
      if (color) el.style.color = color;
    }
  }

  function stickDelimiters(): void {
    formula.querySelectorAll<HTMLElement>('.mopen, .mclose').forEach((el) => {
      el.classList.remove('proof-hot');
      el.style.transform = '';
      el.style.opacity = '';
      el.style.color = '';
    });
    formula.querySelectorAll<HTMLElement>('.minner').forEach((minner) => {
      const content = [...minner.children].filter((el) => !el.classList.contains('mopen') && !el.classList.contains('mclose') && !el.classList.contains('mspace'));
      if (content.length !== 1) return;
      const piece = content[0] as HTMLElement;
      if (!piece.classList.contains('proof-move') && !piece.classList.contains('proof-hot')) return;
      const open = minner.querySelector<HTMLElement>(':scope > .mopen');
      const close = minner.querySelector<HTMLElement>(':scope > .mclose');
      if (!open || !close || piece.contains(open)) return;
      const color = piece.style.color;
      for (const delim of [open, close]) {
        if (piece.classList.contains('proof-hot')) delim.classList.add('proof-hot');
        if (piece.style.transform) {
          delim.style.transform = piece.style.transform;
          delim.style.transformOrigin = 'center center';
        }
        if (piece.style.opacity) delim.style.opacity = piece.style.opacity;
        if (color) delim.style.color = color;
      }
    });
  }

  function frame(input: ProofFrame): void {
    dpr = input.dpr;
    hotFade = input.fade ? smooth(clamp((input.alpha - SWAP_END) / (1 - SWAP_END), 0, 1)) : 0;
    const repaintTree = advance(performance.now());
    const changed = input.source !== painted;
    if (changed) {
      const before = input.flip ? capture() : new Map<string, Spot>();
      katex.render(input.source, formula, {
        throwOnError: false,
        trust: true,
        displayMode: true,
        strict: (code: string) => (code === 'htmlExtension' ? 'ignore' : 'warn'),
      });
      painted = input.source;
      place();
      if (input.flip && before.size > 0) {
        const after = capture();
        moves = new Map();
        for (const [id, box] of after) {
          const old = before.get(id);
          if (!old) moves.set(id, { dx: 0, dy: 0, born: true });
          else moves.set(id, { dx: old.x - box.x, dy: old.y - box.y, born: false });
        }
        flipFrom = input.alpha;
      } else {
        moves = new Map();
      }
    } else if (input.alpha < 0.02) {
      moves = new Map();
    }
    if (!changed) place();
    applyMotion(input.alpha);
    applyHot(input.hot, input.fade, input.alpha);
    stickDelimiters();
    applyHover();
    if (!input.badge) badge.hidden = true;
    else {
      badge.hidden = false;
      badge.textContent = input.badge.text;
      badge.classList.toggle('is-ok', input.badge.ok);
      badge.classList.toggle('is-bad', !input.badge.ok);
    }
    if (treeContext) {
      const hotKey = input.hot.join(',');
      if (repaintTree || input.fade || input.tree !== lastTree || hotKey !== lastHot || changed) {
        lastTree = input.tree;
        lastHot = hotKey;
        paintTree();
      }
    }
  }

  return {
    frame,
    fit() {
      if (reduceMotion() || !userMoved || !cameraShifted(zoom, panX, panY)) {
        glide = null;
        userMoved = false;
        zoom = 1;
        panX = 0;
        panY = 0;
        place();
      } else {
        glide = { fromZoom: zoom, fromPanX: panX, fromPanY: panY, start: performance.now() };
      }
      resetTree();
    },
    resize(next) {
      dpr = next;
      place();
      paintTree();
    },
    destroy() {
      for (const cleanup of cleanups) cleanup();
      layer.remove();
    },
  };
}

const TREE_WIDTH = 260;
const TREE_HEIGHT = 168;

type TreeSpot = { x: number; y: number; depth: number };
type TreeView = { zoom: number; panX: number; panY: number };

function drawTree(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  expr: Expr,
  hot: Set<string>,
  hover: string | null,
  hotFade: number,
  dpr: number,
  view: TreeView,
): Map<string, TreeSpot> {
  const width = TREE_WIDTH;
  const height = TREE_HEIGHT;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  const laid = layout(expr, 0, 0);
  const bounds = measure(laid.node);
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY);
  const pad = 12;
  const fitScale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const ox = pad - bounds.minX * fitScale + (width - pad * 2 - spanX * fitScale) / 2;
  const oy = pad;
  const cx = width / 2;
  const cy = height / 2;
  const spots = new Map<string, TreeSpot>();
  const point = (x: number, y: number) => {
    const fittedX = ox + x * fitScale;
    const fittedY = oy + y * fitScale;
    return {
      x: cx + (fittedX - cx) * view.zoom + view.panX,
      y: cy + (fittedY - cy) * view.zoom + view.panY,
    };
  };
  drawLinks(context, laid.node, point);
  drawNodes(context, laid.node, point, hot, hover, hotFade, spots, 0);
  return spots;
}

type Laid = { id: string; color: string; x: number; y: number; kids: Laid[] };

function layout(expr: Expr, depth: number, x0: number): { node: Laid; width: number } {
  const kids = children(expr);
  if (kids.length === 0) {
    return { node: { id: expr.id, color: kindColor(expr), x: x0, y: depth, kids: [] }, width: 1 };
  }
  let width = 0;
  const laid = kids.map((kid) => {
    const box = layout(kid, depth + 1, x0 + width);
    width += box.width;
    return box.node;
  });
  const span = Math.max(width, 1);
  return {
    node: { id: expr.id, color: kindColor(expr), x: x0 + span / 2 - 0.5, y: depth, kids: laid },
    width: span,
  };
}

function measure(node: Laid): { minX: number; maxX: number; maxY: number } {
  let minX = node.x;
  let maxX = node.x;
  let maxY = node.y;
  for (const kid of node.kids) {
    const box = measure(kid);
    minX = Math.min(minX, box.minX);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  return { minX, maxX, maxY };
}

function drawLinks(
  context: CanvasRenderingContext2D,
  node: Laid,
  point: (x: number, y: number) => { x: number; y: number },
): void {
  const from = point(node.x, node.y);
  context.strokeStyle = 'rgba(255, 248, 240, 0.18)';
  context.lineWidth = 1;
  for (const kid of node.kids) {
    const to = point(kid.x, kid.y);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    drawLinks(context, kid, point);
  }
}

function drawNodes(
  context: CanvasRenderingContext2D,
  node: Laid,
  point: (x: number, y: number) => { x: number; y: number },
  hot: Set<string>,
  hover: string | null,
  hotFade: number,
  spots: Map<string, TreeSpot>,
  depth: number,
): void {
  const at = point(node.x, node.y);
  spots.set(node.id, { x: at.x, y: at.y, depth });
  const marked = hot.has(node.id);
  const hovered = node.id === hover;
  context.beginPath();
  context.fillStyle = node.color;
  context.arc(at.x, at.y, marked || hovered ? 4.2 : 2.6, 0, Math.PI * 2);
  context.fill();
  if (hovered) {
    context.strokeStyle = '#4eb0ff';
    context.lineWidth = 1.4;
    context.stroke();
  } else if (marked && hotFade < 0.98) {
    context.strokeStyle = `rgba(255, 77, 77, ${1 - hotFade})`;
    context.lineWidth = 1;
    context.stroke();
  }
  for (const kid of node.kids) drawNodes(context, kid, point, hot, hover, hotFade, spots, depth + 1);
}

function kindColor(expr: Expr): string {
  switch (expr.type) {
    case 'fn':
      if (expr.name === 'sin' || expr.name === 'cos' || expr.name === 'sinh' || expr.name === 'cosh') return '#e0a45a';
      if (expr.name === 'gamma') return '#8fce8f';
      return '#7eb6ff';
    case 'integral':
    case 'lim':
    case 'deriv':
      return '#7eb6ff';
    case 'sum':
    case 'fact':
    case 'binom':
      return '#8fce8f';
    case 'const':
      return expr.name === 'i' ? '#e08ab0' : '#d7dbe4';
    case 'det':
      return '#e08ab0';
    case 'num':
    case 'var':
      return '#d7dbe4';
    default:
      return '#8b93a3';
  }
}

const GLIDE_MS = 480;

type Glide = { fromZoom: number; fromPanX: number; fromPanY: number; start: number };

function reduceMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function cameraShifted(zoom: number, panX: number, panY: number): boolean {
  return Math.abs(zoom - 1) > 0.001 || Math.abs(panX) > 0.5 || Math.abs(panY) > 0.5;
}

function mixZoom(from: number, to: number, t: number): number {
  return Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * t);
}

function hotInk(t: number): string {
  const eased = smooth(clamp(t, 0, 1));
  const channel = (from: number, to: number) => Math.round(from + (to - from) * eased);
  return `rgb(${channel(255, 236)}, ${channel(77, 232)}, ${channel(77, 225)})`;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
