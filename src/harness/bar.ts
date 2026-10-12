import type { BarPiece } from './types';

const SPARK_CAPACITY = 600;

interface SparkSeries {
  samples: Float64Array;
  count: number;
  head: number;
  last: number;
}

export interface Bar {
  sync(pieces: readonly BarPiece[], stepped?: boolean): void;
  setEnabled(enabled: boolean): void;
  hint(): string;
  handleKey(event: KeyboardEvent): boolean;
  clear(): void;
}

export function createBar(root: HTMLElement): Bar {
  let current: readonly BarPiece[] = [];
  let signature = '';
  let enabled = true;
  const nodes = new Map<string, HTMLElement>();
  const series = new Map<string, SparkSeries>();

  const find = (id: string): BarPiece | undefined => current.find((item) => item.id === id);

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

  const paint = (item: BarPiece, node: HTMLElement, stepped: boolean) => {
    if (item.type === 'button') {
      const button = node as HTMLButtonElement;
      button.textContent = item.label;
      button.disabled = !enabled || item.disabled === true;
      if (item.pressed === undefined) button.removeAttribute('aria-pressed');
      else button.setAttribute('aria-pressed', String(item.pressed));
      button.classList.toggle('toggle', item.toggle === true);
      button.title = item.shortcut?.hint ?? '';
      return;
    }
    if (item.type === 'slider') {
      const name = node.querySelector('.bar-slider-label');
      const slider = node.querySelector('input');
      const readout = node.querySelector('.bar-slider-value');
      if (name) name.textContent = item.label;
      if (slider instanceof HTMLInputElement) {
        slider.disabled = !enabled;
        slider.min = String(item.min);
        slider.max = String(item.max);
        slider.step = String(item.step ?? 1);
        if (document.activeElement !== slider) slider.value = String(item.value);
      }
      if (readout) readout.textContent = item.text;
      return;
    }
    if (item.type === 'select') {
      const name = node.querySelector('.bar-select-label');
      const select = node.querySelector('select');
      if (name) name.textContent = item.label;
      if (!(select instanceof HTMLSelectElement)) return;
      select.disabled = !enabled;
      const optionsKey = item.options.map((option) => `${option.value}:${option.label}`).join('|');
      if (select.dataset['options'] !== optionsKey) {
        select.dataset['options'] = optionsKey;
        select.replaceChildren();
        for (const option of item.options) {
          const nodeOption = document.createElement('option');
          nodeOption.value = option.value;
          nodeOption.textContent = option.label;
          select.append(nodeOption);
        }
      }
      select.value = item.value;
      return;
    }
    if (item.type === 'label') {
      node.textContent = item.text;
      return;
    }
    if (item.type === 'progress') {
      const fill = node.querySelector('.bar-progress-fill');
      if (!(fill instanceof HTMLElement)) return;
      if (item.value === null) {
        node.classList.add('indeterminate');
        node.removeAttribute('aria-valuenow');
        fill.style.width = '';
        return;
      }
      node.classList.remove('indeterminate');
      const percent = Math.max(0, Math.min(100, item.value * 100));
      node.setAttribute('aria-valuenow', String(Math.round(percent)));
      fill.style.width = `${percent}%`;
      return;
    }
    if (item.type === 'readout') {
      const name = node.querySelector('.bar-metric-label');
      const value = node.querySelector('.bar-metric-value');
      if (name) name.textContent = item.label;
      if (value) value.textContent = item.value;
      return;
    }
    const name = node.querySelector('.bar-metric-label');
    const value = node.querySelector('.bar-metric-value');
    if (name) name.textContent = item.label;
    if (value) value.textContent = Number.isInteger(item.value) ? String(item.value) : item.value.toFixed(1);
    pushSample(item.id, item.value, stepped);
  };

  const build = (item: BarPiece): HTMLElement => {
    const node = elementFor(item);
    node.dataset['piece'] = item.id;
    if (item.type === 'button') {
      node.addEventListener('click', () => {
        const live = find(item.id);
        if (live?.type === 'button' && live.disabled !== true) live.onClick();
      });
    } else if (item.type === 'slider') {
      const slider = node.querySelector('input');
      slider?.addEventListener('input', () => {
        const live = find(item.id);
        if (live?.type === 'slider' && slider instanceof HTMLInputElement) live.onChange(Number(slider.value));
      });
    } else if (item.type === 'select') {
      const select = node.querySelector('select');
      select?.addEventListener('change', () => {
        const live = find(item.id);
        if (live?.type === 'select' && select instanceof HTMLSelectElement) live.onChange(select.value);
      });
    }
    return node;
  };

  return {
    sync(pieces, stepped = false) {
      current = pieces;
      const next = pieces.map((item) => `${item.type}:${item.id}`).join('|');
      if (next !== signature) {
        signature = next;
        nodes.clear();
        root.replaceChildren();
        for (const item of pieces) {
          const node = build(item);
          nodes.set(item.id, node);
          root.append(node);
        }
      }
      for (const item of pieces) {
        const node = nodes.get(item.id);
        if (node) paint(item, node, stepped);
      }
    },
    setEnabled(next) {
      enabled = next;
      for (const item of current) {
        const node = nodes.get(item.id);
        if (node) paint(item, node, false);
      }
    },
    hint() {
      const hints: string[] = [];
      for (const item of current) {
        if (item.type === 'button' && item.shortcut) hints.push(item.shortcut.hint);
      }
      return hints.join(' · ');
    },
    handleKey(event) {
      if (!enabled) return false;
      for (const item of current) {
        if (item.type !== 'button' || !item.shortcut) continue;
        if (!sameKey(item.shortcut.key, event.key)) continue;
        if (event.repeat && item.shortcut.repeat !== true) return false;
        if (item.disabled) return true;
        event.preventDefault();
        item.onClick();
        return true;
      }
      return false;
    },
    clear() {
      series.clear();
      for (const canvas of root.querySelectorAll('canvas')) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    },
  };
}

