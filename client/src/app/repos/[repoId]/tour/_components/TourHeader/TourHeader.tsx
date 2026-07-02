/* TourHeader — SPEC-02 AC-14/18/22: "Onboarding for {repo}" (repo in mono), a
   provenance subline ("Generated from index of N files - last refreshed
   {time}", derived from the real `provenance`/`generatedAt` — never
   fabricated, §Non-functional), and top-right Regenerate + Share link
   controls plus the total-cost chip (T11). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { TourProvenance, TourSection } from "@devdigest/shared";
import { TotalCostChip } from "../CostPanel";
import { copyShareLink } from "../affordances";
import { formatRefreshedAt } from "./format";
import { s } from "./styles";

export function TourHeader({
  repoId,
  repoName,
  provenance,
  generatedAt,
  sections,
  regenerating,
  onRegenerate,
}: {
  repoId: string;
  repoName: string;
  provenance: TourProvenance;
  generatedAt: string;
  sections: TourSection[];
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  const t = useTranslations("tour");

  return (
    <div style={s.wrap}>
      <div>
        <h1 style={s.title}>
          {t.rich("header.title", {
            repo: repoName,
            mono: (chunks) => <span className="mono">{chunks}</span>,
          })}
        </h1>
        <p style={s.subline}>
          {t("header.provenance", { count: provenance.fileCount, time: formatRefreshedAt(generatedAt) })}
        </p>
      </div>
      <div style={s.actions}>
        <TotalCostChip sections={sections} />
        <Button kind="secondary" icon="ExternalLink" onClick={() => copyShareLink(repoId)}>
          {t("header.shareLink")}
        </Button>
        <Button kind="primary" icon="RefreshCw" loading={regenerating} onClick={onRegenerate}>
          {regenerating ? t("header.regenerating") : t("header.regenerate")}
        </Button>
      </div>
    </div>
  );
}
