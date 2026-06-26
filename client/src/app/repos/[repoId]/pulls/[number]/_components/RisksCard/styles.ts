import type { CSSProperties } from "react";
import type { RiskSeverity } from "@devdigest/shared";

/** Co-located styles for RisksCard. */
export const s = {
  card: {
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
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

  riskList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 0,
  } satisfies CSSProperties,

  riskItem: {
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } satisfies CSSProperties,

  riskHeader: {
    display: "flex",
    flexDirection: "row" as const,
    gap: 8,
    alignItems: "center",
  } satisfies CSSProperties,

  badge: {
    display: "inline-flex",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    padding: "2px 6px",
  } satisfies CSSProperties,

  title: {
    fontSize: 14,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  explanation: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  fileRefs: {
    display: "flex",
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 4,
  } satisfies CSSProperties,

  fileRef: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;

export const severityColor: Record<RiskSeverity, { c: string; bg: string }> = {
  high: { c: "var(--crit)", bg: "var(--crit-bg)" },
  medium: { c: "var(--warn)", bg: "var(--warn-bg)" },
  low: { c: "var(--sugg)", bg: "var(--sugg-bg)" },
};
