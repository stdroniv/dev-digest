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
  } satisfies CSSProperties,

  statRow: {
    fontSize: 13,
    color: "var(--text-muted)",
    flex: 1,
  } satisfies CSSProperties,

  toggleGroup: {
    display: "flex",
    gap: 4,
    flexShrink: 0,
  } satisfies CSSProperties,

  toggleBtn: {
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

  toggleBtnActive: {
    background: "var(--accent)",
    borderColor: "var(--accent)",
    color: "#fff",
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

  symbolRow: {
    padding: "8px 16px 4px",
    borderTopStyle: "solid" as const,
    borderTopWidth: 1,
    borderTopColor: "var(--border)",
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
    marginLeft: 6,
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,

  symbolKind: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    background: "var(--bg-sunken)",
    padding: "1px 5px",
    borderRadius: 3,
    marginLeft: 8,
  } satisfies CSSProperties,

  callerList: {
    listStyle: "none",
    margin: "4px 0 0",
    padding: "0 16px 0 28px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
  } satisfies CSSProperties,

  callerItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
  } satisfies CSSProperties,

  callerLink: {
    color: "var(--accent)",
    textDecoration: "none",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
  } satisfies CSSProperties,

  callerLinkPlain: {
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
  } satisfies CSSProperties,

  badge: {
    display: "inline-flex",
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 6px",
    borderRadius: 3,
    marginLeft: 4,
  } satisfies CSSProperties,

  endpointBadge: {
    background: "rgba(59, 130, 246, 0.12)",
    color: "var(--accent)",
  } satisfies CSSProperties,

  cronBadge: {
    background: "rgba(139, 92, 246, 0.12)",
    color: "var(--purple, #8b5cf6)",
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
