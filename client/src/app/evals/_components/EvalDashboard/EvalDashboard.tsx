/* Eval Dashboard (SPEC-04, T17, design 2). Cross-agent regression harness
   landing page: a "Run all agents" action (AC-26), one card per agent (latest
   metrics + pass count + a per-agent sparkline, AC-28), and a cross-agent
   "Recent Eval Runs" table newest-first (AC-17). Selecting an agent card
   drills into AgentEvalDetail (AC-18) via client-side view state — the
   breadcrumb switches from "Eval Dashboard" to "Eval Dashboard › <Agent>". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Skeleton, ErrorState, EmptyState, Sparkline, PercentProgress } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import { useEvalDashboard, useRunAllAgents, useAgentEvalDashboard, type AgentEvalSummary, type RunAllAgentsResult } from "@/lib/hooks/evals";
import { AgentEvalDetail } from "../AgentEvalDetail";
import { s } from "./styles";

function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function Mini({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <span style={s.mini}>
      <span style={s.miniLabel}>{label}</span>
      <span className="tnum" style={{ ...s.miniValue, color }}>
        {value == null ? "—" : pct(value)}
      </span>
    </span>
  );
}

/** One agent as a full-width row (design `AgentEvalOverview`): name + model
 *  badge, last-run line, a recall sparkline, three colour-coded metrics, and a
 *  chevron into the agent's detail. */
function AgentEvalRow({
  summary,
  model,
  onSelect,
}: {
  summary: AgentEvalSummary;
  model: string | null;
  onSelect: () => void;
}) {
  const { data: dashboard } = useAgentEvalDashboard(summary.agent_id);
  const trend = (dashboard?.trend ?? []).map((p) => p.recall);
  // `traces_total` is 0 exactly when the agent has no scored runs yet (its
  // aggregate then derives from an empty record set) — the design's "no runs"
  // row state: em-dash metrics, no sparkline, no last-run line.
  const hasRuns = summary.traces_total > 0;
  return (
    <button type="button" style={s.row} onClick={onSelect}>
      <span style={s.rowIcon}>
        <Icon.Cpu size={17} />
      </span>
      <span style={s.rowMain}>
        <span style={s.rowNameLine}>
          <span style={s.rowName}>{summary.agent_name}</span>
          {model && (
            <span className="mono" style={s.rowModel}>
              {model}
            </span>
          )}
        </span>
        <span style={s.rowSub}>
          {hasRuns
            ? `Last run v${summary.agent_version ?? "—"} · ${formatDate(summary.ran_at)} · ${summary.traces_passed}/${summary.traces_total} pass`
            : "No eval runs yet"}
        </span>
      </span>
      {hasRuns && trend.length > 1 ? (
        <Sparkline data={trend} color="var(--accent)" w={60} h={24} />
      ) : (
        <span style={{ width: 60 }} />
      )}
      <Mini label="RECALL" value={hasRuns ? summary.recall : null} color="var(--accent)" />
      <Mini label="PREC" value={hasRuns ? summary.precision : null} color="var(--ok)" />
      <Mini label="CITE" value={hasRuns ? summary.citation_accuracy : null} color="var(--warn)" />
      <Icon.ChevronRight size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
    </button>
  );
}