function elementFor(item: BarPiece): HTMLElement {
  if (item.type === 'button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bar-button';
    return button;
  }
  if (item.type === 'slider') {
    const wrap = document.createElement('label');
    wrap.className = 'bar-slider';
    const name = document.createElement('span');
    name.className = 'bar-slider-label';
    name.textContent = item.label;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.setAttribute('aria-label', item.label);
    const readout = document.createElement('span');
    readout.className = 'bar-slider-value';
    wrap.append(name, slider, readout);
    return wrap;
  }
  if (item.type === 'select') {
    const wrap = document.createElement('label');
    wrap.className = 'bar-select';
    const name = document.createElement('span');
    name.className = 'bar-select-label';
    name.textContent = item.label;
    const select = document.createElement('select');
    select.setAttribute('aria-label', item.label);
    wrap.append(name, select);
    return wrap;
  }
  if (item.type === 'label') {
    const label = document.createElement('span');
    label.className = 'bar-label';
    return label;
  }
  if (item.type === 'progress') {
    const progress = document.createElement('div');
    progress.className = 'bar-progress';
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    const fill = document.createElement('div');
    fill.className = 'bar-progress-fill';
    progress.append(fill);
    return progress;
  }
  if (item.type === 'readout') {
    const readout = document.createElement('span');
    readout.className = 'bar-readout';
    const name = document.createElement('span');
    name.className = 'bar-metric-label';
    const value = document.createElement('span');
    value.className = 'bar-metric-value';
    readout.append(name, value);
    return readout;
  }
  const metric = document.createElement('span');
  metric.className = 'bar-metric';
  const name = document.createElement('span');
  name.className = 'bar-metric-label';
  const value = document.createElement('span');
  value.className = 'bar-metric-value';
  const spark = document.createElement('canvas');
  spark.className = 'bar-spark';
  spark.width = 280;
  spark.height = 64;
  spark.dataset['spark'] = item.id;
  metric.append(name, value, spark);
  return metric;
}

function sameKey(expected: string, actual: string): boolean {
  if (expected === ' ') return actual === ' ' || actual === 'Spacebar';
  return expected.toLowerCase() === actual.toLowerCase();
}
