"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { RisksCard } from "../RisksCard";
import { BlastRadius } from "../BlastRadius";
import { PriorPrs } from "../PriorPrs";
import { VerdictBanner } from "../VerdictBanner";
import { s } from "./styles";
import type { ReviewRecord } from "@devdigest/shared";
import type { Verdict } from "@devdigest/shared";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null | undefined;
  repoFullName: string | null | undefined;
  latestReview: ReviewRecord | null;
}

export function OverviewTab({ prBody, prId, repoFullName, latestReview }: OverviewTabProps) {
  return (
    <>
      {latestReview?.verdict && (
        <VerdictBanner
          verdict={latestReview.verdict as Verdict}
          summary={latestReview.summary}
          score={latestReview.score}
          findingsCount={latestReview.findings.length}
          blockers={latestReview.findings.filter(
            (f) => f.severity === "CRITICAL" && !f.dismissed_at,
          ).length}
          agentName={latestReview.agent_name}
        />
      )}
      <IntentCard prId={prId} />
      <RisksCard prId={prId} />
      <BlastRadius prId={prId} repoFullName={repoFullName} />
      <PriorPrs prId={prId} repoFullName={repoFullName} />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
