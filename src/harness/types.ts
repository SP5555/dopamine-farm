export interface SimMeta {
  id: string;
  title: string;
  description: string;
  /**
   * Nav position. Lower comes first. The first sim is what opens when the address
   * has no id. Sims that omit this sort after the numbered ones, then by title.
   */
  order?: number;
}

/** Which shell slots a sim uses. An omitted field uses the default described on that field. */
export interface SimChrome {
  /** Config panel. On when the schema has a param, unless this says otherwise. */
  params?: boolean;
}

export interface BarShortcut {
  /** `KeyboardEvent.key`, compared case-insensitively except for space. */
  key: string;
  /** Shown in the hint line, such as `Space play/pause`. */
  hint: string;
  /** Hold the key to fire again. */
  repeat?: boolean;
}

/** A piece either bar can show. Buttons, sliders, and dropdowns carry their own handlers. */
export type BarPiece =
  | {
      type: 'button';
      id: string;
      label: string;
      shortcut?: BarShortcut;
      /** Reports the button as pressed. Omit it for a plain button. */
      pressed?: boolean;
      /** Draws the pressed highlight. A button can be pressed without this. */
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
    }
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
  /** Seed of the run on screen. The shell also shows this in the top bar. */
  readonly seed: number;
  setPaused(paused: boolean): void;
  togglePaused(): void;
  step(): void;
  /** Roll a new seed and start again. */
  restart(): void;
  /** Start the current seed again. */
  replay(): void;
  setSpeed(stepsPerSecond: number): void;
  setAutoRestart(on: boolean): void;
  /**
   * Play, pause, step, replay, restart, the log speed slider, and auto-restart.
   * Spread this into `toolbar()` and add any pieces of your own.
   * The slider maps 0–1000 onto 0.5–240 steps per second. The shell starts at 8.
   */
  transport(): BarPiece[];
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
  /**
   * No visible event yet. The shell bursts for about 12ms, at most 500 steps,
   * then draws with `alpha` 0 so the search does not play a slide.
   */
  computing?: boolean;
  /**
   * Length of the event on screen, as a fraction of one step. Omitted means 1.
   * `alpha` still runs from 0 to 1 across that fraction, and the next event
   * starts when it ends. Ignored while `computing` is set.
   */
  span?: number;
  /** Left side of the footer, in order. Any bar piece. */
  row?: BarPiece[];
  /** Right side of the footer, in order. Any bar piece. */
  aside?: BarPiece[];
  note?: string;
  /** Done banner title. The shell adds the elapsed time. */
  banner?: string;
}

export interface SimInstance<P extends Params = Params> {
  /** Starts a run. Return quickly. Slow setup is a later phase with `computing` set. */
  reset(params: P, seed: number): void;
  step(): void;
  render(alpha: number): void;
  getStatus(): SimStatus;
  /** Pieces for the top bar. Empty, or omitted, leaves that bar blank. */
  toolbar?(): BarPiece[];
  setParams?(changed: Partial<P>, all: P): void;
  resize?(width: number, height: number, dpr: number): void;
  dispose(): void;
}

export interface SimModule<P extends Params = Params> {
  params: ParamSchema;
  /** Shell slots. See `SimChrome` for what each omitted field does. */
  chrome?: SimChrome;
  /** Pulls the param bag back to a combination this sim can run. */
  normalize?(params: Params): void;
  create(ctx: SimContext, host: SimHost): SimInstance<P>;
}
