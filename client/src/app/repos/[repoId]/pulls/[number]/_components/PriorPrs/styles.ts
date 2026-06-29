import type { CSSProperties } from "react";

/** Co-located styles for the PriorPrs accordion. Mirrors BlastRadius/styles.ts. */
export const s = {
  card: {
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,

  accordionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "10px 14px",
    background: "transparent",
    borderStyle: "none",
    cursor: "pointer",
    textAlign: "left" as const,
    color: "var(--text-secondary)",
    fontSize: 13,
    fontWeight: 500,
  } satisfies CSSProperties,

  chevronIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
    transition: "transform .12s",
  } satisfies CSSProperties,

  countBadge: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    fontSize: 11.5,
    fontWeight: 600,
    padding: "1px 7px",
    borderRadius: 10,
    background: "var(--bg-surface)",
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--border)",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  content: {
    borderTopStyle: "solid" as const,
    borderTopWidth: 1,
    borderTopColor: "var(--border)",
  } satisfies CSSProperties,

  message: {
    padding: "14px 16px",
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic" as const,
    margin: 0,
  } satisfies CSSProperties,

  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
  } satisfies CSSProperties,

  row: {
    padding: "10px 14px",
    borderTopStyle: "solid" as const,
    borderTopWidth: 1,
    borderTopColor: "var(--border)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
  } satisfies CSSProperties,

  rowHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,

  prLink: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    textDecoration: "none",
    color: "inherit",
  } satisfies CSSProperties,

  prNumber: {
    fontSize: 12,
    fontWeight: 700,
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--accent)",
  } satisfies CSSProperties,

  prTitle: {
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  rowMeta: {
    fontSize: 12,
    color: "var(--text-muted)",
    display: "flex",
    gap: 3,
  } satisfies CSSProperties,

  rowNotes: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic" as const,
  } satisfies CSSProperties,
} as const;
