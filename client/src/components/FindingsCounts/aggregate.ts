import type { ReviewRecord, FindingRecord } from "@devdigest/shared";

/** Severity sort rank (highest first) — CRITICAL → WARNING → SUGGESTION. */
const RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

/**
 * The findings behind a PR's FINDINGS counters, for the hover popover. MIRRORS
 * the server's PR-list aggregation (`pulls/routes.ts`): take the latest review
 * PER reviewer agent (kind 'review' only), union their findings, and sort by
 * severity then confidence. Because both sides apply the same rule, the popover
 * list length matches the badge total (sum of `findings_counts`). Dismissed
 * findings are kept (the badge counts them too).
 */
export function aggregateLatestPerAgent(reviews: ReviewRecord[]): FindingRecord[] {
  const latest = new Map<string, ReviewRecord>();
  for (const r of reviews) {
    if (r.kind !== "review") continue;
    const key = r.agent_id ?? "null";
    const prev = latest.get(key);
    if (!prev || Date.parse(r.created_at) > Date.parse(prev.created_at)) latest.set(key, r);
  }
  return [...latest.values()]
    .flatMap((r) => r.findings)
    .sort(
      (a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0) || b.confidence - a.confidence,
    );
}
