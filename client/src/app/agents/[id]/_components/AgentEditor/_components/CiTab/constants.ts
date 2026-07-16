import type { CiRunStatus } from "@devdigest/shared";

/** The "Fail CI on" segmented control's 3 exposed levels — `CiFailOn` has a
 *  4th `any` value (Rec3), left unused/unreachable from this control. Each
 *  `value` is a literal of `CiFailOn`, so it's directly assignable to
 *  `useUpdateAgent`'s `patch.ci_fail_on`. */
export const FAIL_ON_OPTIONS: { value: "critical" | "warning" | "never"; labelKey: string }[] = [
  { value: "critical", labelKey: "failOn.critical" },
  { value: "warning", labelKey: "failOn.warning" },
  { value: "never", labelKey: "failOn.never" },
];

/** Installation status → colour token + i18n label key (under `runs.status`
 *  in `ci.json`). Mirrors `ci-runs/_components/CiRunsPage/constants.ts`'s
 *  `CI_STATUS_META` — kept as a local copy per this codebase's feature
 *  isolation convention rather than a cross-feature import. */
export const CI_STATUS_META: Record<CiRunStatus, { c: string; bg: string; labelKey: string }> = {
  succeeded: { c: "var(--ok)", bg: "var(--ok-bg)", labelKey: "succeeded" },
  no_findings: { c: "var(--text-secondary)", bg: "var(--bg-hover)", labelKey: "noFindings" },
  failed: { c: "var(--crit)", bg: "var(--crit-bg)", labelKey: "failed" },
  running: { c: "var(--warn)", bg: "var(--warn-bg)", labelKey: "running" },
  skipped_no_credentials: { c: "var(--text-muted)", bg: "var(--bg-hover)", labelKey: "skippedNoCredentials" },
};
