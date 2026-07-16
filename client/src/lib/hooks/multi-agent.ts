/* hooks/multi-agent.ts — React Query hooks for the Multi-Agent Review feature
   (SPEC-05): pre-launch estimates, launching a fan-out run, and reading back
   the persisted `MultiAgentRun` (columns + disagreement grouping). Live
   per-agent status reuses the existing `useRunEvents` (see `./reviews.ts`) —
   this file adds no new SSE stream. Learn/eval-case actions on a finding are
   also here except eval-case, which reuses `useCreateCaseFromFinding` from
   `./evals.ts` (an eval-case hook already existed — see that file). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { MultiAgentRun, MultiAgentRunRequest } from "@devdigest/shared";

// ---- Pre-launch estimates (AC-11..13) ----

/** One agent's aggregated past-run stats, as returned by
 *  `GET /multi-agent/estimates`. No vendored contract for this shape (T5's
 *  route is batched/read-only and not part of the persisted `MultiAgentRun`
 *  contract) — defined here for hooks + their consumers to share. */
export interface EstimateRow {
  agent_id: string;
  agent_name: string;
  avg_latency_ms: number | null;
  avg_cost_usd: number | null;
  runs: number;
}

/** Per-agent time/cost guideline for every enabled agent in the workspace —
 *  `runs: 0` (⇒ `avg_latency_ms`/`avg_cost_usd` null) means "no history"
 *  (AC-12); callers exclude that agent from the summed total (AC-13). */
export function useAgentEstimates() {
  return useQuery({
    queryKey: ["agent-estimates"],
    queryFn: () => api.get<{ estimates: EstimateRow[] }>("/multi-agent/estimates"),
  });
}

// ---- Launch a multi-agent run (AC-5, AC-10) ----

export interface LaunchMultiAgentRunInput {
  prId: string;
  agentIds: string[];
}

/** Response of `POST /pulls/:id/multi-agent-run` — the run is dispatched
 *  non-blocking; poll `useMultiAgentRun(run_id)` for progress. */
export interface LaunchMultiAgentRunResult {
  run_id: string;
  pr_id: string;
}

/** Launch a fan-out review over the selected agent set. On success, the
 *  individual agent runs also land in the PR's normal run history (AC-38),
 *  so invalidate `["pr-runs", prId]` to refresh it without a reload. */
export function useLaunchMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: LaunchMultiAgentRunInput) => {
      const body: MultiAgentRunRequest = { agent_ids: agentIds };
      return api.post<LaunchMultiAgentRunResult>(`/pulls/${prId}/multi-agent-run`, body);
    },
    onSuccess: (_data, { prId }) => {
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
    },
  });
}

// ---- Read a multi-agent run (AC-15..30, AC-36..37) ----

/** The persisted (and possibly still-in-progress) multi-agent run: columns,
 *  totals (server-summed), and the "Where agents disagree" grouping. Polls
 *  every 4s while any column is `running`, mirroring `usePrRuns`'s
 *  self-clearing poll (`./reviews.ts`) — stops automatically once every
 *  column has settled to `done`/`failed`. */
export function useMultiAgentRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", runId],
    queryFn: () => api.get<MultiAgentRun>(`/multi-agent-runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (query) =>
      (query.state.data?.columns ?? []).some((c) => c.status === "running") ? 4000 : false,
  });
}

// ---- Finding actions this feature adds (AC-25) ----

/** Response of `POST /findings/:id/learn`. */
export interface LearnFindingResult {
  memory_id: string;
}

/** Persist a durable memory record seeded from a finding, attributed to the
 *  finding + its producing agent (AC-25). No cache to invalidate today — there
 *  is no client-side memory list view yet. */
export function useLearnFinding() {
  return useMutation({
    mutationFn: (findingId: string) => api.post<LearnFindingResult>(`/findings/${findingId}/learn`),
  });
}

// NOTE — "Turn into eval case" (AC-24) reuses the EXISTING
// `useCreateCaseFromFinding()` from `./evals.ts` (already calls
// `POST /findings/:id/eval-case` and returns `{ case, already_added }`). Do
// not add a second hook for the same route here — see client/INSIGHTS.md on
// duplicate mutation hooks drifting invalidation targets apart.
