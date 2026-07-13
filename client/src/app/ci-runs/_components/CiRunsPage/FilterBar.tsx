"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SelectInput } from "@devdigest/ui";
import type { Agent, CiRunStatus, Repo } from "@devdigest/shared";
import { CI_STATUS_META, DATE_RANGE_OPTIONS, SOURCE_OPTIONS, STATUS_OPTIONS, type DateRangeKey } from "./constants";
import { s } from "./styles";

/**
 * The CI Runs filter row (AC-36): date range, agent, repo, status, source.
 * Mirrors the PR list's `FilterBar` pattern (mirrors `../../pulls/_components/
 * FilterBar`), but uses real `<select>`s (`SelectInput`) rather than toggle
 * chips — `CiRun` carries no `repo` field to narrow client-side (the studio's
 * only join from a run to its repo lives server-side via the installation),
 * so every filter here is threaded into `useCiRuns(filters)` as a query param
 * (the hook `lib/hooks/ci.ts` was built for exactly this — AC-36's JSDoc).
 */
export function FilterBar({
  dateRange,
  onDateRange,
  agentId,
  onAgentId,
  repo,
  onRepo,
  status,
  onStatus,
  source,
  onSource,
  agents,
  repos,
}: {
  dateRange: DateRangeKey;
  onDateRange: (v: DateRangeKey) => void;
  agentId: string;
  onAgentId: (v: string) => void;
  repo: string;
  onRepo: (v: string) => void;
  status: CiRunStatus | "";
  onStatus: (v: CiRunStatus | "") => void;
  source: "local" | "ci" | "";
  onSource: (v: "local" | "ci" | "") => void;
  agents: Agent[];
  repos: Repo[];
}) {
  const t = useTranslations("ci");

  const dateOptions = DATE_RANGE_OPTIONS.map((o) => ({
    value: o.value,
    label: t(`runs.filters.${o.labelKey}`),
  }));
  const agentOptions = [
    { value: "", label: t("runs.filters.allAgents") },
    ...agents.map((a) => ({ value: a.id, label: a.name })),
  ];
  const repoOptions = [
    { value: "", label: t("runs.filters.allRepos") },
    ...repos.map((r) => ({ value: r.full_name, label: r.full_name })),
  ];
  const statusOptions = [
    { value: "", label: t("runs.filters.allStatuses") },
    ...STATUS_OPTIONS.map((st) => ({ value: st, label: t(`runs.status.${CI_STATUS_META[st].labelKey}`) })),
  ];
  const sourceOptions = [
    { value: "", label: t("runs.filters.allSources") },
    ...SOURCE_OPTIONS.map((src) => ({ value: src, label: src })),
  ];

  return (
    <div style={s.filterBar}>
      <div style={s.filterItem}>
        <SelectInput value={dateRange} onChange={(v) => onDateRange(v as DateRangeKey)} options={dateOptions} mono={false} />
      </div>
      <div style={s.filterItem}>
        <SelectInput value={agentId} onChange={onAgentId} options={agentOptions} mono={false} />
      </div>
      <div style={s.filterItem}>
        <SelectInput value={repo} onChange={onRepo} options={repoOptions} mono={false} />
      </div>
      <div style={s.filterItem}>
        <SelectInput value={status} onChange={(v) => onStatus(v as CiRunStatus | "")} options={statusOptions} mono={false} />
      </div>
      <div style={s.filterItem}>
        <SelectInput value={source} onChange={(v) => onSource(v as "local" | "ci" | "")} options={sourceOptions} mono={false} />
      </div>
    </div>
  );
}
