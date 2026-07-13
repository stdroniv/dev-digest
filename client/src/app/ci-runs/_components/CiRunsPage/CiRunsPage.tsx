"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { CiRunStatus } from "@devdigest/shared";
import { useAgents, useCiRuns, useReconcileCiRuns, useRepos } from "@/lib/hooks";
import type { CiRunsFilters } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { SKELETON_ROWS, type DateRangeKey } from "./constants";
import { sinceFor } from "./helpers";
import { s } from "./styles";
import { FilterBar } from "./FilterBar";
import { CiRunsTable } from "./CiRunsTable";

/**
 * CI Runs page (N13, SPEC-05): header + auto-refresh indicator + Refresh,
 * filters (AC-36), and the ingested-runs table (AC-35) / empty (AC-37) /
 * loading / error states. Mounted by `app/ci-runs/page.tsx` inside the
 * existing `AppShell`.
 */
export function CiRunsPage() {
  const t = useTranslations("ci");
  const router = useRouter();

  const [dateRange, setDateRange] = React.useState<DateRangeKey>("7d");
  const [agentId, setAgentId] = React.useState("");
  const [repo, setRepo] = React.useState("");
  const [status, setStatus] = React.useState<CiRunStatus | "">("");
  const [source, setSource] = React.useState<"local" | "ci" | "">("");

  // Memoized so `since` (and the `filters` object identity) only change when
  // a real filter input changes — NOT on every render. `since` has
  // millisecond precision; computing it inline in the render body produced a
  // fresh value (hence a fresh `filters` object, hence a fresh
  // `useCiRuns` query key) on every render, including the re-render caused
  // by the query's own fetch settling — an unbounded refetch loop that
  // exhausted the server's global rate limiter (see e2e/INSIGHTS.md).
  const since = React.useMemo(() => sinceFor(dateRange), [dateRange]);

  const filters: CiRunsFilters = React.useMemo(
    () => ({
      agent_id: agentId || undefined,
      repo: repo || undefined,
      status: status || undefined,
      source: source || undefined,
      since,
    }),
    [agentId, repo, status, source, since],
  );

  const { data: runs, isLoading, isError, error, refetch } = useCiRuns(filters);
  const { data: agents } = useAgents();
  const { data: repos } = useRepos();
  const reconcile = useReconcileCiRuns();

  // AC-34: reconcile on page view (mount)…
  React.useEffect(() => {
    reconcile.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // …and on manual Refresh; the mutation's own onSuccess invalidates the
  // ci-runs cache, so the active `useCiRuns` query above refetches itself.
  const onRefresh = () => reconcile.mutate();

  return (
    <div>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>{t("runs.title")}</h1>
          <p style={s.pageSubtitle}>{t("runs.subtitle")}</p>
        </div>
        <div style={s.headerActions}>
          <span style={s.autoRefresh}>
            <span style={s.autoRefreshDot} />
            {t("runs.autoRefresh")}
          </span>
          <Button kind="secondary" size="sm" icon="RefreshCw" onClick={onRefresh} loading={reconcile.isPending}>
            {reconcile.isPending ? t("runs.refreshing") : t("runs.refresh")}
          </Button>
        </div>
      </div>

      <FilterBar
        dateRange={dateRange}
        onDateRange={setDateRange}
        agentId={agentId}
        onAgentId={setAgentId}
        repo={repo}
        onRepo={setRepo}
        status={status}
        onStatus={setStatus}
        source={source}
        onSource={setSource}
        agents={agents ?? []}
        repos={repos ?? []}
      />

      <div style={s.tableCard}>
        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={28} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("runs.errorTitle")}
            body={error instanceof ApiError ? error.message : t("runs.errorBody")}
            onRetry={() => refetch()}
          />
        ) : !runs || runs.length === 0 ? (
          <EmptyState
            icon="Workflow"
            title={t("runs.emptyTitle")}
            body={t("runs.emptyBody")}
            cta={t("runs.emptyCta")}
            onCta={() => router.push("/agents")}
          />
        ) : (
          <CiRunsTable runs={runs} />
        )}
      </div>
    </div>
  );
}
