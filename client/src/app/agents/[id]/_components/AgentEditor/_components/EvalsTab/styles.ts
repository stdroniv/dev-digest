import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 24, maxWidth: 960 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", justifyContent: "space-between" } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: 2 } satisfies CSSProperties,
  headerActions: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  metricsGrid: { display: "flex", gap: 12 } satisfies CSSProperties,
  dashboardLink: { fontSize: 12.5, color: "var(--accent)", fontWeight: 600 } satisfies CSSProperties,
  casesHeader: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  casesTitle: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  casesActions: { display: "flex", gap: 10, marginLeft: "auto" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowMain: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 } satisfies CSSProperties,
  rowName: { fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  rowSummary: { fontSize: 12.5, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  rowStatus: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  rowActions: { display: "flex", alignItems: "center", gap: 4 } satisfies CSSProperties,
} as const;
