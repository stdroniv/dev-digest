import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "8px 0",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  rowLast: { borderBottom: "none" } satisfies CSSProperties,
  rowMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  index: {
    width: 18,
    flexShrink: 0,
    fontSize: 12,
    color: "var(--text-muted)",
    paddingTop: 2,
  } satisfies CSSProperties,
  path: { fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  why: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  reason: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  command: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  commandLine: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    minWidth: 0,
    flex: 1,
  } satisfies CSSProperties,
  commandText: {
    fontSize: 13,
    color: "var(--text-primary)",
    whiteSpace: "pre",
    overflow: "auto",
  } satisfies CSSProperties,
  commandComment: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  copyBtn: {
    flexShrink: 0,
    background: "none",
    border: "none",
    padding: 4,
    cursor: "pointer",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  taskGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 12,
  } satisfies CSSProperties,
  taskCard: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  taskTitle: { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  taskPath: { fontSize: 12, color: "var(--text-muted)", cursor: "pointer" } satisfies CSSProperties,
  emptyNote: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
};

export const COMPLEXITY_COLOR: Record<"low" | "medium" | "high", { c: string; bg: string }> = {
  low: { c: "var(--ok)", bg: "var(--ok-bg)" },
  medium: { c: "var(--warn)", bg: "var(--warn-bg)" },
  high: { c: "var(--crit)", bg: "var(--crit-bg)" },
};
