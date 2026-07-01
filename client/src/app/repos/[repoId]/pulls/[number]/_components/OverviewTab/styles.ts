import type { CSSProperties } from "react";

export const s = {
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,

  briefBody: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,

  briefGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
    gap: 20,
    alignItems: "start",
  } satisfies CSSProperties,

  // Left grid cell — minWidth:0 prevents content (long Blast paths) from
  // overflowing the grid track instead of ellipsing/scrolling.
  cell: { minWidth: 0 } satisfies CSSProperties,

  // Right column — flex column so BlastRadius + PriorPrs stack with 20px gap;
  // minWidth:0 for the same overflow-prevention reason as `cell`.
  rightCol: { display: "flex", flexDirection: "column", gap: 20, minWidth: 0 } satisfies CSSProperties,
} as const;
