/* Agent Eval Detail (SPEC-04, T17, design 3). Per-agent regression harness:
   agent selector, "Run eval" (AC-9), a delta/alert banner between the two
   most recent runs (AC-14), three metric cards with trend sparklines
   (AC-28), a multi-line "Metric Trend" chart, and the per-agent "Recent
   Runs" table (AC-15) — newest-first, full fields per row, with a
   selection checkbox that opens the T18 CompareRunsModal once exactly two
   rows are selected (AC-16/AC-18). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Dropdown,
  Icon,
  IconBtn,
  Skeleton,
  ErrorState,
  MetricCard,
  LineChart,
  Checkbox,
} from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentEvalDashboard, useAgentEvalRuns, useRunAllEvals } from "@/lib/hooks/evals";
import { formatUsd } from "@/lib/cost";
import { CompareRunsModal } from "../CompareRunsModal";
import { s } from "./styles";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AgentEvalDetail({
  agentId,
  agentName,
  onNavigate,
}: {
  agentId: string;
  agentName?: string | null;
  /** Switch the drill-in view to another agent, or back to the dashboard
   *  list when called with `null`. Owned by the parent EvalDashboard's view
   *  state — this component never navigates on its own. */
  onNavigate?: (agentId: string | null) => void;
}) {
  const t = useTranslations("evals");
  const { data: agents } = useAgents();
  const { data: dashboard, isLoading: dashboardLoading, isError, refetch } = useAgentEvalDashboard(agentId);
  const { data: runs, isLoading: runsLoading } = useAgentEvalRuns(agentId);
  const runAll = useRunAllEvals();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = React.useState(false);

  // Reset selection when the agent changes so a stale pair from a previous
  // agent can't leak into this agent's compare flow.
  React.useEffect(() => {
    setSelected(new Set());
  }, [agentId]);

  const displayName = agentName ?? agents?.find((a) => a.id === agentId)?.name ?? "Agent";
  const runsCount = runs?.length ?? 0;

  const toggleSelected = (runGroupId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(runGroupId);
      else next.delete(runGroupId);
      return next;
    });
  };

  const selectedIds = Array.from(selected);
  const canCompare = selectedIds.length === 2;

  // Chronologically order the two selections (old -> new) regardless of
  // click order, since a run picked SECOND may be the OLDER of the pair.
  const [oldRunGroupId, newRunGroupId] = React.useMemo(() => {
    if (selectedIds.length !== 2 || !runs) return [undefined, undefined] as const;
    const [a, b] = selectedIds;
    const ranAt = (id: string) => runs.find((r) => r.run_group_id === id)?.ran_at ?? "";
    return ranAt(a!) <= ranAt(b!) ? ([a, b] as const) : ([b, a] as const);
  }, [selectedIds, runs]);

  const trendSeries = dashboard
    ? [
        { name: "recall", color: "var(--accent)", data: dashboard.trend.map((p) => p.recall) },
        { name: "precision", color: "var(--ok)", data: dashboard.trend.map((p) => p.precision) },
        { name: "citation_accuracy", color: "var(--warn)", data: dashboard.trend.map((p) => p.citation_accuracy) },
      ]
    : [];

  // Metric-card sparkline data. A single data point makes Sparkline compute
  // `i / (len - 1)` = 0/0 = NaN for its `<circle cx>`, so only feed a trend
  // with ≥2 points; below that the card renders without a sparkline.
  const sparkOf = (key: "recall" | "precision" | "citation_accuracy") => {
    const d = (dashboard?.trend ?? []).map((p) => p[key]);
    return d.length > 1 ? d : undefined;
  };

  const crumb = [
    { label: "Skills Lab" },
    // Drilling in never changes the URL (it's client-side view state owned by
    // EvalDashboard), so an `href` back to "/evals" would be a same-URL no-op.
    { label: t("dashboard.header"), onClick: onNavigate ? () => onNavigate(null) : undefined },
    { label: displayName },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerLeft}>
            {onNavigate && (
              <div style={s.backRow}>
                <IconBtn icon="ChevronLeft" label={t("agentDetail.backToDashboard")} onClick={() => onNavigate(null)} />
              </div>
            )}
            <h1 style={s.h1}>{`${displayName} · Regression harness · ${runsCount} runs on the gold set`}</h1>
          </div>
          <div style={s.headerActions}>
            <Dropdown
              width={220}
              align="right"
              trigger={
                <Button kind="secondary" icon="Cpu">
                  {displayName}
                </Button>
              }
              items={(agents ?? []).map((a) => ({
                label: a.name,
                onClick: () => {
                  if (a.id !== agentId) onNavigate?.(a.id);
                },
              }))}
            />
            <Button
              kind="primary"
              icon="Play"
              onClick={() => runAll.mutate(agentId)}
              disabled={runAll.isPending}
            >
              {runAll.isPending ? t("evalsTab.runningAll") : t("evalsTab.runAllEvals")}
            </Button>
          </div>
        </div>

        {dashboard?.alert && (
          <div style={s.alertBanner}>
            <Icon.AlertTriangle size={15} />
            <span>{dashboard.alert}</span>
          </div>
        )}

        {dashboardLoading ? (
          <div style={s.metricsGrid}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        ) : isError || !dashboard ? (
          <ErrorState title="Couldn't load this agent's eval dashboard" onRetry={() => refetch()} />
        ) : (
          <>
            <div style={s.metricsGrid}>
              <MetricCard
                label={t("metrics.recall")}
                value={`${Math.round(dashboard.current.recall * 100)}`}
                suffix="%"
                delta={dashboard.delta.recall}
                color="var(--accent)"
                trend={sparkOf("recall")}
              />
              <MetricCard
                label={t("metrics.precision")}
                value={`${Math.round(dashboard.current.precision * 100)}`}
                suffix="%"
                delta={dashboard.delta.precision}
                color="var(--ok)"
                trend={sparkOf("precision")}
              />
              <MetricCard
                label={t("metrics.citationAccuracy")}
                value={`${Math.round(dashboard.current.citation_accuracy * 100)}`}
                suffix="%"
                delta={dashboard.delta.citation_accuracy}
                color="var(--warn)"
                trend={sparkOf("citation_accuracy")}
              />
            </div>

            <div style={s.trendSection}>
              <div style={s.sectionHeading}>{t("agentDetail.trendHeading")}</div>
              {trendSeries.some((series) => series.data.length > 1) ? (
                <>
                  <LineChart series={trendSeries} />
                  <div style={s.legend}>
                    <span style={s.legendItem}>
                      <span style={{ ...s.legendDot, background: "var(--accent)" }} />
                      Recall
                    </span>
                    <span style={s.legendItem}>
                      <span style={{ ...s.legendDot, background: "var(--ok)" }} />
                      Precision
                    </span>
                    <span style={s.legendItem}>
                      <span style={{ ...s.legendDot, background: "var(--warn)" }} />
                      Citation accuracy
                    </span>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Not enough runs yet for a trend.</div>
              )}
            </div>
          </>
        )}

        <div>
          <div style={s.runsHeader}>
            <div style={s.sectionHeading}>{t("agentDetail.recentRunsHeading")}</div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                {canCompare
                  ? `${selectedIds.length} selected`
                  : selectedIds.length > 0
                    ? `${selectedIds.length} selected`
                    : t("agentDetail.selectTwoToCompare")}
              </span>
              <Button kind="secondary" disabled={!canCompare} onClick={() => setCompareOpen(true)}>
                {t("agentDetail.compare")}
              </Button>
            </div>
          </div>

          {runsLoading ? (
            <Skeleton height={160} />
          ) : !runs || runs.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noRuns")}</div>
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th} />
                  <th style={s.th}>{t("agentDetail.table.ranAt")}</th>
                  <th style={s.th}>{t("agentDetail.table.version")}</th>
                  <th style={s.th}>{t("agentDetail.table.recall")}</th>
                  <th style={s.th}>{t("agentDetail.table.precision")}</th>
                  <th style={s.th}>{t("agentDetail.table.citation")}</th>
                  <th style={s.th}>{t("agentDetail.table.pass")}</th>
                  <th style={s.th}>{t("agentDetail.table.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.run_group_id}>
                    <td style={s.td}>
                      <Checkbox
                        checked={selected.has(r.run_group_id)}
                        onChange={(v) => toggleSelected(r.run_group_id, v)}
                      />
                    </td>
                    <td style={s.td} className="mono">
                      {formatDateTime(r.ran_at)}
                    </td>
                    <td style={s.td} className="mono">
                      {`v${r.agent_version ?? "—"}`}
                    </td>
                    <td style={s.td} className="mono tnum">
                      {`${Math.round(r.recall * 100)}%`}
                    </td>
                    <td style={s.td} className="mono tnum">
                      {`${Math.round(r.precision * 100)}%`}
                    </td>
                    <td style={s.td} className="mono tnum">
                      {`${Math.round(r.citation_accuracy * 100)}%`}
                    </td>
                    <td style={s.td} className="mono tnum">
                      {`${r.traces_passed}/${r.traces_total}`}
                    </td>
                    <td style={s.td} className="mono tnum">
                      {formatUsd(r.cost_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {compareOpen && canCompare && oldRunGroupId && newRunGroupId && (
        <CompareRunsModal
          agentId={agentId}
          oldRunGroupId={oldRunGroupId}
          newRunGroupId={newRunGroupId}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </AppShell>
  );
}
