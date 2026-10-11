export interface SimMeta {
  id: string;
  title: string;
  description: string;
  tags?: string[];
}

/** Which shell slots a sim uses. Omitted fields stay on. */
export interface SimChrome {
  /** Config panel. Defaults on when `params` has at least one key. */
  params?: boolean;
}

export interface ToolbarShortcut {
  /** `KeyboardEvent.key`, compared case-insensitively except for space. */
  key: string;
  /** Shown in the hint line, such as `Space play/pause`. */
  hint: string;
  /** Hold the key to fire again. */
  repeat?: boolean;
}

export type ToolbarControl =
  | {
      type: 'button';
      id: string;
      label: string;
      shortcut?: ToolbarShortcut;
      /** Draws the pressed style. Omit it for a plain button. */
      pressed?: boolean;
      /** Use the pressed highlight. Plain buttons leave this off. */
      toggle?: boolean;
      disabled?: boolean;
      onClick: () => void;
    }
  | {
      type: 'slider';
      id: string;
      label: string;
      min: number;
      max: number;
      step?: number;
      value: number;
      /** Readout beside the slider. The sim formats it. */
      text: string;
      onChange: (value: number) => void;
    }
  | {
      type: 'select';
      id: string;
      label: string;
      value: string;
      options: { value: string; label: string }[];
      onChange: (value: string) => void;
    };

export type StatusPiece =
  | { type: 'label'; id: string; text: string }
  | { type: 'progress'; id: string; value: number | null }
  | { type: 'readout'; id: string; label: string; value: string }
  | { type: 'metric'; id: string; label: string; value: number };

/**
 * What the shell can do for a sim. The sim decides which of these to call,
 * from the controls it declares.
 */
export interface SimHost {
  readonly paused: boolean;
  readonly speed: number;
  readonly autoRestart: boolean;
  setPaused(paused: boolean): void;
  togglePaused(): void;
  step(): void;
  restart(): void;
  setSpeed(stepsPerSecond: number): void;
  setAutoRestart(on: boolean): void;
}

export interface SelectOption {
  value: string;
  label: string;
  /** One-line explanation shown when this choice is hovered and can be picked. */
  detail?: string;
}

export interface UnavailableChoice {
  note: string;
  detail: string;
}

interface ParamBase {
  label: string;
  /** Structural params restart the run. Live params call setParams and continue. */
  reset?: boolean;
  /** Hide the control when this returns false. The value is still part of the run. */
  when?: (params: Params) => boolean;
  /** Folder title. Controls that share a title share one folder, in schema order. */
  group?: string;
}

export type ParamDef =
  | (ParamBase & {
      type: 'number';
      default: number;
      min: number;
      max: number;
      step?: number;
      /** Narrows min and max from the current params. Values outside it are clamped. */
      bounds?: (params: Params) => { min: number; max: number };
    })
  | (ParamBase & {
      type: 'boolean';
      default: boolean;
    })
  | (ParamBase & {
      type: 'select';
      default: string;
      options: SelectOption[];
      /**
       * `true` keeps the option selectable and uses `option.detail` on hover.
       * A string, or `{ note, detail }`, keeps it visible but disabled. `note`
       * follows the label. That `detail` replaces `option.detail` while it is disabled.
       */
      available?: (option: SelectOption, params: Params) => boolean | string | UnavailableChoice;
    });

export type ParamSchema = Record<string, ParamDef>;
export type Params = Record<string, number | boolean | string>;

export interface SimContext {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  dpr: number;
}

export interface SimStatus {
  done: boolean;
  /** This step is work, not a frame. The shell runs a short burst and skips the slide. */
  computing?: boolean;
  /** Left side of the footer, in order. */
  row?: StatusPiece[];
  /** Right side of the footer, in order. */
  aside?: StatusPiece[];
  note?: string;
  /** Done banner title. The shell adds the elapsed time. */
  banner?: string;
}

export interface SimInstance<P extends Params = Params> {
  reset(params: P, seed: number): void;
  step(): void;
  render(alpha: number): void;
  getStatus(): SimStatus;
  /** Controls for the toolbar. Empty, or omitted, leaves the toolbar blank. */
  toolbar?(): ToolbarControl[];
  setParams?(changed: Partial<P>, all: P): void;
  resize?(width: number, height: number, dpr: number): void;
  dispose(): void;
}

export interface SimModule<P extends Params = Params> {
  params: ParamSchema;
  /** Shell slots. Omitted fields use the defaults in `SimChrome`. */
  chrome?: SimChrome;
  /** Pulls the param bag back to a combination this sim can run. */
  normalize?(params: Params): void;
  create(ctx: SimContext, host: SimHost): SimInstance<P>;
}
