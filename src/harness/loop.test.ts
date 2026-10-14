import { describe, expect, it, vi, afterEach } from 'vitest';
import { createLoop, eventSpan, SPAN_MAX } from './loop';

describe('eventSpan', () => {
  it('uses one tick when span is omitted or out of range', () => {
    expect(eventSpan({ done: false })).toBe(1);
    expect(eventSpan({ done: false, span: 0 })).toBe(1);
    expect(eventSpan({ done: false, span: Number.NaN })).toBe(1);
    expect(eventSpan({ done: false, span: SPAN_MAX + 1 })).toBe(1);
  });

  it('keeps a short step and a gesture of several ticks', () => {
    expect(eventSpan({ done: false, span: 0.5 })).toBe(0.5);
    expect(eventSpan({ done: false, span: 3 })).toBe(3);
    expect(eventSpan({ done: false, span: SPAN_MAX })).toBe(SPAN_MAX);
  });
});

describe('frame pace', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function play(loop: ReturnType<typeof createLoop>, offsets: number[]): void {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    loop.start();
    const origin = performance.now();
    for (const offset of offsets) {
      const frame = frames.shift();
      frame?.(origin + offset);
    }
  }

  it('passes a smaller delta on a faster display and the same world time either way', () => {
    const slow: number[] = [];
    const slowLoop = createLoop({
      step(dt) {
        slow.push(dt ?? 0);
      },
      render() {},
      getStatus: () => ({ done: false }),
    });
    slowLoop.setPace('frame');
    play(slowLoop, [1000 / 60]);

    const fast: number[] = [];
    const fastLoop = createLoop({
      step(dt) {
        fast.push(dt ?? 0);
      },
      render() {},
      getStatus: () => ({ done: false }),
    });
    fastLoop.setPace('frame');
    play(
      fastLoop,
      [1, 2, 3, 4].map((i) => (i * 1000) / 240),
    );

    expect(slow).toHaveLength(1);
    expect(slow[0]).toBeCloseTo(1 / 60, 2);
    expect(fast).toHaveLength(4);
    expect(fast.reduce((sum, dt) => sum + dt, 0)).toBeCloseTo(1 / 60, 2);
  });

  it('holds the step clock while paused and still draws', () => {
    let steps = 0;
    let frames = 0;
    const loop = createLoop({
      step() {
        steps += 1;
      },
      render() {
        frames += 1;
      },
      getStatus: () => ({ done: false }),
    });
    loop.setPace('frame');
    loop.setPaused(true);
    play(loop, [0, 1000]);
    expect(steps).toBe(0);
    expect(frames).toBe(2);
  });
});
