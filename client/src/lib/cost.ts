/**
 * Dollar-cost formatting for run cost badges (PR list COST column, the Agent
 * runs timeline, and the trace sidebar's COST stat).
 *
 * Precision adapts to magnitude so small sub-cent runs stay legible while
 * larger totals don't show noise: `$12.34`, `$0.123`, `$0.0123`. Null/undefined
 * (no run, or a failed/cancelled run with no cost) renders as an em dash.
 */
export function formatUsd(usd: number | null | undefined): string {
  if (usd == null) return "—";
  const abs = Math.abs(usd);
  const decimals = abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  return `$${usd.toFixed(decimals)}`;
}
