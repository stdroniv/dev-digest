import type { CiRunStatus } from "@devdigest/shared";

/** Constants for the CI Runs page (N13, SPEC-05 AC-35/36). */

/** Grid template shared by the header row and every data row (mirrors the
 *  design's 9-column grid: Timestamp / Pull request / Agent / Source /
 *  Duration / Findings / Cost / Status / Trace). */
export const GRID = "140px 1fr 150px 130px 70px 110px 70px 110px 80px";

/** CI run status → colour token + i18n label key (under `runs.status`).
 *  AC-33: `succeeded` covers a clean run AND one with blocker findings (the
 *  blocked-merge signal is the CRITICAL chip, not this token); `failed` is
 *  reserved for the runner itself failing to produce a review. `running` and
 *  `skipped_no_credentials` (AC-27) are distinct, non-error edge states. */
export const CI_STATUS_META: Record<CiRunStatus, { c: string; bg: string; labelKey: string }> = {
  succeeded: { c: "var(--ok)", bg: "var(--ok-bg)", labelKey: "succeeded" },
  no_findings: { c: "var(--text-secondary)", bg: "var(--bg-hover)", labelKey: "noFindings" },
  failed: { c: "var(--crit)", bg: "var(--crit-bg)", labelKey: "failed" },
  running: { c: "var(--warn)", bg: "var(--warn-bg)", labelKey: "running" },
  skipped_no_credentials: { c: "var(--text-muted)", bg: "var(--bg-hover)", labelKey: "skippedNoCredentials" },
};

export const STATUS_OPTIONS: CiRunStatus[] = [
  "succeeded",
  "no_findings",
  "failed",
  "running",
  "skipped_no_credentials",
];

export const SOURCE_OPTIONS: ("local" | "ci")[] = ["local", "ci"];

export type DateRangeKey = "7d" | "30d" | "all";

/** Date-range filter presets (AC-36); default is "7d" ("Last 7 days"). */
export const DATE_RANGE_OPTIONS: { value: DateRangeKey; labelKey: string }[] = [
  { value: "7d", labelKey: "last7Days" },
  { value: "30d", labelKey: "last30Days" },
  { value: "all", labelKey: "allTime" },
];

/** Number of skeleton rows shown while loading. */
export const SKELETON_ROWS = 5;
