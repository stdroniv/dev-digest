/**
 * Shared contract types re-exported from @devdigest/shared (single source of
 * truth). F2 imports these rather than redefining them.
 *
 * F1 (@devdigest/shared) currently exports all the platform/findings/brief/
 * knowledge/trace contracts we need for the scaffolding screens, so there are
 * NO local placeholders required at this time. If a feature agent's contract is
 * not yet exported, add a placeholder below marked
 * `// TODO: reconcile with @devdigest/shared`.
 */
export type {
  Settings,
  SettingsUpdate,
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  FeatureModelId,
  FeatureModelChoice,
  FeatureModelDef,
  Provider,
  ModelInfo,
  Repo,
  RepoInput,
  PrMeta,
  PrDetail,
  PrFile,
  PrCommit,
  PrReviewComment,
  PrStatus,
  SpecFile,
  IndexStatus,
} from "@devdigest/shared";

export type { Review, Finding, Severity, Verdict } from "@devdigest/shared";
export type { PrBrief, SmartDiff } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Blast radius — hand-mirrored from server/src/modules/blast/types.ts
// NOTE: `index.status` mirrors the REPO-INTEL string union (full|partial|
// degraded|failed), NOT the shared `IndexStatus` Zod object (which is the
// real-time progress object from @devdigest/shared — a different shape).
// ---------------------------------------------------------------------------

/** Repo-intel index health string (mirrors server repo-intel/types.ts). */
export type BlastIndexStatus = "full" | "partial" | "degraded" | "failed";

/** Why the blast index ran in degraded mode (mirrors server repo-intel/types.ts). */
export type BlastDegradedReason =
  | "flag_off"
  | "index_failed"
  | "index_partial"
  | "repo_too_large"
  | "no_data";

/** One caller reference within a blast symbol group. */
export interface BlastCallerEntry {
  file: string;
  symbol: string;
  line: number;
  rank: number;
}

/** A changed symbol with its cross-file callers + reachable endpoints/crons. */
export interface BlastSymbolGroup {
  file: string;
  name: string;
  kind: string;
  /** Callers sorted rank-desc, capped at 20. */
  callers: BlastCallerEntry[];
  endpoints: string[];
  crons: string[];
}

/** Full shaped blast-radius response (GET /pulls/:id/blast). */
export interface BlastResponse {
  symbols: BlastSymbolGroup[];
  totals: {
    symbols: number;
    callers: number;
    endpoints: number;
    crons: number;
  };
  /** Flat union of all impacted HTTP endpoints across every changed symbol. */
  impactedEndpoints: string[];
  /** Flat union of all impacted cron jobs across every changed symbol. */
  impactedCrons: string[];
  index: {
    status: BlastIndexStatus;
    degraded: boolean;
    reason?: BlastDegradedReason;
    /** null when the repo has never been indexed or the sha is unknown. */
    lastIndexedSha: string | null;
  };
  /** True when the underlying facade ran in degraded / ripgrep mode. */
  degraded: boolean;
  reason?: BlastDegradedReason;
  /**
   * Honest "limited cross-file resolution" signal — mirrored from
   * server/src/modules/blast/types.ts. `limited: true` when a large share of
   * references couldn't be resolved to a decl_file (sparse cross-file edges).
   * Rendered as a DISTINCT informational note, NOT the degraded/partial badge.
   */
  resolution: { limited: boolean; reason?: string };
}

/** Response from GET /pulls/:id/blast/summary. */
export interface BlastSummaryResponse {
  summary: string | null;
  cached: boolean;
  skipped?: "no_key" | "no_data";
}

// ---------------------------------------------------------------------------
// PR History (GET /pulls/:id/prior-prs) — mirrors vendored brief.ts PrHistory

/** One prior merged PR that touched at least one of the current PR's files. */
export interface PrHistoryItem {
  pr_number: number;
  title: string;
  merged_at: string;
  author: string;
  /** Sorted array of files shared between the prior PR and the current PR. */
  files_overlap: string[];
  /** Deterministic note: "Touched N of these files". */
  notes: string;
}

/** Response from GET /pulls/:id/prior-prs. */
export interface PrHistory {
  history: PrHistoryItem[];
}

// ---------------------------------------------------------------------------

/** UI-only view model for a PR list row (derives display fields from PrMeta). */
export interface PrRowView {
  number: number;
  title: string;
  author: string;
  size: "S" | "M" | "L";
  sizeLines: string;
  score: number;
  findings: { CRITICAL: number; WARNING: number; SUGGESTION: number };
  status: "needs_review" | "reviewed" | "stale";
  updated: string;
}
