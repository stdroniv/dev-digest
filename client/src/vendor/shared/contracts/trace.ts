import { z } from 'zod';
import { SeverityCounts } from './findings.js';

/**
 * Run trace. The ENTIRE trace of one run is persisted as a SINGLE
 * jsonb document in `run_traces` (not per-row). Live events stream via SSE
 * during the run; the full log is written once on completion.
 */

export const RunEventKind = z.enum(['info', 'tool', 'result', 'error']);
export type RunEventKind = z.infer<typeof RunEventKind>;

/** A single live-log line. `t` = elapsed timestamp string (e.g. "00.31"). */
export const RunLogLine = z.object({
  t: z.string(),
  kind: RunEventKind,
  msg: z.string(),
});
export type RunLogLine = z.infer<typeof RunLogLine>;

/** SSE payload streamed on `/runs/:id/events`. */
export const RunEvent = z.object({
  runId: z.string(),
  seq: z.number().int(),
  kind: RunEventKind,
  msg: z.string(),
  t: z.string(),
  data: z.unknown().optional(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const ToolCall = z.object({
  tool: z.string(),
  args: z.string(),
  meta: z.string().nullish(),
  ms: z.number().int(),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const PromptAssembly = z.object({
  system: z.string(),
  skills: z.string().nullish(),
  memory: z.string().nullish(),
  specs: z.string().nullish(),
  /** Callers-of-changed-symbols digest (repo-intel); null when absent. */
  callers: z.string().nullish(),
  /** Repo skeleton / map (repo-intel); null when absent. */
  repo_map: z.string().nullish(),
  /** PR author's description/body (truncated); null when absent. */
  pr_description: z.string().nullish(),
  user: z.string(),
});
export type PromptAssembly = z.infer<typeof PromptAssembly>;

export const MemoryPulled = z.object({
  pr: z.number().int().nullish(),
  text: z.string(),
});
export type MemoryPulled = z.infer<typeof MemoryPulled>;

export const RunStats = z.object({
  duration_ms: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  findings: z.number().int(),
  grounding: z.string(),
  // Dollar cost of the run (provider-reported when available, else estimated);
  // null on failed/cancelled runs.
  cost_usd: z.number().nullable(),
  // Tokens contributed by the agent's enabled skills block (tokenizer adapter).
  // null when the agent had no enabled skills or on failed/cancelled runs.
  skills_tokens: z.number().int().nullish(),
  // Total LLM samples behind this review: 1 normally; >1 when the false-negative
  // guard re-sampled an empty single-pass result. nullish on older traces.
  samples: z.number().int().nullish(),
  // True when the empty-result re-sample guard ran (explains a non-trivial
  // sample count / "why did this approve"). nullish on older traces.
  resampled: z.boolean().nullish(),
  // Tokens consumed by the intent classifier on the auto-on-first-review path.
  // null/undefined when intent was already stored (no LLM call on this run).
  intent_tokens: z.number().int().nullish(),
  // Tokens saved vs sending the full diff bodies for intent classification.
  // null/undefined when intent was already stored.
  intent_tokens_saved: z.number().int().nullish(),
  // Tokens contributed by the assembled `## Project context` (specs/docs) block.
  // null/undefined when no project documents were attached or on failed/cancelled runs.
  specs_tokens: z.number().int().nullish(),
});
export type RunStats = z.infer<typeof RunStats>;

/** Origin of an attached project-context document set: the agent itself, or a
 *  named enabled skill. Shared by per-document read records and the
 *  same-repository-invariant exclusion record below. */
export const DocumentOrigin = z.object({
  type: z.enum(['agent', 'skill']),
  skill_id: z.string().nullish(),
  skill_name: z.string().nullish(),
});
export type DocumentOrigin = z.infer<typeof DocumentOrigin>;

/** Per-document read record for the run trace (AC-25/26/28). */
export const DocumentRead = z.object({
  path: z.string(),
  tokens: z.number().int().nonnegative(),
  origin: DocumentOrigin,
});
export type DocumentRead = z.infer<typeof DocumentRead>;

/** An entire attached set (agent- or skill-level) excluded wholesale from a
 * run because its anchor repo differs from the reviewed PR's repo
 * (same-repository invariant, AC-31). Distinct from the per-document
 * `documents_unavailable` case — these paths were never individually
 * resolved against the mismatched repo. */
export const DocumentsRepoExclusion = z.object({
  origin: DocumentOrigin,
  paths: z.array(z.string()),
});
export type DocumentsRepoExclusion = z.infer<typeof DocumentsRepoExclusion>;

/** The single-document trace stored in `run_traces.trace`. */
export const RunTrace = z.object({
  config: z.object({
    agent: z.string(),
    version: z.string().nullish(),
    provider: z.string().nullish(),
    model: z.string(),
    pr: z.number().int().nullish(),
    source: z.enum(['local', 'ci']).default('local'),
  }),
  stats: RunStats,
  prompt_assembly: PromptAssembly,
  tool_calls: z.array(ToolCall),
  raw_output: z.string(),
  memory_pulled: z.array(MemoryPulled),
  specs_read: z.array(z.string()),
  // Structured read-doc records (path + token estimate + origin); populated
  // alongside specs_read. default([]) so legacy traces without this key still parse.
  documents_read: z.array(DocumentRead).default([]),
  // Attached-but-missing paths (repo clone doesn't have the file at run time).
  // default([]) so legacy traces without this key still parse.
  documents_unavailable: z.array(z.string()).default([]),
  // Whole attached sets excluded because their anchor repo differs from this
  // PR's repo (same-repository invariant, AC-31). default([]) so legacy
  // traces without this key still parse.
  documents_repo_excluded: z.array(DocumentsRepoExclusion).default([]),
  log: z.array(RunLogLine),
});
export type RunTrace = z.infer<typeof RunTrace>;

/**
 * One row of a PR's run history (every agent_runs row, any status). Surfaced on
 * the PR page so runs — including FAILED ones with their error — survive reload.
 */
export const RunSummary = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string().nullable(), // running | done | failed | cancelled
  error: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  findings_count: z.number().int().nullable(),
  grounding: z.string().nullable(),
  ran_at: z.string().nullable(),
  // Review outcome, denormalized onto the run row at completion (the timeline
  // has no FK to the review). score = the review's 0-100 score; blockers =
  // findings that trip the agent's gate. Null on failed/cancelled runs.
  score: z.number().int().nullable(),
  blockers: z.number().int().nullable(),
  // Dollar cost of the run; null on failed/cancelled runs.
  cost_usd: z.number().nullable(),
  // Per-severity tally of this run's findings (computed on read from the run's
  // review). null when the run produced no review (running/failed/cancelled).
  findings_counts: SeverityCounts.nullable(),
  // Where the run executed: a local studio run, or an ingested CI run
  // (source='ci' on `agent_runs`, AC-42). Defaults to 'local' so existing
  // callers/fixtures that omit it keep parsing unchanged.
  source: z.enum(['local', 'ci']).default('local'),
});
export type RunSummary = z.infer<typeof RunSummary>;
