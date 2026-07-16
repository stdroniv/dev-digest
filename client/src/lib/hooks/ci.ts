/* hooks/ci.ts — React Query hooks for Export-to-CI + the CI Runs page (SPEC-05).
   Mirrors the evalKeys / evals.ts query-key + fetch-wrapper + invalidation
   pattern; all access goes through `api` (see ../api.ts) — never `fetch`
   directly from a component. Types come from the vendored `eval-ci.ts` /
   `trace.ts` contracts (T1). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CiExport,
  CiExportInputBody,
  CiInstallation,
  CiRun,
  CiRunStatus,
  RunSummary,
} from "@devdigest/shared";

// ---- Query keys ----
export const ciKeys = {
  runs: (filters?: CiRunsFilters) => ["ci-runs", filters ?? {}] as const,
  installations: (agentId: string | null | undefined) => ["ci-installations", agentId] as const,
  agentRuns: (agentId: string | null | undefined) => ["agent-runs", agentId] as const,
};

/** Optional filters for `GET /ci-runs` (AC-36: date range, agent, repo,
 *  status, source). An empty/absent filter set fetches the server's own
 *  bounded window (last N runs / last 7 days per repo, AC-34). */
export interface CiRunsFilters {
  agent_id?: string;
  repo?: string;
  status?: CiRunStatus;
  source?: "local" | "ci";
  since?: string;
}

function ciRunsQuery(filters?: CiRunsFilters): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.agent_id) params.set("agent_id", filters.agent_id);
  if (filters.repo) params.set("repo", filters.repo);
  if (filters.status) params.set("status", filters.status);
  if (filters.source) params.set("source", filters.source);
  if (filters.since) params.set("since", filters.since);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// ===========================================================================
// CI Runs page (AC-35/36)
// ===========================================================================

/** Ingested CI runs. Auto-refreshes like `usePulls` (60s poll + refetch on
 *  window focus) so the page stays live without a manual Refresh. */
export function useCiRuns(filters?: CiRunsFilters) {
  return useQuery({
    queryKey: ciKeys.runs(filters),
    queryFn: () => api.get<CiRun[]>(`/ci-runs${ciRunsQuery(filters)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** On-demand reconcile — pulls Actions run metadata + result artifacts into
 *  the run model, bounded to a recent window (AC-30/34). Called on the CI
 *  Runs page mount and by its Refresh button. */
export function useReconcileCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<unknown>("/ci/reconcile"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ciKeys.runs() });
      qc.invalidateQueries({ queryKey: ["ci-installations"] });
    },
  });
}

// ===========================================================================
// Agent CI tab (AC-38..41) + Stats tab (AC-42)
// ===========================================================================

/** One agent's CI installations — repo, target, derived status, workflow
 *  version, last-run time, and drift (`update_available`). */
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ciKeys.installations(agentId),
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci/installations`),
    enabled: !!agentId,
  });
}

/** Agent-scoped run history — local + CI runs, each carrying `source`
 *  (AC-42, the agent Stats tab). */
export function useAgentRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ciKeys.agentRuns(agentId),
    queryFn: () => api.get<RunSummary[]>(`/agents/${agentId}/runs`),
    enabled: !!agentId,
  });
}

// ===========================================================================
// Export Wizard (AC-1..12)
// ===========================================================================

export interface ExportPreviewInput {
  agentId: string;
  /** Preview only needs enough of `CiExportInput` to render the file tree
   *  (e.g. `repo`/`target`) — every `.default()`-backed field stays optional. */
  input: Partial<CiExportInputBody>;
}

/** Preview step — resolves the file tree + contents without committing
 *  anything (AC-2/3/4/5). */
export function useExportPreview() {
  return useMutation({
    mutationFn: ({ agentId, input }: ExportPreviewInput) =>
      api.post<CiExport>(`/agents/${agentId}/ci/preview`, input),
  });
}

export interface ExportInstallInput {
  agentId: string;
  input: CiExportInputBody;
}

/** Install step — "Open a PR with these files" (idempotent commit+PR,
 *  AC-9/11/12/17). Invalidates this agent's installations (+ the CI Runs
 *  list, since a fresh install can immediately affect the bounded set). */
export function useExportInstall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: ExportInstallInput) =>
      api.post<CiExport>(`/agents/${agentId}/ci/install`, input),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ciKeys.installations(agentId) });
      qc.invalidateQueries({ queryKey: ciKeys.runs() });
    },
  });
}

/** Install step, degraded path — "Copy files as a zip" (AC-10/11), returning
 *  the identical bundle as a `Blob` for client-side download. */
export function useExportZip() {
  return useMutation({
    mutationFn: (agentId: string) => api.getBlob(`/agents/${agentId}/ci/bundle.zip`),
  });
}
