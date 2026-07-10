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
  EvalExpectedFinding,
  EvalRunGroup,
  EvalRunRecord,
} from "@devdigest/shared";

// ---- Query keys ----
export const evalKeys = {
  cases: (agentId: string | null | undefined) => ["agent-eval-cases", agentId] as const,
  runs: (agentId: string | null | undefined) => ["eval-runs", agentId] as const,
  agentDashboard: (agentId: string | null | undefined) => ["agent-eval-dashboard", agentId] as const,
  dashboard: () => ["eval-dashboard"] as const,
  // R-G1 (skill Evals tab) — skill-keyed counterparts. No cross-owner
  // "skillDashboard()" (A3): the cross-owner `/eval-dashboard` stays
  // agent-only, so there is nothing analogous to `evalKeys.dashboard()` here.
  skillCases: (skillId: string | null | undefined) => ["skill-eval-cases", skillId] as const,
  skillRuns: (skillId: string | null | undefined) => ["skill-eval-runs", skillId] as const,
  skillDashboard: (skillId: string | null | undefined) => ["skill-eval-dashboard", skillId] as const,
};

/** The owner an eval case/run belongs to (T13) — threaded through the
 *  generalized mutation hooks so they can derive both the create route
 *  (`/agents/:id/...` vs `/skills/:id/...`) and which cache keys to
 *  invalidate. Update/delete/run-single still hit the owner-AGNOSTIC
 *  `/eval-cases/:id...` routes — only the invalidation target switches. */
export type EvalOwner = { kind: "agent"; id: string } | { kind: "skill"; id: string };

function ownerCasesRoute(owner: EvalOwner): string {
  return owner.kind === "agent" ? `/agents/${owner.id}/eval-cases` : `/skills/${owner.id}/eval-cases`;
}

/** Invalidate an owner's case list + its own dashboard (NOT run history —
 *  callers that also affect runs use {@link invalidateOwnerRuns} instead). */
function invalidateOwnerCases(qc: ReturnType<typeof useQueryClient>, owner: EvalOwner): void {
  if (owner.kind === "agent") {
    qc.invalidateQueries({ queryKey: evalKeys.cases(owner.id) });
    qc.invalidateQueries({ queryKey: evalKeys.agentDashboard(owner.id) });
  } else {
    qc.invalidateQueries({ queryKey: evalKeys.skillCases(owner.id) });
    qc.invalidateQueries({ queryKey: evalKeys.skillDashboard(owner.id) });
  }
}

/** Invalidate everything a RUN can affect: cases (a run can be the first
 *  signal a case exists), run history, the owner's dashboard, and — agents
 *  only — the cross-agent dashboard (A3: no skill equivalent). */
function invalidateOwnerRuns(qc: ReturnType<typeof useQueryClient>, owner: EvalOwner): void {
  if (owner.kind === "agent") {
    qc.invalidateQueries({ queryKey: evalKeys.cases(owner.id) });
    qc.invalidateQueries({ queryKey: evalKeys.runs(owner.id) });
    qc.invalidateQueries({ queryKey: evalKeys.agentDashboard(owner.id) });
    qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
  } else {
    qc.invalidateQueries({ queryKey: evalKeys.skillCases(owner.id) });
    qc.invalidateQueries({ queryKey: evalKeys.skillRuns(owner.id) });
    qc.invalidateQueries({ queryKey: evalKeys.skillDashboard(owner.id) });
  }
}

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

/** Every eval case owned by a skill (R-G1-3). */
export function useSkillEvalCases(skillId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.skillCases(skillId),
    queryFn: () => api.get<EvalCase[]>(`/skills/${skillId}/eval-cases`),
    enabled: !!skillId,
  });
}

/** Server response of `POST /findings/:id/eval-case` — 201 on first create, 200
 *  when the finding already has a case (idempotent, AC-5): `already_added` is
 *  the real cross-session signal (not a client-only session guard). */
export interface CreateCaseFromFindingResult {
  case: EvalCase;
  already_added: boolean;
}

/**
 * Non-saving preview of "Turn into eval case" (Gap 2, T4) — mirrors the
 * server's documented `FindingEvalCasePreview` interface
 * (`server/src/modules/eval/service.ts`) field-for-field, per
 * `client/INSIGHTS.md:135` ("hand-diff every new/changed hook's local type
 * against the server route/service.ts shapes — `tsc` cannot catch a lying
 * annotation").
 */
