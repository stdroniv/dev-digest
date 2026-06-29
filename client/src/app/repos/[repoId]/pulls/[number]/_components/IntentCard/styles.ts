import type { CSSProperties } from "react";
import type { RiskSeverity } from "@devdigest/shared";

/** Co-located styles for IntentCard. */
export const s = {
  card: {
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
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

  riskChipRow: { display: "flex", flexWrap: "wrap" as const, gap: 8 } satisfies CSSProperties,

  riskChipWrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    minWidth: 0,
  } satisfies CSSProperties,

  // Base chip — borderColor is set via per-render spread; borderStyle/borderWidth
  // are longhands so no border shorthand + longhand collision occurs.
  riskChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 6,
    fontSize: 12.5,
    fontWeight: 600,
    borderStyle: "solid" as const,
    borderWidth: 1,
    cursor: "pointer",
    maxWidth: "100%",
    background: "transparent",
  } satisfies CSSProperties,

  riskChipTitle: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } satisfies CSSProperties,

  riskDetail: {
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--bg-surface)",
    borderStyle: "solid" as const,
    borderWidth: 1,
    borderColor: "var(--border)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } satisfies CSSProperties,

  riskExplanation: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: 0,
    lineHeight: 1.5,
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
