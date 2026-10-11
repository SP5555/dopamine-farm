import type { BarPiece, SimHost } from './types';

const SPEED_MIN = 0.5;
const SPEED_MAX = 240;
const SLIDER_MAX = 1000;

export function transportPieces(host: SimHost): BarPiece[] {
  const slider = Math.round(speedToSlider(host.speed));
  return [
    {
      type: 'button',
      id: 'play',
      label: host.paused ? 'Play' : 'Pause',
      pressed: !host.paused,
      shortcut: { key: ' ', hint: 'Space play/pause' },
      onClick: () => host.togglePaused(),
    },
    {
      type: 'button',
      id: 'step',
      label: 'Step',
      shortcut: { key: 'ArrowRight', hint: '→ step', repeat: true },
      onClick: () => host.step(),
    },
    {
      type: 'button',
      id: 'replay',
      label: 'Replay',
      shortcut: { key: 'ArrowLeft', hint: '← replay' },
      onClick: () => host.replay(),
    },
    {
      type: 'button',
      id: 'restart',
      label: 'Restart',
      shortcut: { key: 'r', hint: 'R new run' },
      onClick: () => host.restart(),
    },
    {
      type: 'slider',
      id: 'speed',
      label: 'Speed',
      min: 0,
      max: SLIDER_MAX,
      step: 1,
      value: slider,
      text: formatSpeed(host.speed),
      onChange: (value) => host.setSpeed(sliderToSpeed(value)),
    },
    {
      type: 'button',
      id: 'auto',
      label: 'Auto restart',
      pressed: host.autoRestart,
      toggle: true,
      shortcut: { key: 'a', hint: 'A auto-restart' },
      onClick: () => host.setAutoRestart(!host.autoRestart),
    },
  ];
}

function sliderToSpeed(slider: number): number {
  const logMin = Math.log(SPEED_MIN);
  const logMax = Math.log(SPEED_MAX);
  return Math.exp(logMin + (slider / SLIDER_MAX) * (logMax - logMin));
}

function speedToSlider(speed: number): number {
  const logMin = Math.log(SPEED_MIN);
  const logMax = Math.log(SPEED_MAX);
  const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
  return ((Math.log(clamped) - logMin) / (logMax - logMin)) * SLIDER_MAX;
}

function formatSpeed(speed: number): string {
  const text = speed < 10 ? speed.toFixed(1) : String(Math.round(speed));
  return `${text}/s`;
}
