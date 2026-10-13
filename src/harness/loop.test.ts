import { describe, expect, it } from 'vitest';
import { eventSpan, SPAN_MAX } from './loop';

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
