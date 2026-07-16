import type { DateRangeKey } from "./constants";

/** Compact timestamp for the CI Runs list's TIMESTAMP column, e.g. "Jul 12, 14:32". */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** ISO cutoff for a date-range filter preset; `undefined` for "All time" (no
 *  client-side lower bound — the server's own bounded window, AC-34, still
 *  applies). */
export function sinceFor(range: DateRangeKey): string | undefined {
  if (range === "all") return undefined;
  const days = range === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
