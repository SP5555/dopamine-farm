import { Pane, type FolderApi } from 'tweakpane';
import { attachChoiceMenus } from './choice-menu';
import { isStructural } from './params';
import type { ParamDef, ParamSchema, Params, SelectOption, UnavailableChoice } from './types';

interface ListBinding {
  hidden: boolean;
  element: HTMLElement;
  options: { text: string; value: string }[];
  refresh(): void;
}

export interface ParamsPanel {
  refresh(): void;
  updateVisibility(): void;
  dispose(): void;
}

export interface PanelHandlers {
  onChange(key: string, structural: boolean, commit: boolean): void;
  onResetDefaults(): void;
}

export function createParamsPanel(
  container: HTMLElement,
  schema: ParamSchema,
  params: Params,
  handlers: PanelHandlers,
): ParamsPanel {
  container.replaceChildren();
  const pane = new Pane({
    container,
    title: 'Config',
    expanded: true,
  });
  pane.element.style.position = 'relative';
  pane.element.style.top = '0';
  pane.element.style.right = '0';
  pane.element.style.width = '100%';

  const detachMenus = attachChoiceMenus(container);
  let muted = true;
  const bindings = new Map<string, { hidden: boolean }>();
  const shownChoices = new Map<string, string>();
  const folders = new Map<string, FolderApi>();

  for (const [key, def] of Object.entries(schema)) {
    bindings.set(key, addControl(hostFor(pane, folders, def.group), params, key, def));
  }

  pane.addButton({ title: 'Reset to defaults' }).on('click', () => {
    if (muted) return;
    handlers.onResetDefaults();
  });

  pane.on('change', (event) => {
    if (muted) return;
    const key = bindingKey(event.target);
    if (!key || !(key in schema)) return;
    const structural = isStructural(schema[key]!);
    handlers.onChange(key, structural, event.last !== false);
  });

  const panel: ParamsPanel = {
    refresh() {
      muted = true;
      pane.refresh();
      muted = false;
      panel.updateVisibility();
    },
    updateVisibility() {
      const wasMuted = muted;
      muted = true;
      for (const [key, def] of Object.entries(schema)) {
        const binding = bindings.get(key);
        if (!binding) continue;
        binding.hidden = def.when ? !def.when(params) : false;
        if (def.type === 'number') applyBounds(key, def, params, binding);
        if (def.type === 'select') refreshChoices(key, def, params, binding, shownChoices);
      }
      muted = wasMuted;
    },
    dispose() {
      hideDetail();
      detachMenus();
      pane.dispose();
      container.replaceChildren();
    },
  };

  panel.updateVisibility();
  window.setTimeout(() => {
    muted = false;
  }, 0);
  return panel;
}

function hostFor(pane: Pane, folders: Map<string, FolderApi>, group: string | undefined): Pane | FolderApi {
  if (!group) return pane;
  const existing = folders.get(group);
  if (existing) return existing;
  const folder = pane.addFolder({ title: group, expanded: true });
  folders.set(group, folder);
  return folder;
}

function addControl(parent: Pane | FolderApi, params: Params, key: string, def: ParamDef): { hidden: boolean } {
  const binding =
    def.type === 'number'
      ? parent.addBinding(params, key, {
          label: def.label,
          min: def.min,
          max: def.max,
          step: def.step,
        })
      : def.type === 'boolean'
        ? parent.addBinding(params, key, { label: def.label })
        : parent.addBinding(params, key, {
            label: def.label,
            options: def.options.map((option) => ({ text: option.label, value: option.value })),
          });
  if (def.detail) attachDetail(binding.element, def.detail);
  return binding;
}

let detailTip: HTMLDivElement | null = null;

function attachDetail(row: HTMLElement, text: string): void {
  row.dataset.detail = text;
  const label = row.querySelector('.tp-lblv_l');
  if (label instanceof HTMLElement) label.style.cursor = 'help';
  row.addEventListener('pointerenter', () => showDetail(row, text));
  row.addEventListener('pointerleave', hideDetail);
}

