import type { Rgb } from './render';

/** Drag distance for a change of 1. Ten pixels moves the cell by 0.01. */
const PIXELS_PER_UNIT = 1000;

export interface MatrixEditor {
  /** Refresh the cells. Skips the input being typed. Rebuilds when the species count changes. */
  sync(matrix: Float32Array, species: number, colors: readonly Rgb[]): void;
  dispose(): void;
}

/** Live number grid for the interaction matrix. Row feels about column, from −1 to 1. The shell owns the frame around `parent`. */
export function createMatrixEditor(parent: HTMLElement, onEdit: (index: number, value: number) => void): MatrixEditor {
  const grid = document.createElement('div');
  parent.append(grid);

  let inputs: HTMLInputElement[] = [];
  let shown = 0;
  let colorKey = '';
  let dragging: HTMLInputElement | null = null;

  function sync(matrix: Float32Array, species: number, colors: readonly Rgb[]): void {
    const key = colors.map((color) => `${color.r},${color.g},${color.b}`).join('|');
    if (species !== shown || key !== colorKey) {
      colorKey = key;
      build(species, colors);
    }
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index]!;
      if (input === document.activeElement || input === dragging) continue;
      const value = matrix[index] ?? 0;
      input.value = format(value);
      paint(input, value);
    }
  }

  function build(species: number, colors: readonly Rgb[]): void {
    shown = species;
    inputs = [];
    grid.replaceChildren();
    grid.style.display = 'grid';
    grid.style.gap = '3px';
    grid.style.alignItems = 'center';
    grid.style.gridTemplateColumns = `var(--swatch-width) repeat(${species}, var(--scrub-width))`;
    grid.append(corner());
    for (let column = 0; column < species; column += 1) grid.append(swatch(colors[column]));
    for (let row = 0; row < species; row += 1) {
      grid.append(swatch(colors[row]));
      for (let column = 0; column < species; column += 1) {
        const index = row * species + column;
        grid.append(cell(index, row, column));
      }
    }
  }

  function cell(index: number, row: number, column: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '-1';
    input.max = '1';
    input.step = '0.01';
    input.inputMode = 'decimal';
    input.className = 'scrub';
    input.setAttribute('aria-label', `Color ${row + 1} feels about color ${column + 1}`);
    input.draggable = false;
    scrub(input, index);
    input.addEventListener('input', () => {
      const value = read(input.value);
      if (value === null) return;
      paint(input, value);
      onEdit(index, value);
    });
    input.addEventListener('change', () => {
      const value = read(input.value) ?? 0;
      input.value = format(value);
      paint(input, value);
      onEdit(index, value);
    });
    inputs[index] = input;
    return input;
  }

  /** Drag left to decrease, right to increase. A click without a drag still focuses the number for typing. */
  function scrub(input: HTMLInputElement, index: number): void {
    let originX = 0;
    let origin = 0;
    let moved = false;
    let ignoreClick = false;

    input.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      originX = event.clientX;
      origin = read(input.value) ?? 0;
      moved = false;
      dragging = input;
    });
    input.addEventListener('pointermove', (event) => {
      if (dragging !== input) return;
      const dx = event.clientX - originX;
      if (!moved) {
        if (Math.abs(dx) < 3) return;
        moved = true;
        try {
          input.setPointerCapture(event.pointerId);
        } catch {
          // A real pointer is captured so the drag can leave the cell. A synthetic one has nothing to capture.
        }
        input.blur();
      }
      const value = read(String(origin + dx / PIXELS_PER_UNIT)) ?? 0;
      const stepped = Math.round(value * 100) / 100;
      input.value = format(stepped);
      paint(input, stepped);
      onEdit(index, stepped);
    });
    const end = (): void => {
      if (dragging !== input) return;
      dragging = null;
      ignoreClick = moved;
    };
    input.addEventListener('pointerup', end);
    input.addEventListener('pointercancel', end);
    input.addEventListener('click', (event) => {
      if (!ignoreClick) return;
      event.preventDefault();
      input.blur();
      ignoreClick = false;
    });
  }

  return {
    sync,
    dispose() {
      grid.remove();
    },
  };
}

function corner(): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'swatch';
  return span;
}

function swatch(color: Rgb | undefined): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'swatch';
  const paint = color ?? { r: 255, g: 255, b: 255 };
  span.style.background = `rgb(${paint.r}, ${paint.g}, ${paint.b})`;
  return span;
}

function read(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.max(-1, Math.min(1, value));
}

function format(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function paint(input: HTMLInputElement, value: number): void {
  if (value > 0.02) input.style.color = '#7dcea0';
  else if (value < -0.02) input.style.color = '#e07a7a';
  else input.style.color = '#918c84';
}
