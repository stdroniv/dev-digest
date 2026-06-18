"use client";

import React from "react";
import type { PrMeta } from "@/lib/types";
import { usePrReviews } from "@/lib/hooks/reviews";
import {
  FindingsCounts,
  FindingsHoverCard,
  aggregateLatestPerAgent,
} from "@/components/FindingsCounts";

/**
 * The PR-list FINDINGS cell: the per-severity counters plus a hover card listing
 * the underlying findings. Details are fetched LAZILY (only while the card is
 * open, via `usePrReviews`) so the 60s list refetch stays light; the header
 * total comes from the server-computed `findings_counts`, so it shows instantly
 * and always matches the badge.
 */
export function FindingsCell({ pr }: { pr: PrMeta }) {
  const [active, setActive] = React.useState(false);
  const counts = pr.findings_counts;
  const total = counts ? counts.critical + counts.warning + counts.suggestion : 0;

  // Enable the query only while the card is open (and only for real PRs).
  const prId = active && pr.id ? pr.id : null;
  const reviews = usePrReviews(prId);
  const findings = React.useMemo(
    () => aggregateLatestPerAgent(reviews.data ?? []),
    [reviews.data],
  );

  return (
    <FindingsHoverCard
      total={total}
      findings={findings}
      loading={reviews.isLoading}
      onOpenChange={setActive}
    >
      <FindingsCounts counts={counts} />
    </FindingsHoverCard>
  );
}
