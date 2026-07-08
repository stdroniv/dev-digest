/* Agent → Evals tab (SPEC-04, T15). Lists every eval case owned by this agent
   (name, expectation summary, severity·category or "empty []", last-run
   status), shows the agent's current aggregate metrics + delta vs the
   previous run, and exposes "Run all evals" + per-case run/edit/delete. The
   case-editor modal (author / edit / delete, JSON validation) is T16's
   `CaseEditorModal`, opened from here. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, IconBtn, Icon, Skeleton, EmptyState, MetricCard } from "@devdigest/ui";
import type { Agent, EvalCase } from "@devdigest/shared";
import type { EvalExpectedFinding } from "@devdigest/shared";
import {
  useAgentEvalCases,
  useAgentEvalDashboard,
  useRunAllEvals,
  useRunSingleCase,
  useDeleteCase,
} from "@/lib/hooks/evals";
import { CaseEditorModal } from "./_components/CaseEditorModal";
import { s } from "./styles";

type CaseStatus = "passed" | "failed" | "neverRun";

/** `expected_output` is `unknown` on the wire — parse defensively to an array. */
function asExpectedFindings(expected: unknown): EvalExpectedFinding[] {
  return Array.isArray(expected) ? (expected as EvalExpectedFinding[]) : [];
}

/** Latest recorded pass/fail per case, derived from the dashboard's
    newest-first `recent_runs` (first occurrence per case_id wins). */
function latestStatusByCase(recentRuns: { case_id: string; pass: boolean | null }[] | undefined) {
  const map = new Map<string, boolean | null>();
  for (const run of recentRuns ?? []) {
    if (!map.has(run.case_id)) map.set(run.case_id, run.pass);
  }
  return map;
}