export function EvalDashboard() {
  const t = useTranslations("evals");
  const { data, isLoading, isError, refetch } = useEvalDashboard();
  const { data: agents } = useAgents();
  const runAllAgents = useRunAllAgents();
  const [runResults, setRunResults] = React.useState<RunAllAgentsResult[] | null>(null);
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);

  const modelByAgentId = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents ?? []) map.set(a.id, `${a.provider}/${a.model}`);
    return map;
  }, [agents]);

  const selectedAgentName = data?.agents.find((a) => a.agent_id === selectedAgentId)?.agent_name ?? null;

  if (selectedAgentId) {
    return (
      <AgentEvalDetail
        agentId={selectedAgentId}
        agentName={selectedAgentName}
        onNavigate={(id) => setSelectedAgentId(id)}
      />
    );
  }

  const crumb = [{ label: "Skills Lab" }, { label: t("dashboard.header") }];

  const runAll = () => {
    runAllAgents.mutate(undefined, {
      onSuccess: (results) => setRunResults(results),
    });
  };

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <h1 style={s.h1}>{t("dashboard.header")}</h1>
            <div style={s.subtitle}>{t("dashboard.subtitle")}</div>
          </div>
          <Button kind="primary" icon="Play" onClick={runAll} disabled={runAllAgents.isPending}>
            {runAllAgents.isPending ? t("dashboard.runningAllAgents") : t("dashboard.runAllAgents")}
          </Button>
        </div>

        {runResults && (
          <div style={s.runAllResults}>
            {runResults.map((r) => (
              <div key={r.agent_id} style={s.runAllResultRow}>
                {r.ok ? (
                  <Icon.CheckCircle size={14} color="var(--ok)" />
                ) : (
                  <Icon.XCircle size={14} color="var(--crit)" />
                )}
                <span>{r.agent_name}</span>
                {r.ok && r.run ? (
                  <span style={{ color: "var(--text-muted)" }}>
                    {t("dashboard.passCount", { passed: r.run.traces_passed, total: r.run.traces_total })}
                  </span>
                ) : (
                  <span style={{ color: "var(--crit)" }}>{r.error}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {isLoading ? (
          <div style={s.rowsList}>
            <Skeleton height={64} />
            <Skeleton height={64} />
            <Skeleton height={64} />
          </div>
        ) : isError || !data ? (
          <ErrorState title="Couldn't load the eval dashboard" onRetry={() => refetch()} />
        ) : data.agents.length === 0 ? (
          <EmptyState icon="FlaskConical" title={t("evalsTab.casesHeading")} body={t("evalsTab.emptyCases")} />
        ) : (
          <div>
            <div style={s.sectionHeading}>{t("dashboard.agentsHeading")}</div>
            <div style={s.rowsList}>
              {data.agents.map((a) => (
                <AgentEvalRow
                  key={a.agent_id}
                  summary={a}
                  model={modelByAgentId.get(a.agent_id) ?? null}
                  onSelect={() => setSelectedAgentId(a.agent_id)}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <div style={s.sectionHeading}>{`${t("dashboard.recentRunsHeading")} · all agents`}</div>
          {!data || data.recent_runs.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noRuns")}</div>
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>{t("dashboard.table.agent")}</th>
                  <th style={s.th}>{t("agentDetail.table.ranAt")}</th>
                  <th style={s.th}>{t("agentDetail.table.version")}</th>
                  <th style={s.th}>{t("agentDetail.table.recall")}</th>
                  <th style={s.th}>{t("agentDetail.table.precision")}</th>
                  <th style={s.th}>{t("agentDetail.table.citation")}</th>
                  <th style={s.th}>{t("agentDetail.table.pass")}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_runs.map((r) => (
                  <tr key={r.id}>
                    <td style={s.td}>{r.agent_name}</td>
                    <td style={s.td} className="mono">
                      {formatDate(r.ran_at)}
                    </td>
                    <td style={s.td} className="mono">
                      {`v${r.agent_version ?? "—"}`}
                    </td>
                    <td style={{ ...s.td, ...s.metricCell }}>
                      <PercentProgress value={r.recall * 100} color="var(--accent)" />
                    </td>
                    <td style={{ ...s.td, ...s.metricCell }}>
                      <PercentProgress value={r.precision * 100} color="var(--ok)" />
                    </td>
                    <td style={{ ...s.td, ...s.metricCell }}>
                      <PercentProgress value={r.citation_accuracy * 100} color="var(--warn)" />
                    </td>
                    <td style={s.td} className="mono tnum">
                      {`${r.traces_passed}/${r.traces_total}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
