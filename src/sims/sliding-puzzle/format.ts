export function formatCount(value: number): string {
  const rounded = Math.round(value);
  if (rounded < 1000) return String(rounded);
  if (rounded < 10_000) return `${(rounded / 1000).toFixed(2)}k`;
  if (rounded < 1_000_000) return `${(rounded / 1000).toFixed(rounded < 100_000 ? 1 : 0)}k`;
  return `${(rounded / 1_000_000).toFixed(2)}M`;
}

export function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}
