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

  // alignItems:stretch (not start) so the two columns share the taller column's
  // height — the shorter column's flex-grow card (IntentCard / BlastRadius) then
  // fills the slack, keeping both columns bottom-aligned per design regardless of
  // Prior-PRs expand state.
  briefGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
    gap: 20,
    alignItems: "stretch",
  } satisfies CSSProperties,

  // Left grid cell — flex column holding IntentCard; minWidth:0 prevents
  // content (long Blast paths) from overflowing the grid track instead of
  // ellipsing/scrolling.
  cell: { display: "flex", flexDirection: "column", gap: 20, minWidth: 0 } satisfies CSSProperties,

  // Right column — flex column so BlastRadius + PriorPrs + ReviewFocus stack
  // with 20px gap; minWidth:0 for the same overflow-prevention reason as `cell`.
  rightCol: { display: "flex", flexDirection: "column", gap: 20, minWidth: 0 } satisfies CSSProperties,
} as const;
