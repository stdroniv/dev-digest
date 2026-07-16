import type { CSSProperties } from "react";
import { GRID } from "./constants";

export const s = {
  table: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  headerRow: {
    display: "grid",
    gridTemplateColumns: GRID,
    gap: 10,
    padding: "9px 14px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  row: (last: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: GRID,
    gap: 10,
    padding: "10px 14px",
    borderBottom: last ? "none" : "1px solid var(--border)",
    alignItems: "center",
    fontSize: 12,
  }),
  timestamp: { color: "var(--text-secondary)", fontSize: 11 } satisfies CSSProperties,
} as const;
