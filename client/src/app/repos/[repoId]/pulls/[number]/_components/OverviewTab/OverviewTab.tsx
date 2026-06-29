"use client";

import React from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("brief");
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
              agentName={latestReview.agent_name}
            />
          )}
          <div style={s.briefGrid}>
            <div style={s.cell}>
              <IntentCard prId={prId} />
            </div>
            <div style={s.rightCol}>
              <BlastRadius prId={prId} repoFullName={repoFullName} />
              <PriorPrs prId={prId} repoFullName={repoFullName} />
            </div>
          </div>
        </div>
      </section>

      {/* RisksCard remains here in P1 only; removed in P3 */}
      <RisksCard prId={prId} />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
