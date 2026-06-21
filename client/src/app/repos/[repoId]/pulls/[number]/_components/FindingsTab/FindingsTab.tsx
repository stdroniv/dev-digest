"use client";

import React, { useCallback } from "react";
import { SectionLabel, EmptyState } from "@devdigest/ui";
import { ReviewRunAccordion } from "../ReviewRunAccordion";
import { LiveRunSection } from "./_components/LiveRunSection";
import { LethalTrifectaBanner } from "./_components/LethalTrifectaBanner";
import { TimelineSection } from "./_components/TimelineSection";
import type { FindingRecord, ReviewRecord, RunSummary, PrCommit } from "@devdigest/shared";
import type { UseMutationResult } from "@tanstack/react-query";

interface FindingsTabProps {
  prId: string | null;
  liveRunIds: string[];
  reviewRunning: boolean;
  lethalTrifecta: FindingRecord[];
  runs: ReviewRecord[];
  prRuns: RunSummary[] | undefined;
  prCommits: PrCommit[];
  cancelMutation: UseMutationResult<any, any, string, any>;
  /** owner/repo + PR number — used to deep-link a finding's file:line to the PR diff. */
  repoFullName?: string | null;
  prNumber?: number | null;
  /** From a `#finding-<id>` deep link: open + scroll to this finding's card. */
  focusFindingId?: string | null;
  onOpenTrace: (id: string) => void;
  onDelete: (id: string) => void;
  onRunDone: () => void;
}

export function FindingsTab({
  prId,
  liveRunIds,
  reviewRunning,
  lethalTrifecta,
  runs,
  prRuns,
  prCommits,
  cancelMutation,
  repoFullName,
  prNumber,
  focusFindingId,
  onOpenTrace,
  onDelete,
  onRunDone,
}: FindingsTabProps) {
  const handleOpenTrace = useCallback((id: string) => onOpenTrace(id), [onOpenTrace]);
  const handleDelete = useCallback((id: string) => onDelete(id), [onDelete]);

  // Timeline → Review-runs navigation: clicking an agent name in the timeline
  // opens + scrolls to that run's accordion below. The nonce re-triggers the
  // scroll even when the same run is clicked twice.
  const [target, setTarget] = React.useState<{ runId: string; n: number } | null>(null);
  const handleGoToReview = useCallback((runId: string) => {
    setTarget((p) => ({ runId, n: (p?.n ?? 0) + 1 }));
  }, []);

  // Per-run findings for the timeline's hover popover — already loaded with the
  // reviews below (`runs`), keyed by the run that produced each review. No extra
  // fetch: the timeline reuses the same data the Review-runs accordions render.
  const findingsByRun = React.useMemo(() => {
    const m = new Map<string, FindingRecord[]>();
    for (const review of runs) {
      if (review.run_id) m.set(review.run_id, review.findings);
    }
    return m;
  }, [runs]);

  return (
    <section>
      <LiveRunSection
        liveRunIds={liveRunIds}
        reviewRunning={reviewRunning}
        cancelMutation={cancelMutation}
        onOpenTrace={onOpenTrace}
        onRunDone={onRunDone}
      />

      <LethalTrifectaBanner count={lethalTrifecta.length} />

      <TimelineSection
        runs={prRuns}
        commits={prCommits}
        findingsByRun={findingsByRun}
        onOpenTrace={handleOpenTrace}
        onGoToReview={handleGoToReview}
        onDelete={handleDelete}
      />

      <SectionLabel
        icon="AlertOctagon"
        right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>grouped by run · newest first</span>}
      >
        Review runs
      </SectionLabel>
      {runs.length === 0 ? (
        reviewRunning || liveRunIds.length > 0 ? null : (
          <EmptyState
            icon="Sparkles"
            title="No findings yet"
            body="Run a review to generate findings. Use Run Review ▾ above (run all enabled agents or a specific one)."
          />
        )
      ) : (
        prId &&
        runs.map((review, i) => (
          <ReviewRunAccordion
            key={review.id}
            review={review}
            prId={prId}
            defaultOpen={i === 0}
            repoFullName={repoFullName}
            prNumber={prNumber}
            focusFindingId={focusFindingId}
            targetRunId={target?.runId ?? null}
            targetNonce={target?.n ?? 0}
          />
        ))
      )}
    </section>
  );
}
