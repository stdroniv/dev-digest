/* Agent → Stats tab (SPEC-05 T12, AC-42). A minimal run-history table sourced
   from `useAgentRuns` — the agent's local AND ingested-CI runs, mirroring the
   PR-scoped `RunHistory` component's data (repos/[repoId]/pulls/[number]/
   _components/RunHistory) but as the design's compact grid table, with a
   Source column badging each row local/CI so CI runs show up alongside local
   ones in the agent's existing history (not just the separate CI Runs page). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, SectionLabel, Skeleton } from "@devdigest/ui";
import type { Agent, RunSummary } from "@devdigest/shared";
import { useAgentRuns } from "@/lib/hooks/ci";
import { formatUsd } from "@/lib/cost";
import { s } from "./styles";

function RunRow({
  run,
  last,
  t,
}: {
  run: RunSummary;
  last: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const tokens = (run.tokens_in ?? 0) + (run.tokens_out ?? 0);
  const isCi = run.source === "ci";
  return (
    <div style={s.row(last)}>
      <span className="mono" style={s.timestamp}>
        {run.ran_at ? new Date(run.ran_at).toLocaleString() : "—"}
      </span>
      <span className="mono tnum">{tokens > 0 ? tokens.toLocaleString() : "—"}</span>
      <span className="mono tnum">{formatUsd(run.cost_usd)}</span>
      <span className="tnum">{run.findings_count ?? "—"}</span>
      <div>
        <Badge color={isCi ? "var(--warn)" : "var(--text-secondary)"} bg={isCi ? "var(--warn-bg)" : undefined}>
          {isCi ? t("stats.sourceLabel.ci") : t("stats.sourceLabel.local")}
        </Badge>
      </div>
    </div>
  );
}

export function StatsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { data: runs, isLoading } = useAgentRuns(agent.id);

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 760 }}>
        <Skeleton height={20} width={140} />
        <Skeleton height={160} />
      </div>
    );
  }

  if (!runs || runs.length === 0) {
    return <EmptyState icon="History" title={t("stats.emptyTitle")} body={t("stats.emptyBody")} />;
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <SectionLabel icon="History">{t("stats.runHistory")}</SectionLabel>
      <div style={s.table}>
        <div style={s.headerRow}>
          <span>{t("stats.table.timestamp")}</span>
          <span>{t("stats.table.tokens")}</span>
          <span>{t("stats.table.cost")}</span>
          <span>{t("stats.table.findings")}</span>
          <span>{t("stats.table.source")}</span>
        </div>
        {runs.map((r, i) => (
          <RunRow key={r.run_id} run={r} last={i === runs.length - 1} t={t} />
        ))}
      </div>
    </div>
  );
}