function statusOf(pass: boolean | null | undefined): CaseStatus {
  if (pass === true) return "passed";
  if (pass === false) return "failed";
  return "neverRun";
}

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("evals");
  const { data: cases, isLoading: casesLoading } = useAgentEvalCases(agent.id);
  const { data: dashboard } = useAgentEvalDashboard(agent.id);
  const runAll = useRunAllEvals();
  const runOne = useRunSingleCase();
  const del = useDeleteCase();

  const [runningCaseId, setRunningCaseId] = React.useState<string | null>(null);
  const [modal, setModal] = React.useState<{ mode: "new" | "edit"; evalCase: EvalCase | null } | null>(null);

  const statusByCase = latestStatusByCase(dashboard?.recent_runs);
  const lastRunByCase = React.useMemo(() => {
    const map = new Map<string, (typeof dashboard extends undefined ? never : NonNullable<typeof dashboard>["recent_runs"][number])>();
    for (const run of dashboard?.recent_runs ?? []) {
      if (!map.has(run.case_id)) map.set(run.case_id, run);
    }
    return map;
  }, [dashboard]);

  const passingCount = (cases ?? []).filter((c) => statusOf(statusByCase.get(c.id)) === "passed").length;
  const totalCount = (cases ?? []).length;

  const runCase = (caseId: string) => {
    setRunningCaseId(caseId);
    runOne.mutate(
      { caseId, agentId: agent.id },
      { onSettled: () => setRunningCaseId(null) },
    );
  };

  const deleteCase = (evalCase: EvalCase) => {
    if (window.confirm(`Delete eval case "${evalCase.name}"? This cannot be undone.`)) {
      del.mutate({ id: evalCase.id, agentId: agent.id });
    }
  };

  const metricCards: { key: "recall" | "precision" | "citation_accuracy"; label: string }[] = [
    { key: "recall", label: t("metrics.recall") },
    { key: "precision", label: t("metrics.precision") },
    { key: "citation_accuracy", label: t("metrics.citationAccuracy") },
  ];

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h2 style={s.h2}>{t("evalsTab.heading")}</h2>
          <div style={s.subtitle}>{t("evalsTab.metricsSubtitle")}</div>
        </div>
        <Link href="/evals" style={s.dashboardLink}>
          {t("evalsTab.viewFullDashboard")}
        </Link>
      </div>

      <div style={s.metricsGrid}>
        {metricCards.map((m) => (
          <MetricCard
            key={m.key}
            label={m.label}
            value={dashboard ? Math.round(dashboard.current[m.key] * 100) : "—"}
            suffix={dashboard ? "%" : undefined}
            delta={dashboard ? dashboard.delta[m.key] : undefined}
          />
        ))}
        <MetricCard
          label={t("metrics.tracesPassed")}
          value={dashboard ? `${dashboard.current.traces_passed}/${dashboard.current.traces_total}` : "—"}
        />
      </div>

      <div>
        <div style={s.casesHeader}>
          <span style={s.casesTitle}>{t("evalsTab.casesHeading")}</span>
          {totalCount > 0 && <Badge>{t("dashboard.passCount", { passed: passingCount, total: totalCount })}</Badge>}
          <div style={s.casesActions}>
            <Button
              kind="secondary"
              icon="Play"
              onClick={() => runAll.mutate(agent.id)}
              disabled={runAll.isPending || totalCount === 0}
            >
              {runAll.isPending ? t("evalsTab.runningAll") : t("evalsTab.runAllEvals")}
            </Button>
            <Button kind="primary" icon="Plus" onClick={() => setModal({ mode: "new", evalCase: null })}>
              {t("evalsTab.newEvalCase")}
            </Button>
          </div>
        </div>

        {casesLoading ? (
          <div style={s.list}>
            <Skeleton height={48} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : !cases || cases.length === 0 ? (
          <EmptyState
            icon="FlaskConical"
            title={t("evalsTab.casesHeading")}
            body={t("evalsTab.emptyCases")}
            cta={t("evalsTab.newEvalCase")}
            onCta={() => setModal({ mode: "new", evalCase: null })}
          />
        ) : (
          <div style={s.list}>
            {cases.map((c) => {
              const expected = asExpectedFindings(c.expected_output);
              const status = statusOf(statusByCase.get(c.id));
              const first = expected[0];
              return (
                <div key={c.id} style={s.row}>
                  <div style={s.rowMain}>
                    <span style={s.rowName}>{c.name}</span>
                    <div style={s.rowSummary}>
                      {expected.length === 0 ? (
                        <Badge>{t("evalsTab.expectedEmpty")}</Badge>
                      ) : (
                        <>
                          <span>{t("evalsTab.expectedFindings", { count: expected.length })}</span>
                          {first && (first.severity || first.category) && (
                            <Badge>
                              {[first.severity, first.category].filter(Boolean).join(" · ")}
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <span style={s.rowStatus}>
                    {status === "passed" && <Icon.CheckCircle size={14} color="var(--ok)" />}
                    {status === "failed" && <Icon.XCircle size={14} color="var(--crit)" />}
                    {status === "neverRun" && <Icon.Clock size={14} />}
                    {t(`evalsTab.status.${status === "neverRun" ? "neverRun" : status}`)}
                  </span>
                  <div style={s.rowActions}>
                    <IconBtn
                      icon="Play"
                      label={t("evalsTab.runCase")}
                      onClick={() => runCase(c.id)}
                      active={runningCaseId === c.id}
                    />
                    <IconBtn
                      icon="Edit"
                      label={t("evalsTab.edit")}
                      onClick={() => setModal({ mode: "edit", evalCase: c })}
                    />
                    <IconBtn icon="Trash" label={t("evalsTab.delete")} onClick={() => deleteCase(c)} danger />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modal && (
        <CaseEditorModal
          mode={modal.mode}
          agentId={agent.id}
          evalCase={modal.evalCase}
          lastRun={modal.evalCase ? lastRunByCase.get(modal.evalCase.id) ?? null : null}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
