import type { FindingRecord, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_FILTERS, SEVERITY_ORDER } from "./constants";

/** Drop low-confidence findings (optional), keep one severity (optional), sort by severity. */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  sevFilter: Severity | null = null,
): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (sevFilter) shown = shown.filter((f) => f.severity === sevFilter);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

/** Tally findings per filterable severity (CRITICAL/WARNING/SUGGESTION). */
export function countBySeverity(findings: FindingRecord[]): Record<Severity, number> {
  const counts = Object.fromEntries(SEVERITY_FILTERS.map((sev) => [sev, 0])) as Record<
    Severity,
    number
  >;
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity as Severity] += 1;
  }
  return counts;
}
