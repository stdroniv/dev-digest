import type { CSSProperties } from "react";

/** Co-located styles for CaseEditorModal. */
export const s = {
  body: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, padding: 24 } satisfies CSSProperties,
  col: { display: "flex", flexDirection: "column", minWidth: 0 } satisfies CSSProperties,
  inputPane: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    color: "var(--text-secondary)",
    minHeight: 220,
    maxHeight: 320,
    overflow: "auto",
  } satisfies CSSProperties,
  expectedHeaderRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  jsonBadgeValid: { color: "var(--ok)" } satisfies CSSProperties,
  jsonBadgeInvalid: { color: "var(--crit)" } satisfies CSSProperties,
  resultStrip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    padding: "8px 12px",
    borderRadius: 7,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    marginBottom: 16,
  } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  runOnSaveLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  spacer: { marginLeft: "auto" } satisfies CSSProperties,
} as const;