function showDetail(row: HTMLElement, text: string): void {
  if (!detailTip) {
    detailTip = document.createElement('div');
    detailTip.className = 'param-tip';
    document.body.append(detailTip);
  }
  detailTip.textContent = text;
  const rowBox = row.getBoundingClientRect();
  const tipBox = detailTip.getBoundingClientRect();
  detailTip.style.left = `${Math.max(8, rowBox.left - tipBox.width - 10)}px`;
  detailTip.style.top = `${Math.max(8, rowBox.top + (rowBox.height - tipBox.height) / 2)}px`;
}

function hideDetail(): void {
  detailTip?.remove();
  detailTip = null;
}

interface RangeBinding {
  hidden: boolean;
  min: number;
  max: number;
  refresh(): void;
}

function applyBounds(
  key: string,
  def: Extract<ParamDef, { type: 'number' }>,
  params: Params,
  binding: { hidden: boolean },
): void {
  const slider = asRange(binding);
  const range = def.bounds?.(params) ?? { min: def.min, max: def.max };
  let refresh = false;
  if (slider) {
    if (slider.min !== range.min) {
      slider.min = range.min;
      refresh = true;
    }
    if (slider.max !== range.max) {
      slider.max = range.max;
      refresh = true;
    }
  }
  if (typeof params[key] === 'number') {
    const clamped = Math.min(range.max, Math.max(range.min, params[key]));
    if (clamped !== params[key]) {
      params[key] = clamped;
      refresh = true;
    }
  }
  if (refresh) slider?.refresh();
}

function asRange(binding: { hidden: boolean }): RangeBinding | null {
  if (!('min' in binding) || !('max' in binding) || !('refresh' in binding)) return null;
  return binding as RangeBinding;
}

function refreshChoices(
  key: string,
  def: Extract<ParamDef, { type: 'select' }>,
  params: Params,
  binding: { hidden: boolean },
  shownChoices: Map<string, string>,
): void {
  const noted = notedChoices(def, params);
  const signature = noted.map((option) => `${option.value}\0${option.note ?? ''}\0${option.detail ?? ''}`).join('\n');
  const list = asList(binding);
  let changed = false;
  if (list && shownChoices.get(key) !== signature) {
    shownChoices.set(key, signature);
    list.options = noted.map((option) => ({
      text: option.note ? `${option.label} · ${option.note}` : option.label,
      value: option.value,
    }));
    changed = true;
  }
  const selectable = noted.filter((option) => option.note === null);
  if (!selectable.some((option) => option.value === params[key])) {
    params[key] = selectable[0]?.value ?? def.default;
    changed = true;
  }
  if (changed) list?.refresh();
  if (list) markDisabled(list, noted);
}

function notedChoices(
  def: Extract<ParamDef, { type: 'select' }>,
  params: Params,
): Array<{ value: string; label: string; note: string | null; detail: string | null }> {
  return def.options.map((option) => {
    const noted = optionNote(def, option, params);
    return { value: option.value, label: option.label, note: noted.note, detail: noted.detail };
  });
}

function optionNote(
  def: Extract<ParamDef, { type: 'select' }>,
  option: SelectOption,
  params: Params,
): { note: string | null; detail: string | null } {
  const enabled = { note: null, detail: option.detail ?? null };
  if (!def.available) return enabled;
  const verdict = def.available(option, params);
  if (verdict === true) return enabled;
  if (typeof verdict === 'string' && verdict.length > 0) return { note: verdict, detail: verdict };
  if (isUnavailableChoice(verdict)) return { note: verdict.note, detail: verdict.detail };
  return { note: 'unavailable', detail: 'This option is not available.' };
}

function isUnavailableChoice(value: boolean | string | UnavailableChoice): value is UnavailableChoice {
  return typeof value === 'object' && value !== null && 'note' in value && 'detail' in value;
}

function markDisabled(
  list: ListBinding,
  noted: Array<{ note: string | null; detail: string | null }>,
): void {
  const select = list.element.querySelector('select');
  if (!select) return;
  noted.forEach((item, index) => {
    const option = select.options[index];
    if (!option) return;
    option.disabled = item.note !== null;
    if (item.detail) option.dataset.detail = item.detail;
    else delete option.dataset.detail;
  });
}

function asList(binding: { hidden: boolean }): ListBinding | null {
  if (!('options' in binding) || !('refresh' in binding)) return null;
  return binding as ListBinding;
}

function bindingKey(target: object): string | null {
  if (!('key' in target)) return null;
  const key = target.key;
  return typeof key === 'string' ? key : null;
}
