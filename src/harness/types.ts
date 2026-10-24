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
  /**
   * Seed in the top bar and the address. On by default.
   * Off means the sim owns the seed: the shell does not roll one, and `reset` is called without one.
   */
  seed?: boolean;
  /**
   * `step` counts a fixed number of steps per wall second. The speed slider is that count.
   * `frame` takes one step per displayed frame and passes that frame's seconds into `step`.
   * The default speed is realtime there: a faster display passes a smaller delta.
   */
  pace?: 'step' | 'frame';
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
  | { type: 'metric'; id: string; label: string; value: number; series?: string };

/**
 * What the shell can do for a sim. The sim decides which of these to call,
 * from the controls it declares.
 */
export interface SimHost {
  readonly paused: boolean;
  readonly speed: number;
  /** `frame` when this sim steps once per displayed frame. Otherwise `step`. */
  readonly pace: 'step' | 'frame';
  readonly autoRestart: boolean;
  /** Seed of the run on screen, when the shell owns it. Unused when `chrome.seed` is off. */
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
   * A frame pinned to a corner of the world. Fill `body`. Call it from `create`.
   * `corner` defaults to the bottom-right.
   */
  card(options?: CardOptions): WorldCard;
  /**
   * Optional playback pieces: play, step, replay, restart, the speed slider, and auto-restart.
   * Take the whole list, a few of them, or none. Plenty of sims are not played step by step.
   * The slider maps 0–1000 onto 0.5–240 steps per second. The shell starts at 8.
   * In frame pace that same slider is a time scale, and 8 is realtime.
   */
  transport(): BarPiece[];
}

export type CardCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface CardOptions {
  /** Where the frame sits on the world. Defaults to the bottom-right. */
  corner?: CardCorner;
  /** One line above the body. Leave it off and there is no line. */
  caption?: string;
}

export interface WorldCard {
  /** The sim fills this. The shell owns the frame around it. */
  readonly body: HTMLElement;
  setCaption(text: string): void;
  dispose(): void;
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
  /** Shown when the control is hovered. */
  detail?: string;
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
   * How many speed ticks this event lasts. `1` is one step. `0.5` ends halfway through a step.
   * `3` holds the clock for three steps, and `alpha` still runs from 0 to 1 across all three.
   * Omitted means 1. Non-finite values, and values above 8, also count as 1.
   * Ignored while `computing` is set.
   */
  span?: number;
  /** Optional. Left side of the footer. Omit it and that side stays blank. */
  row?: BarPiece[];
  /** Optional. Right side of the footer. Omit it and that side stays blank. */
  aside?: BarPiece[];
  note?: string;
  /** Done banner title. The shell adds the elapsed time. */
  banner?: string;
}

export interface SimInstance<P extends Params = Params> {
  /** Starts a run. Return quickly. Slow setup is a later phase with `computing` set. The seed is omitted when the sim owns it. */
  reset(params: P, seed?: number): void;
  /**
   * One event on the fixed clock. In frame pace, `dt` is the seconds to integrate:
   * the time since the previous frame, scaled so the default speed is realtime.
   */
  step(dt?: number): void;
  render(alpha: number): void;
  getStatus(): SimStatus;
  /** Optional pieces for the top bar. Empty, or omitted, leaves that bar blank. */
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
