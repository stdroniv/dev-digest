import { z } from 'zod';
import { Verdict, Finding, Severity, FindingCategory, SeverityCounts } from './findings.js';
import { EvalRun, EvalOwnerKind, Conformance, Provider, CiFailOn } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunRecord),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * Outcome of one CI run, as surfaced to the studio (CI Runs page, agent CI tab).
 * `succeeded` covers a clean run AND a run that found blockers on purpose (the
 * blocked-merge state is conveyed via the verdict/CRITICAL count, not this
 * enum — AC-33); `failed` is reserved for the runner itself failing to
 * produce a review (missing/invalid artifact, AC-31/32); `skipped_no_credentials`
 * is the fork-PR / no-secret path, distinct from both success and failure (AC-27).
 */
export const CiRunStatus = z.enum([
  'succeeded',
  'no_findings',
  'failed',
  'running',
  'skipped_no_credentials',
]);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService.agentYaml`) WRITES this shape to
 * `.devdigest/agents/<slug>.yaml`; the agent-runner READS it. Keeping one Zod
 * schema for both ends guarantees the formats never drift. `skills` are slugs
 * resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  // Workspace-unique, filesystem/URL-safe identifier (AC-15) — keys the
  // committed manifest/workflow filenames (`.devdigest/agents/<slug>.yaml`,
  // `.github/workflows/devdigest-review-<slug>.yml`, AC-16) so two agents
  // exported to the same repo never collide.
  slug: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
  // Bumped on every re-export/config update (AC-41) so an installed repo's
  // workflow can be compared against the agent's current config to detect
  // drift ("update available", AC-40).
  workflow_version: z.number().int().default(1),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/**
 * A persisted CI installation (mirrors `ci_installations`), enriched with
 * fields DERIVED at read time (not columns) for the agent CI tab (AC-39/40):
 * `status`/`last_run_at` come from the installation's latest `ci_runs` row;
 * `update_available` compares `installed_config_hash` against the agent's
 * current config hash.
 */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  /** Same domain as `target_type` — the AC-39 "target" column (e.g. "GitHub Actions" label resolves client-side from this). */
  target: CiTarget,
  installed_at: z.string(),
  /** Currently-installed workflow version (AC-39/41). */
  workflow_version: z.number().int(),
  /** Derived from the latest `ci_runs` row for this installation; null before the first run. */
  status: CiRunStatus.nullable(),
  /** Derived from the latest `ci_runs` row's `ran_at`; null before the first run (AC-39). */
  last_run_at: z.string().nullable(),
  /** True when `installed_config_hash` differs from the agent's current config hash (AC-40). */
  update_available: z.boolean(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

/**
 * A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts.
 * Covers every CI Runs page column (AC-35): Timestamp = `ran_at`, Pull
 * request = `pr_number` + `pr_title`, Agent = `agent`, Source = `source`,
 * Duration = `duration_s`, Findings = `findings_counts` (per-severity) +
 * `findings_count` (aggregate), Cost = `cost_usd`, Status = `status`, Trace =
 * `github_url` (outbound link to the Actions job). `actions_run_id`
 * identifies the source Actions run for idempotent reconcile (AC-30/34).
 */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  pr_title: z.string().nullable(),
  ran_at: z.string().nullable(),
  status: CiRunStatus.nullable(),
  findings_count: z.number().int().nullable(),
  findings_counts: SeverityCounts.nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  actions_run_id: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06). `status` lets the
 * runner report the fork/no-credentials skip (AC-27) or a completed outcome
 * without the studio inferring/fabricating it from findings alone (AC-31/33);
 * a MISSING artifact (not this `status` field) is what drives Failed on
 * ingest (AC-32).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
  status: CiRunStatus.nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;

// ===========================================================================
// Eval — run grouping, comparison & promotion (L06 Eval Pipeline foundation)
// ===========================================================================

/**
 * One expected finding inside a `must_find` case's `expected_output`. A case's
 * `expected_output` is either `[]` (`must_not_flag`) or an array of these.
 */
export const EvalExpectedFinding = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: Severity.nullish(),
  category: FindingCategory.nullish(),
  title: z.string().nullish(),
});
export type EvalExpectedFinding = z.infer<typeof EvalExpectedFinding>;

/**
 * One run of an agent version against its whole eval case set — the
 * SET-LEVEL aggregate (derived from the latest per-case `eval_runs` rows
 * sharing a `run_group_id`), attributed to the `agent_versions` snapshot
 * that produced it.
 */
export const EvalRunGroup = z.object({
  id: z.string(),
  run_group_id: z.string(),
  agent_id: z.string(),
  agent_version: z.number().int().nullable(),
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  cost_usd: z.number().nullable(),
});
export type EvalRunGroup = z.infer<typeof EvalRunGroup>;

/** `old -> new` + delta for one numeric metric between two run groups. */
export const EvalMetricDelta = z.object({
  old: z.number(),
  new: z.number(),
  delta: z.number(),
});
export type EvalMetricDelta = z.infer<typeof EvalMetricDelta>;

/**
 * Read-only side-by-side comparison of two run groups: `old -> new` + delta
 * per metric (incl. cost, reported not judged), the diff of the two
 * `agent_versions` system prompts, and which of the two is newer (the only
 * thing `POST /agents/:id/eval-promote` may act on).
 */
export const EvalComparison = z.object({
  old_run: EvalRunGroup,
  new_run: EvalRunGroup,
  recall: EvalMetricDelta,
  precision: EvalMetricDelta,
  citation_accuracy: EvalMetricDelta,
  cost_usd: EvalMetricDelta,
  system_prompt_diff: z.string(),
  newer_version: z.number().int().nullable(),
});
export type EvalComparison = z.infer<typeof EvalComparison>;

/** Request body for `POST /agents/:id/eval-promote` — promote a version to active. */
export const EvalPromoteInput = z.object({
  version: z.number().int(),
});
export type EvalPromoteInput = z.infer<typeof EvalPromoteInput>;
