import type { CSSProperties } from "react";

/** Co-located styles for the BlastRadius panel. */
export const s = {
  card: {
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px 10px",
    gap: 12,
    flexWrap: "wrap" as const,
    rowGap: 8,
  } satisfies CSSProperties,

  // Step 6: stat row is now a flex container; stat items are separate spans
  statRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flex: 1,
    flexWrap: "wrap" as const,
    rowGap: 6,
  } satisfies CSSProperties,

  // Step 6: each icon+count+label group
  statItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  // Step 9: segmented toggle control container (replaces individual-bordered pills)
  toggleGroup: {
    display: "flex",
    gap: 2,
    background: "var(--bg-surface)",
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--border)",
    borderRadius: 7,
    padding: 2,
    flexShrink: 0,
  } satisfies CSSProperties,

  // Step 9: toggle button — no individual border; textTransform capitalize handles casing
  toggleBtn: {
    padding: "3px 10px",
    fontSize: 11.5,
    fontWeight: 600,
    borderRadius: 5,
    borderStyle: "none",
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
    textTransform: "capitalize" as const,
  } satisfies CSSProperties,

  // Step 9: active state — subtle bg-elevated, not bright accent
  toggleBtnActive: {
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  degradedBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 4,
    background: "rgba(245, 158, 11, 0.12)",
    color: "var(--warn)",
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
    margin: "0 16px 10px",
  } satisfies CSSProperties,

  emptyState: {
    padding: "20px 16px",
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic" as const,
    textAlign: "center" as const,
  } satisfies CSSProperties,

  tree: {
    padding: "0 0 8px",
  } satisfies CSSProperties,

  noCallersNote: {
    padding: "10px 16px",
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic" as const,
  } satisfies CSSProperties,

  symbolRow: {
    padding: "8px 16px 4px",
    borderTopStyle: "solid" as const,
    borderTopWidth: 1,
    borderTopColor: "var(--border)",
  } satisfies CSSProperties,

  // Step 7: collapsible symbol header row — minWidth:0 so long paths ellipsis
  symbolHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  } satisfies CSSProperties,

  // Step 7: chevron toggle button
  chevronBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    borderStyle: "none",
    padding: 2,
    cursor: "pointer",
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,

  // Step 7: code chip container (Code icon + monospace name) — flexShrink:0 so
  // it never compresses when the file path is long.
  symbolChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  } satisfies CSSProperties,

  symbolName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,

  symbolFile: {
    fontSize: 11,
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono, monospace)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    minWidth: 0,
    flexShrink: 1,
  } satisfies CSSProperties,

  // Step 7: per-symbol caller count — right-aligned plain muted text, not a pill
  symbolCount: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
    flexShrink: 0,
    whiteSpace: "nowrap" as const,
  } satisfies CSSProperties,

  callerList: {
    listStyle: "none",
    margin: "4px 0 0",
    padding: "0 16px 0 28px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    overflowX: "auto" as const,
  } satisfies CSSProperties,

  callerItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    whiteSpace: "nowrap" as const,
    minWidth: 0,
  } satisfies CSSProperties,

  // Step 7: leading CornerDownRight connector — separate element keeps file:line as own text node
  callerConnector: {
    display: "inline-flex",
    alignItems: "center",
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,

  callerLink: {
    color: "var(--accent)",
    textDecoration: "none",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    whiteSpace: "nowrap" as const,
  } satisfies CSSProperties,

  callerLinkPlain: {
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    whiteSpace: "nowrap" as const,
  } satisfies CSSProperties,

  // Step 9: badge upgraded to design spec (padding, radius, fontSize, gap)
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11.5,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 5,
  } satisfies CSSProperties,

  // Step 9: endpoint badge — accent-text on accent-bg
  endpointBadge: {
    background: "var(--accent-bg, rgba(59, 130, 246, 0.12))",
    color: "var(--accent-text, var(--accent))",
  } satisfies CSSProperties,

  // Step 9: cron badge — amber (was purple)
  cronBadge: {
    background: "var(--warn-bg, rgba(245, 158, 11, 0.12))",
    color: "var(--warn)",
  } satisfies CSSProperties,

  summarySection: {
    padding: "10px 16px 12px",
    borderTopStyle: "solid" as const,
    borderTopWidth: 1,
    borderTopColor: "var(--border)",
  } satisfies CSSProperties,

  summaryText: {
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
    margin: "8px 0 0",
  } satisfies CSSProperties,

  summaryBtn: {
    fontSize: 12,
    padding: "3px 10px",
    borderRadius: 5,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
