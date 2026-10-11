import type { SimStatus } from './types';

export interface LoopHooks {
  step(): void;
  render(alpha: number): void;
  getStatus(): SimStatus;
}

export interface FrameInfo {
  steps: number;
  status: SimStatus;
}

const MAX_STEPS = 500;
const FRAME_BUDGET_MS = 12;

export interface Loop {
  start(): void;
  stop(): void;
  restartTiming(): void;
  setSpeed(stepsPerSecond: number): void;
  setPaused(paused: boolean): void;
  readonly paused: boolean;
  readonly speed: number;
  requestStep(): void;
  onFrame(listener: (info: FrameInfo) => void): () => void;
}

export function createLoop(hooks: LoopHooks): Loop {
  let raf = 0;
  let running = false;
  let paused = false;
  let coast = false;
  let speed = 8;
  let accumulator = 0;
  let last = 0;
  let pendingSteps = 0;
  const listeners = new Set<(info: FrameInfo) => void>();

  const burst = (): number => {
    const started = performance.now();
    let steps = 0;
    while (steps < MAX_STEPS && performance.now() - started < FRAME_BUDGET_MS) {
      hooks.step();
      steps += 1;
      const mid = hooks.getStatus();
      if (mid.done) break;
      if (mid.computing !== true) break;
    }
    return steps;
  };

  const frame = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);

    const dt = last === 0 ? 0 : Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    let steps = 0;
    let snap = false;
    const begin = hooks.getStatus();

    if (pendingSteps > 0) {
      // Play one move at the current speed, then hold. Same slide as playback.
      coast = false;
      if (begin.done) {
        pendingSteps = 0;
        paused = true;
        accumulator = 0;
        snap = true;
      } else if (begin.computing === true) {
        steps = burst();
        pendingSteps -= 1;
        const mid = hooks.getStatus();
        if (mid.done || mid.computing !== true) pendingSteps = 0;
        accumulator = 0;
        snap = true;
        if (pendingSteps === 0) paused = true;
      } else {
        accumulator += dt * speed;
        while (accumulator >= 1 && pendingSteps > 0 && steps < MAX_STEPS) {
          hooks.step();
          steps += 1;
          pendingSteps -= 1;
          accumulator -= 1;
          const mid = hooks.getStatus();
          if (mid.done || mid.computing === true) {
            pendingSteps = 0;
            accumulator = 0;
            break;
          }
        }
        if (pendingSteps === 0) {
          paused = true;
          accumulator = 0;
          snap = true;
        }
      }
    } else if (coast) {
      // Finish the step already on screen, then hold. A step that has not started stops now.
      if (begin.done || begin.computing === true || accumulator === 0) {
        paused = true;
        coast = false;
        snap = true;
      } else {
        accumulator += dt * speed;
        if (accumulator >= 1) {
          hooks.step();
          steps = 1;
          accumulator = 0;
          paused = true;
          coast = false;
          snap = true;
        }
      }
    } else if (!paused && !begin.done && begin.computing === true) {
      steps = burst();
      snap = true;
    } else if (!paused && !begin.done) {
      accumulator += dt * speed;
      while (accumulator >= 1 && steps < MAX_STEPS) {
        hooks.step();
        accumulator -= 1;
        steps += 1;
        const mid = hooks.getStatus();
        if (mid.done) {
          accumulator = 0;
          break;
        }
        if (mid.computing === true) {
          steps += burst();
          accumulator = 0;
          snap = true;
          break;
        }
      }
    } else {
      snap = true;
    }

    const status = hooks.getStatus();
    const alpha = snap || status.done ? 0 : accumulator - Math.floor(accumulator);
    hooks.render(alpha);
    for (const listener of listeners) listener({ steps, status });
  };

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    restartTiming() {
      accumulator = 0;
      pendingSteps = 0;
      coast = false;
      last = performance.now();
    },
    setSpeed(stepsPerSecond: number) {
      speed = stepsPerSecond;
    },
    setPaused(next: boolean) {
      if (!next) {
        paused = false;
        coast = false;
        pendingSteps = 0;
        return;
      }
      if (pendingSteps > 0) {
        pendingSteps = 1;
        return;
      }
      coast = true;
      if (accumulator === 0) {
        paused = true;
        coast = false;
      }
    },
    get paused() {
      return paused;
    },
    get speed() {
      return speed;
    },
    requestStep() {
      pendingSteps += 1;
    },
    onFrame(listener: (info: FrameInfo) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
