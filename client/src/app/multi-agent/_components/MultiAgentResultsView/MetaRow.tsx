/* MetaRow — the PR + totals strip under the results header (SPEC-05, AC-15).
   Totals are the SUM the server already computed (`total_duration_ms` /
   `total_cost_usd`); this only formats them. No "parallel"/"fan-out" copy. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { MultiAgentRun } from "@devdigest/shared";
import { s } from "./styles";

export function MetaRow({ run, prTitle }: { run: MultiAgentRun; prTitle: string | null }) {
  const t = useTranslations("multiAgent");
  const seconds = (run.total_duration_ms / 1000).toFixed(1);
  const cost = `$${(run.total_cost_usd ?? 0).toFixed(2)}`;

  return (
    <div style={s.meta}>
      <span className="mono" style={s.metaNum}>
        #{run.pr_number ?? ""}
      </span>
      {prTitle && <span style={s.metaTitle}>{prTitle}</span>}
      <span style={s.metaRight}>
        <Icon.Cpu size={14} style={{ color: "var(--accent)" }} />
        {t("results.meta", { count: run.agent_count, seconds, cost })}
      </span>
    </div>
  );
}
