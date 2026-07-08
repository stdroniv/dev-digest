/* hooks/evals.ts — React Query hooks for the L06 Eval Pipeline (agent eval cases,
   runs, dashboard, comparison, promotion). Mirrors the agents.ts / reviews.ts
   query-key + fetch-wrapper + invalidation pattern; all access goes through
   `api` (see ../api.ts) — never `fetch` directly from a component. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Agent,
  EvalCase,
  EvalComparison,
  EvalDashboard,
  EvalRunGroup,
  EvalRunRecord,
} from "@devdigest/shared";

// ---- Query keys ----
export const evalKeys = {
  cases: (agentId: string | null | undefined) => ["agent-eval-cases", agentId] as const,
  runs: (agentId: string | null | undefined) => ["eval-runs", agentId] as const,
  agentDashboard: (agentId: string | null | undefined) => ["agent-eval-dashboard", agentId] as const,
  dashboard: () => ["eval-dashboard"] as const,
};

// ===========================================================================
// Cases
// ===========================================================================

/** Every eval case owned by an agent (AC-6). */
export function useAgentEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.cases(agentId),
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/** Server response of `POST /findings/:id/eval-case` — 201 on first create, 200
 *  when the finding already has a case (idempotent, AC-5): `already_added` is
 *  the real cross-session signal (not a client-only session guard). */
export interface CreateCaseFromFindingResult {
  case: EvalCase;
  already_added: boolean;
}

/** Turn an accepted/dismissed finding into a frozen eval case (AC-1..AC-5). */
export function useCreateCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<CreateCaseFromFindingResult>(`/findings/${findingId}/eval-case`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: evalKeys.cases(data.case.owner_id) });
      qc.invalidateQueries({ queryKey: evalKeys.agentDashboard(data.case.owner_id) });
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
    },
  });
}

/** Author a brand-new eval case from scratch (AC-22). Owner is resolved from the route. */
export interface CreateCaseInput {
  agentId: string;
  name: string;
  input_diff?: string;
  input_files?: unknown;
  input_meta?: unknown;
  expected_output: unknown;
  notes?: string | null;
}

export function useCreateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, ...body }: CreateCaseInput) =>
      api.post<EvalCase>(`/agents/${agentId}/eval-cases`, body),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
      qc.invalidateQueries({ queryKey: evalKeys.agentDashboard(agentId) });
    },
  });
}

/** Rename + edit a case's expected output (AC-23). */
export interface UpdateCaseInput {
  id: string;
  agentId: string;
  patch: Partial<
    Pick<EvalCase, "name" | "input_diff" | "input_files" | "input_meta" | "expected_output" | "notes">
  >;
}

export function useUpdateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateCaseInput) => api.put<EvalCase>(`/eval-cases/${id}`, patch),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
      qc.invalidateQueries({ queryKey: evalKeys.agentDashboard(agentId) });
    },
  });
}

/** Delete a case from the live set; prior run history is retained (AC-24). */
export interface DeleteCaseInput {
  id: string;
  agentId: string;
}

export function useDeleteCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteCaseInput) => api.del<{ ok: boolean }>(`/eval-cases/${id}`),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
      qc.invalidateQueries({ queryKey: evalKeys.agentDashboard(agentId) });
    },
  });
}

// ===========================================================================
// Running
// ===========================================================================

/** Run all evals for an agent's whole set — persists one run_group_id (AC-9). */
export function useRunAllEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<EvalRunGroup>(`/agents/${agentId}/eval-runs`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: evalKeys.cases(data.agent_id) });
      qc.invalidateQueries({ queryKey: evalKeys.runs(data.agent_id) });
      qc.invalidateQueries({ queryKey: evalKeys.agentDashboard(data.agent_id) });
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
    },
  });
}

/** Run a single case — one per-case record, aggregate re-derives from latest rows (AC-25). */
export interface RunSingleCaseInput {
  caseId: string;
  agentId: string;
}

