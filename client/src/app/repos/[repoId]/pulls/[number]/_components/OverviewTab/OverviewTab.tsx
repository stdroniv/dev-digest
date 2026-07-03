"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { BlastRadius } from "../BlastRadius";
import { PriorPrs } from "../PriorPrs";
import { ReviewFocus } from "../ReviewFocus";
import { VerdictBanner } from "../VerdictBanner";
import { useWhyRiskBrief, useGenerateWhyRiskBrief } from "@/lib/hooks/brief";
import { s } from "./styles";
import type { ReviewRecord, RunSummary } from "@devdigest/shared";
import type { Verdict } from "@devdigest/shared";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null | undefined;
  repoFullName: string | null | undefined;
  latestReview: ReviewRecord | null;
  /** The run behind `latestReview` (joined on run_id) — supplies cost/token stats. */
  latestRun?: RunSummary | null;
  prNumber: number;
}

export function OverviewTab({ prBody, prId, repoFullName, latestReview, latestRun, prNumber }: OverviewTabProps) {
  const t = useTranslations("brief");
  const { data: brief, isLoading: briefLoading } = useWhyRiskBrief(prId);
  const regenerate = useGenerateWhyRiskBrief(prId);

  // WHEN a brief is ready, its what/why replaces the review summary as the
  // header prose (AC-2); while no brief exists (or the query is loading),
  // headerBrief stays null so VerdictBanner falls back to `summary` (AC-19b).
  const headerBrief =
    brief?.status === "ready"
      ? {
          what: brief.brief.what,
          why: brief.brief.why,
          stale: brief.stale,
          docsTruncated: brief.docs_truncated,
        }
      : null;

  return (
    <>
      <section>
        <SectionLabel icon="FileText">{t("prBrief")}</SectionLabel>
        <div style={s.briefBody}>
          {latestReview?.verdict && (
            <VerdictBanner
              verdict={latestReview.verdict as Verdict}
              summary={latestReview.summary}
              score={latestReview.score}
              findingsCount={latestReview.findings.length}
              blockers={latestReview.findings.filter(
                (f) => f.severity === "CRITICAL" && !f.dismissed_at,
              ).length}
              brief={headerBrief}
              costUsd={latestRun?.cost_usd ?? null}
              tokensIn={latestRun?.tokens_in ?? null}
              tokensOut={latestRun?.tokens_out ?? null}
              onRegenerate={headerBrief ? () => regenerate.mutate() : undefined}
              regenerating={regenerate.isPending}
            />
          )}
          <div style={s.briefGrid}>
            <div style={s.cell}>
              <IntentCard prId={prId} repoFullName={repoFullName} prNumber={prNumber} />
            </div>
            <div style={s.rightCol}>
              <BlastRadius prId={prId} repoFullName={repoFullName} />
              <PriorPrs prId={prId} repoFullName={repoFullName} />
            </div>
          </div>
        </div>
      </section>

      {/* Review focus is its own full-width row (like PR Brief / Description),
          not nested in the Blast Radius column. */}
      {prId && Number.isFinite(prNumber) && (
        <ReviewFocus
          state={brief}
          isLoading={briefLoading}
          prId={prId}
          repoFullName={repoFullName}
          prNumber={prNumber}
        />
      )}

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
