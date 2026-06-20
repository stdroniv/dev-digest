"use client";

import React from "react";
import type { PrMeta } from "@/lib/types";
import type { FindingRecord } from "@devdigest/shared";
import { usePrReviews } from "@/lib/hooks/reviews";
import { usePathShas } from "@/lib/hooks/use-path-shas";
import { useActiveRepo } from "@/lib/repo-context";
import { githubPrFileUrl } from "@/lib/github-urls";
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
export function FindingsCell({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const { activeRepo } = useActiveRepo();
  const repoFullName = activeRepo?.full_name ?? null;
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

  const shas = usePathShas(React.useMemo(() => findings.map((f) => f.file), [findings]));

  // Clicking a finding → its card on the PR detail page (Findings tab, scrolled into view).
  const findingHref = React.useCallback(
    (f: FindingRecord) => `/repos/${repoId}/pulls/${pr.number}?tab=findings#finding-${f.id}`,
    [repoId, pr.number],
  );
  // Clicking the file:line → the file inside the PR's "Files changed" diff on GitHub.
  const fileHref = React.useCallback(
    (f: FindingRecord) =>
      repoFullName
        ? githubPrFileUrl(repoFullName, pr.number, f.file, f.start_line, f.end_line, shas[f.file])
        : undefined,
    [repoFullName, pr.number, shas],
  );

  return (
    <FindingsHoverCard
      total={total}
      findings={findings}
      loading={reviews.isLoading}
      findingHref={findingHref}
      fileHref={fileHref}
      onOpenChange={setActive}
    >
      <FindingsCounts counts={counts} />
    </FindingsHoverCard>
  );
}