/** Server response of `POST /eval-cases/:id/eval-runs` — the persisted run
 *  record plus the case it was scored against (NOT the ambiguous vendored
 *  `EvalRunResult` contract, which has an unrelated `run_id`/`result` shape). */
export interface RunSingleCaseResult {
  run: EvalRunRecord;
  case: EvalCase;
}

export function useRunSingleCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId }: RunSingleCaseInput) =>
      api.post<RunSingleCaseResult>(`/eval-cases/${caseId}/eval-runs`),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
      qc.invalidateQueries({ queryKey: evalKeys.runs(agentId) });
      qc.invalidateQueries({ queryKey: evalKeys.agentDashboard(agentId) });
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
    },
  });
}

/** Per-agent outcome of a "Run all agents" sweep — one agent's failure is
 *  isolated (AC-26). Matches `EvalService.runAllAgents`'s `RunAllAgentsResult`
 *  byte-for-byte: `ok` discriminates, `run`/`error` are each optional (never
 *  both present) rather than nullable. */
export interface RunAllAgentsResult {
  agent_id: string;
  agent_name: string;
  ok: boolean;
  run?: EvalRunGroup;
  error?: string;
}

/** Dashboard "Run all agents" — runs each agent independently (AC-26). */
export function useRunAllAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RunAllAgentsResult[]>(`/eval-runs/run-all-agents`),
    onSuccess: () => {
      // Result set spans every agent — invalidate broadly rather than per-id.
      qc.invalidateQueries({ queryKey: ["agent-eval-cases"] });
      qc.invalidateQueries({ queryKey: ["eval-runs"] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard"] });
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
    },
  });
}

// ===========================================================================
// History & dashboard
// ===========================================================================

/** Per-agent run history, newest-first (AC-15). */
export function useAgentEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.runs(agentId),
    queryFn: () => api.get<EvalRunGroup[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

/** One agent's current metrics + delta + trend (AC-8/AC-14/AC-28). */
export function useAgentEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.agentDashboard(agentId),
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
  });
}

/** Cross-agent latest metrics + pass count per agent, plus a cross-agent
    "Recent Eval Runs" list newest-first (AC-17). Matches `EvalService.dashboard`'s
    `CrossAgentDashboard` byte-for-byte: each entry is a full `EvalRunGroup`
    (not a slimmed-down summary) with an `agent_name` (+ `cases_total` on the
    per-agent list only) tacked on. */
export interface AgentEvalSummary extends EvalRunGroup {
  agent_name: string;
  cases_total: number;
}

export interface RecentEvalRun extends EvalRunGroup {
  agent_name: string;
}

export interface EvalCrossDashboard {
  agents: AgentEvalSummary[];
  recent_runs: RecentEvalRun[];
}

export function useEvalDashboard() {
  return useQuery({
    queryKey: evalKeys.dashboard(),
    queryFn: () => api.get<EvalCrossDashboard>(`/eval-dashboard`),
  });
}

// ===========================================================================
// Comparison & promotion
// ===========================================================================

export interface CompareRunsInput {
  old_run_group_id: string;
  new_run_group_id: string;
}

/** Read-only side-by-side of two run groups: deltas + cost + system-prompt diff (AC-16). */
export function useCompareRuns() {
  return useMutation({
    mutationFn: (input: CompareRunsInput) => api.post<EvalComparison>(`/eval-runs/compare`, input),
  });
}

export interface PromoteVersionInput {
  agentId: string;
  version: number;
}

/** Set the agent's active version to the newer of the two compared runs (AC-27). */
export function usePromoteVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, version }: PromoteVersionInput) =>
      api.post<Agent>(`/agents/${agentId}/eval-promote`, { version }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
      qc.invalidateQueries({ queryKey: evalKeys.agentDashboard(data.id) });
      qc.invalidateQueries({ queryKey: evalKeys.runs(data.id) });
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
    },
  });
}