export interface FindingEvalCasePreview {
  name: string;
  input_diff: string;
  input_meta: unknown;
  expected_output: EvalExpectedFinding[];
  owner_id: string;
  already_added: boolean;
  existing_case?: EvalCase;
}

/** GET /findings/:id/eval-case/preview (Gap 2, T4) — no DB write. Gated by
 *  `enabled` so a finding card never eagerly fetches until the user opens it
 *  (avoids a `loadDiff` per finding card on mount). */
export function useFindingEvalCasePreview(findingId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["finding-eval-case-preview", findingId],
    queryFn: () => api.get<FindingEvalCasePreview>(`/findings/${findingId}/eval-case/preview`),
    enabled: !!findingId && enabled,
  });
}

export interface CreateCaseFromFindingInput {
  findingId: string;
  /** Optional edits (Gap 2, A2) applied over the frozen draft before insert —
   *  the frozen `input_diff` is never an accepted override (R-G2-3). */
  name?: string;
  expected_output?: unknown;
}

/** Turn an accepted/dismissed finding into a frozen eval case (AC-1..AC-5). */
export function useCreateCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, ...edits }: CreateCaseFromFindingInput) =>
      api.post<CreateCaseFromFindingResult>(`/findings/${findingId}/eval-case`, edits),
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: evalKeys.cases(data.case.owner_id) });
      qc.invalidateQueries({ queryKey: evalKeys.agentDashboard(data.case.owner_id) });
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
      // Re-clicking the SAME finding right after a save must see
      // `already_added:true` immediately (R-G2-4), not just after a reload.
      qc.invalidateQueries({ queryKey: ["finding-eval-case-preview", variables.findingId] });
    },
  });
}

/** Author a brand-new eval case from scratch (AC-22, R-G1-3 skill parity). */
export interface CreateCaseInput {
  owner: EvalOwner;
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
    mutationFn: ({ owner, ...body }: CreateCaseInput) => api.post<EvalCase>(ownerCasesRoute(owner), body),
    onSuccess: (_data, { owner }) => invalidateOwnerCases(qc, owner),
  });
}

/** Rename + edit a case's expected output (AC-23). Hits the owner-AGNOSTIC
 *  `/eval-cases/:id` route regardless of owner kind — only the invalidation
 *  target depends on `owner`. */
export interface UpdateCaseInput {
  id: string;
  owner: EvalOwner;
  patch: Partial<
    Pick<EvalCase, "name" | "input_diff" | "input_files" | "input_meta" | "expected_output" | "notes">
  >;
}

export function useUpdateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateCaseInput) => api.put<EvalCase>(`/eval-cases/${id}`, patch),
    onSuccess: (_data, { owner }) => invalidateOwnerCases(qc, owner),
  });
}

/** Delete a case from the live set; prior run history is retained (AC-24). */
export interface DeleteCaseInput {
  id: string;
  owner: EvalOwner;
}

export function useDeleteCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteCaseInput) => api.del<{ ok: boolean }>(`/eval-cases/${id}`),
    onSuccess: (_data, { owner }) => invalidateOwnerCases(qc, owner),
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

/** Skill-keyed "run all evals" (R-G1-4). `agent_id`/`agent_version` on the
 *  response are reused fields carrying the SKILL's id/version. */
export function useRunAllSkillEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillId: string) => api.post<EvalRunGroup>(`/skills/${skillId}/eval-runs`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: evalKeys.skillCases(data.agent_id) });
      qc.invalidateQueries({ queryKey: evalKeys.skillRuns(data.agent_id) });
      qc.invalidateQueries({ queryKey: evalKeys.skillDashboard(data.agent_id) });
    },
  });
}

/** Run a single case — one per-case record, aggregate re-derives from latest
 *  rows (AC-25). Works for either owner kind (T8e removed the pre-refactor
 *  "agent-owned only" guard server-side). */
export interface RunSingleCaseInput {
  caseId: string;
  owner: EvalOwner;
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
    onSuccess: (_data, { owner }) => invalidateOwnerRuns(qc, owner),
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

/** Skill-keyed run history, newest-first (R-G1-4). */
export function useSkillEvalRuns(skillId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.skillRuns(skillId),
    queryFn: () => api.get<EvalRunGroup[]>(`/skills/${skillId}/eval-runs`),
    enabled: !!skillId,
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

/** One skill's current metrics + delta + trend (R-G1-5). */
export function useSkillEvalDashboard(skillId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.skillDashboard(skillId),
    queryFn: () => api.get<EvalDashboard>(`/skills/${skillId}/eval-dashboard`),
    enabled: !!skillId,
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
