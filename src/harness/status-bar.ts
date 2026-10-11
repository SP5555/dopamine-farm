import type { SimStatus, StatusPiece } from './types';

const SPARK_CAPACITY = 600;

interface SparkSeries {
  samples: Float64Array;
  count: number;
  head: number;
  last: number;
}

export interface StatusBar {
  sync(status: SimStatus, stepped: boolean): void;
  clear(): void;
  showBanner(title: string, elapsedMs: number): void;
  clearBanner(): void;
}

export function statusHasBody(status: SimStatus): boolean {
  return (status.row?.length ?? 0) > 0 || (status.aside?.length ?? 0) > 0 || Boolean(status.note);
}

export function createStatusBar(root: HTMLElement, banner: HTMLElement): StatusBar {
  root.replaceChildren();

  const row = document.createElement('div');
  row.className = 'status-row';
  const aside = document.createElement('div');
  aside.className = 'stats';
  const message = document.createElement('p');
  message.className = 'message';
  root.append(row, message);

  const series = new Map<string, SparkSeries>();
  let rowKey = '';
  let asideKey = '';

  const seriesFor = (id: string): SparkSeries => {
    const existing = series.get(id);
    if (existing) return existing;
    const created: SparkSeries = {
      samples: new Float64Array(SPARK_CAPACITY),
      count: 0,
      head: 0,
      last: Number.NaN,
    };
    series.set(id, created);
    return created;
  };

  const pushSample = (id: string, value: number, stepped: boolean) => {
    const spark = seriesFor(id);
    if (!stepped && value === spark.last) return;
    spark.samples[spark.head] = value;
    spark.head = (spark.head + 1) % SPARK_CAPACITY;
    if (spark.count < SPARK_CAPACITY) spark.count += 1;
    spark.last = value;
    drawSpark(id);
  };

  const drawSpark = (id: string) => {
    const canvas = root.querySelector(`[data-spark="${CSS.escape(id)}"]`);
    if (!(canvas instanceof HTMLCanvasElement)) return;
    const ctx = canvas.getContext('2d');
    const spark = series.get(id);
    if (!ctx || !spark) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    if (spark.count === 0) return;
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < spark.count; index += 1) {
      const value = spark.samples[(spark.head - spark.count + index + SPARK_CAPACITY) % SPARK_CAPACITY]!;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const span = max - min || 1;
    ctx.beginPath();
    for (let index = 0; index < spark.count; index += 1) {
      const value = spark.samples[(spark.head - spark.count + index + SPARK_CAPACITY) % SPARK_CAPACITY]!;
      const x = spark.count === 1 ? width / 2 : (index / (spark.count - 1)) * (width - 2) + 1;
      const y = height - 3 - ((value - min) / span) * (height - 8);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#e0a45a';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const elementFor = (piece: StatusPiece): HTMLElement => {
    if (piece.type === 'label') {
      const label = document.createElement('span');
      label.className = 'phase';
      label.dataset['piece'] = piece.id;
      return label;
    }
    if (piece.type === 'progress') {
      const progress = document.createElement('div');
      progress.className = 'progress';
      progress.dataset['piece'] = piece.id;
      progress.setAttribute('role', 'progressbar');
      progress.setAttribute('aria-valuemin', '0');
      progress.setAttribute('aria-valuemax', '100');
      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      progress.append(fill);
      return progress;
    }
    if (piece.type === 'readout') {
      const readout = document.createElement('span');
      readout.className = 'readout';
      readout.dataset['piece'] = piece.id;
      const name = document.createElement('span');
      name.className = 'metric-label';
      const value = document.createElement('span');
      value.className = 'metric-value';
      readout.append(name, value);
      return readout;
    }
    const metric = document.createElement('span');
    metric.className = 'metric';
    metric.dataset['piece'] = piece.id;
    const name = document.createElement('span');
    name.className = 'metric-label';
    const value = document.createElement('span');
    value.className = 'metric-value';
    const spark = document.createElement('canvas');
    spark.className = 'spark';
    spark.width = 280;
    spark.height = 64;
    spark.dataset['spark'] = piece.id;
    metric.append(name, value, spark);
    return metric;
  };

  const paint = (piece: StatusPiece, node: HTMLElement, stepped: boolean) => {
    if (piece.type === 'label') {
      node.textContent = piece.text;
      return;
    }
    if (piece.type === 'progress') {
      const fill = node.querySelector('.progress-fill');
      if (!(fill instanceof HTMLElement)) return;
      if (piece.value === null) {
        node.classList.add('indeterminate');
        node.removeAttribute('aria-valuenow');
        fill.style.width = '';
        return;
      }
      node.classList.remove('indeterminate');
      const percent = Math.max(0, Math.min(100, piece.value * 100));
      node.setAttribute('aria-valuenow', String(Math.round(percent)));
      fill.style.width = `${percent}%`;
      return;
    }
    if (piece.type === 'readout') {
      const name = node.querySelector('.metric-label');
      const value = node.querySelector('.metric-value');
      if (name) name.textContent = piece.label;
      if (value) value.textContent = piece.value;
      return;
    }
    const name = node.querySelector('.metric-label');
    const value = node.querySelector('.metric-value');
    if (name) name.textContent = piece.label;
    if (value) value.textContent = Number.isInteger(piece.value) ? String(piece.value) : piece.value.toFixed(1);
    pushSample(piece.id, piece.value, stepped);
  };

  const rebuild = (host: HTMLElement, pieces: StatusPiece[], previous: string): string => {
    const next = pieces.map((piece) => `${piece.type}:${piece.id}`).join('|');
    if (next === previous) return previous;
    host.replaceChildren();
    for (const piece of pieces) host.append(elementFor(piece));
    return next;
  };

  return {
    sync(status, stepped) {
      const rowPieces = status.row ?? [];
      const asidePieces = status.aside ?? [];
      rowKey = rebuild(row, rowPieces, rowKey);
      row.append(aside);
      asideKey = rebuild(aside, asidePieces, asideKey);
      aside.hidden = asidePieces.length === 0;
      for (const piece of [...rowPieces, ...asidePieces]) {
        const node = root.querySelector(`[data-piece="${CSS.escape(piece.id)}"]`);
        if (node instanceof HTMLElement) paint(piece, node, stepped);
      }
      message.textContent = status.note ?? '';
    },
    clear() {
      series.clear();
      message.textContent = '';
      banner.hidden = true;
      banner.classList.remove('show');
      for (const canvas of row.querySelectorAll('canvas')) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    },
    showBanner(title, elapsedMs) {
      banner.replaceChildren();
      const heading = document.createElement('strong');
      heading.textContent = `✓ ${title}`;
      const time = document.createElement('span');
      time.textContent = formatElapsed(elapsedMs);
      banner.append(heading, time);
      banner.hidden = false;
      banner.classList.remove('show');
      void banner.offsetWidth;
      banner.classList.add('show');
    },
    clearBanner() {
      banner.hidden = true;
      banner.classList.remove('show');
    },
  };
}

function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}
