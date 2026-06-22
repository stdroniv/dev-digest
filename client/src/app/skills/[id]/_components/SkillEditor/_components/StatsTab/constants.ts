/* StatsTab constants — donut colors per finding category.

   The vendored CAT token map (primitives/tokens.ts) carries each category's icon
   + label but NOT a color; the donut needs one, so we keep a small palette here
   keyed by the FindingCategory enum (bug · security · perf · style · test). */

/** Color for each finding category in the "Findings by category" donut + legend. */
export const CATEGORY_COLOR: Record<string, string> = {
  security: "#f87171",
  bug: "#f59e0b",
  perf: "#a855f7",
  style: "#3b82f6",
  test: "#34d399",
};

/** Fallback for any category not in the palette (defensive — server is the source). */
export const CATEGORY_COLOR_FALLBACK = "var(--text-muted)";

export function categoryColor(category: string): string {
  return CATEGORY_COLOR[category] ?? CATEGORY_COLOR_FALLBACK;
}
