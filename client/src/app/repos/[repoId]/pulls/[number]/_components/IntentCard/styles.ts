import type { CSSProperties } from "react";
import type { RiskSeverity } from "@devdigest/shared";

/** Co-located styles for IntentCard. */
export const s = {
  // Fills its (stretched) grid cell so the card below can flex-grow to match the
  // right column's height — see OverviewTab `briefGrid`.
  section: {
    display: "flex",
    flexDirection: "column" as const,
    flex: 1,
    minHeight: 0,
  } satisfies CSSProperties,

  card: {
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
    // Grow to fill the section height so the left column bottom-aligns with the
    // right column when the latter is taller (e.g. Prior PRs expanded).
    flex: 1,
  } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 16px 10px",
    gap: 12,
  } satisfies CSSProperties,

  summaryText: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--text-primary)",
    flex: 1,
    minWidth: 0,
    fontStyle: "italic" as const,
  } satisfies CSSProperties,

  scopeSection: {
    padding: "0 16px 14px",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    columnGap: 24,
    rowGap: 4,
    alignItems: "start",
  } satisfies CSSProperties,

  scopeCol: { minWidth: 0 } satisfies CSSProperties,

  scopeLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    marginBottom: 6,
    marginTop: 10,
  } satisfies CSSProperties,

  scopeLabelRow: {
    display: "flex",
    alignItems: "center",
    gap: 5,
  } satisfies CSSProperties,

  scopeList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
  } satisfies CSSProperties,

  scopeItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  scopeBullet: {
    color: "var(--text-muted)",
    flexShrink: 0,
    marginTop: 1,
  } satisfies CSSProperties,

  emptyState: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic" as const,
  } satisfies CSSProperties,

  divider: {
    borderTop: "1px solid var(--border)",
    margin: "0 16px",
  } satisfies CSSProperties,

  // Risk Areas section — below the scope section
  riskAreasSection: { padding: "0 16px 14px" } satisfies CSSProperties,

  riskList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  } satisfies CSSProperties,

  riskItem: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  } satisfies CSSProperties,

  // The title itself carries the hover tooltip (native title/aria-label) that
  // reveals the risk's longer explanation — no click-to-expand affordance.
  riskTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "default",
  } satisfies CSSProperties,

  riskChipTitle: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } satisfies CSSProperties,

  riskFileRefs: { display: "flex", flexWrap: "wrap" as const, gap: 8 } satisfies CSSProperties,

  riskFileRef: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;

/** Severity → CSS color tokens (high→crit / medium→warn / low→sugg).
 *  Exported as a separate const because a Record<RiskSeverity, {...}> is not
 *  assignable to CSSProperties, so it cannot live inside `s`. */
export const severityColor: Record<RiskSeverity, { c: string; bg: string }> = {
  high:   { c: "var(--crit)", bg: "var(--crit-bg)" },
  medium: { c: "var(--warn)", bg: "var(--warn-bg)" },
  low:    { c: "var(--sugg)", bg: "var(--sugg-bg)" },
};
