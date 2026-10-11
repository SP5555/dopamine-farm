import type { ToolbarControl } from './types';

export interface Toolbar {
  sync(controls: readonly ToolbarControl[]): void;
  setEnabled(enabled: boolean): void;
  hint(): string;
  handleKey(event: KeyboardEvent): boolean;
}

export function createToolbar(root: HTMLElement): Toolbar {
  let current: readonly ToolbarControl[] = [];
  let signature = '';
  let enabled = true;
  const nodes = new Map<string, HTMLElement>();

  const find = (id: string): ToolbarControl | undefined => current.find((item) => item.id === id);

  const paint = (item: ToolbarControl, node: HTMLElement) => {
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
      const slider = node.querySelector('input');
      const readout = node.querySelector('.speed-readout');
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
    const select = node.querySelector('select');
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
  };

  const build = (item: ToolbarControl): HTMLElement => {
    if (item.type === 'button') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'control';
      button.addEventListener('click', () => {
        const live = find(item.id);
        if (live?.type === 'button' && live.disabled !== true) live.onClick();
      });
      return button;
    }
    if (item.type === 'slider') {
      const wrap = document.createElement('label');
      wrap.className = 'toolbar-range';
      const name = document.createElement('span');
      name.textContent = item.label;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.setAttribute('aria-label', item.label);
      const readout = document.createElement('span');
      readout.className = 'speed-readout';
      wrap.append(name, slider, readout);
      slider.addEventListener('input', () => {
        const live = find(item.id);
        if (live?.type === 'slider') live.onChange(Number(slider.value));
      });
      return wrap;
    }
    const wrap = document.createElement('label');
    wrap.className = 'toolbar-select';
    const name = document.createElement('span');
    name.textContent = item.label;
    const select = document.createElement('select');
    select.setAttribute('aria-label', item.label);
    wrap.append(name, select);
    select.addEventListener('change', () => {
      const live = find(item.id);
      if (live?.type === 'select') live.onChange(select.value);
    });
    return wrap;
  };

  return {
    sync(controls) {
      current = controls;
      const next = controls.map((item) => `${item.type}:${item.id}`).join('|');
      if (next !== signature) {
        signature = next;
        nodes.clear();
        root.replaceChildren();
        for (const item of controls) {
          const node = build(item);
          nodes.set(item.id, node);
          root.append(node);
        }
      }
      for (const item of controls) {
        const node = nodes.get(item.id);
        if (node) paint(item, node);
      }
    },
    setEnabled(next) {
      enabled = next;
      for (const item of current) {
        const node = nodes.get(item.id);
        if (node) paint(item, node);
      }
    },
    hint() {
      return current
        .filter((item) => item.type === 'button' && item.shortcut)
        .map((item) => (item.type === 'button' ? item.shortcut?.hint : ''))
        .filter((hint): hint is string => Boolean(hint))
        .join(' · ');
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
  };
}

function sameKey(expected: string, actual: string): boolean {
  if (expected === ' ') return actual === ' ' || actual === 'Spacebar';
  return expected.toLowerCase() === actual.toLowerCase();
}
