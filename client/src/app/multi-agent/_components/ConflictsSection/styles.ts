import type { CSSProperties } from "react";

/**
 * Co-located styles for ConflictsSection (extracted from the design's inline
 * styles — `8bb91114:21-40`). Kept pixel-faithful to the mock.
 */
export const s = {
  root: { marginTop: 22 } satisfies CSSProperties,
  toggleLabel: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  count: {
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  codeIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  fileLine: { fontSize: 12 } satisfies CSSProperties,
  title: { fontSize: 13, fontWeight: 600, marginLeft: 6 } satisfies CSSProperties,
  takesGrid: (count: number): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: `repeat(${count}, 1fr)`,
    gap: 1,
    background: "var(--border)",
  }),
  take: {
    padding: "10px 14px",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  persona: {
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 4,
  } satisfies CSSProperties,
  verdictRow: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    marginBottom: 4,
  } satisfies CSSProperties,
  dot: (color: string): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: 99,
    background: color,
  }),
  verdictText: (flagged: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    color: flagged ? "var(--text-primary)" : "var(--text-muted)",
    textTransform: flagged ? "uppercase" : "none",
    letterSpacing: flagged ? "0.03em" : 0,
  }),
  note: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  } satisfies CSSProperties,
  empty: {
    padding: "20px 14px",
    textAlign: "center",
    fontSize: 12.5,
    color: "var(--text-muted)",
    border: "1px dashed var(--border-strong)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
} as const;
