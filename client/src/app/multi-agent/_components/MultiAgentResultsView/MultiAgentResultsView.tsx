/* MultiAgentResultsView — the /multi-agent/runs/:runId results page (SPEC-05,
   AC-15..37). Reads the persisted (and possibly still-running) `MultiAgentRun`,
   renders the Columns/Tabs switch, MetaRow totals (SUM), the selected view, and
   the "Where agents disagree" section — but only once ≥2 agents have actually
   reviewed (the reviewed set = columns with status 'done', AC-30/AC-34). Live
   per-agent status arrives via `useMultiAgentRun`'s self-clearing poll (AC-31).
   "View trace" (AC-32) reuses the existing RunTraceDrawer — a deliberate
   cross-feature reuse per the spec ("RunTraceDrawer … is ready"). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState, EmptyState, type Crumb } from "@devdigest/ui";
import type { AgentColumn, AgentColumnFinding } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { usePullDetail } from "@/lib/hooks/core";
import { usePathShas } from "@/lib/hooks/use-path-shas";
import { useActiveRepo } from "@/lib/repo-context";
import { githubPrFileUrl } from "@/lib/github-urls";
import { RunTraceDrawer } from "@/components/RunTraceDrawer";
import { ColumnsView } from "../ColumnsView";
import { TabsView } from "../TabsView";
import { ConflictsSection } from "../ConflictsSection";
import { ResultsHeader, type ResultsView } from "./ResultsHeader";
import { MetaRow } from "./MetaRow";
import { s } from "./styles";

export function MultiAgentResultsView({ runId }: { runId: string }) {
  const t = useTranslations("multiAgent");
  const { data: run, isLoading, isError, refetch } = useMultiAgentRun(runId);
  const pr = usePullDetail(run?.pr_id);
  // This page isn't nested under /repos/:repoId, so the "active" (sidebar-selected)
  // repo may not be the one that owns this PR — resolve the real owner from the PR
  // itself (repo_id) against the full repos list instead.
  const { repos } = useActiveRepo();
  const repoId = pr.data?.repo_id ?? null;
  const repoFullName = repos.find((r) => r.id === repoId)?.full_name ?? null;
  const [view, setView] = React.useState<ResultsView>("columns");
  const [traceCol, setTraceCol] = React.useState<AgentColumn | null>(null);

  // SHA-256 of every finding's path, for the GitHub "Files changed" diff anchor
  // (`githubPrFileUrl`) — resolves async, so file links upgrade to the precise
  // anchor once available and fall back to the bare `/files` URL until then.
  const allFiles = React.useMemo(
    () => (run?.columns ?? []).flatMap((c) => c.findings.map((f) => f.file)),
    [run],
  );
  const pathShas = usePathShas(allFiles);
  const prNumber = run?.pr_number ?? null;

  // Clicking a finding → its card on the PR overview's Agent runs tab (same
  // `#finding-<id>` deep link the PR list's findings hover card uses).
  const findingHref = React.useCallback(
    (f: AgentColumnFinding) =>
      repoId != null && prNumber != null
        ? `/repos/${repoId}/pulls/${prNumber}?tab=findings#finding-${f.id}`
        : undefined,
    [repoId, prNumber],
  );
  // Clicking the file:line → the real file inside the PR's "Files changed" diff on GitHub.
  const fileHref = React.useCallback(
    (f: AgentColumnFinding) =>
      repoFullName && prNumber != null
        ? githubPrFileUrl(repoFullName, prNumber, f.file, f.start_line, undefined, pathShas[f.file])
        : undefined,
    [repoFullName, prNumber, pathShas],
  );

  const baseCrumb: Crumb[] = [{ label: t("results.crumb") }];

  if (isLoading) {
    return (
      <AppShell crumb={baseCrumb}>
        <div style={s.page}>
          <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={28} width={280} />
            <Skeleton height={120} />
          </div>
        </div>
      </AppShell>
    );
  }

  if (isError || !run) {
    return (
      <AppShell crumb={baseCrumb}>
        <div style={{ padding: 28 }}>
          <ErrorState onRetry={() => void refetch()} />
        </div>
      </AppShell>
    );
  }

  const runCrumb: Crumb[] = [{ label: t("results.crumb") }, { label: `#${run.pr_number ?? ""}` }];

  // No-agents run (AC-18) — nothing to fan out.
  if (run.columns.length === 0) {
    return (
      <AppShell crumb={runCrumb}>
        <div style={{ padding: "48px 28px" }}>
          <EmptyState
            icon="Cpu"
            title={t("results.noAgents.title")}
            body={t("results.noAgents.body")}
            cta={t("results.noAgents.cta")}
            onCta={() => {
              window.location.href = "/multi-agent";
            }}
          />
        </div>
      </AppShell>
    );
  }

  const columns = run.columns;
  // Reviewed set = agents that actually completed a review (AC-30/AC-34): the
  // disagreement section is gated on this, not on the dispatched column count.
  const reviewedCount = columns.filter((c) => c.status === "done").length;
  const configureHref = `/multi-agent?pr=${encodeURIComponent(run.pr_id)}&agents=${columns
    .map((c) => c.agent_id)
    .join(",")}`;

  return (
    <AppShell crumb={runCrumb}>
      <div style={s.page}>
        <ResultsHeader
          agentCount={columns.length}
          view={view}
          onViewChange={setView}
          configureHref={configureHref}
        />
        <MetaRow run={run} prTitle={pr.data?.title ?? null} />
        <div style={s.body}>
          {view === "columns" ? (
            <ColumnsView
              columns={columns}
              onViewTrace={setTraceCol}
              findingHref={findingHref}
              fileHref={fileHref}
            />
          ) : (
            <TabsView columns={columns} prId={run.pr_id} onViewTrace={setTraceCol} />
          )}
          {reviewedCount >= 2 && (
            <ConflictsSection conflicts={run.conflicts} reviewedAgentCount={reviewedCount} />
          )}
        </div>
      </div>
      {traceCol && (
        <RunTraceDrawer
          runId={traceCol.run_id}
          agentName={traceCol.agent_name}
          prNumber={run.pr_number ?? null}
          running={traceCol.status === "running"}
          onClose={() => setTraceCol(null)}
        />
      )}
    </AppShell>
  );
}
