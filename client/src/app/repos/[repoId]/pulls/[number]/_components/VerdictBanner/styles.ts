import type { CSSProperties } from "react";

/** Co-located styles for VerdictBanner (extracted from inline styles). */
export const s = {
  wrap: {
    display: "flex",
    gap: 18,
    alignItems: "flex-start",
    padding: 18,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  iconBox: (bg: string, color: string): CSSProperties => ({
    width: 40,
    height: 40,
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    background: bg,
    color,
    flexShrink: 0,
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  label: (color: string): CSSProperties => ({ fontSize: 18, fontWeight: 700, color }),
  summary: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
    marginTop: 8,
  } satisfies CSSProperties,
  whySummary: {
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-muted)",
    marginTop: 4,
  } satisfies CSSProperties,
  // Longhands only (no `border`/`background` shorthand) — this badge is
  // rendered conditionally alongside sibling Badges in the same flex row,
  // so a shorthand+longhand mix here would trip React's style-conflict
  // warning the moment any sibling re-render touches these properties.
  staleBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 8px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--warn)",
    backgroundColor: "var(--warn-bg)",
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--warn)",
  } satisfies CSSProperties,
  truncatedNote: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic",
    marginTop: 6,
  } satisfies CSSProperties,
  scoreCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
  } satisfies CSSProperties,
  scoreLabel: {
    fontSize: 12,
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
  } satisfies CSSProperties,
  scoreStat: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  scoreCost: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
  } satisfies CSSProperties,
  scoreTokens: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
