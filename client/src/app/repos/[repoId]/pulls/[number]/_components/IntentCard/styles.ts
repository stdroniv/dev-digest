import type { CSSProperties } from "react";

/** Co-located styles for IntentCard. */
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
    padding: "14px 16px 10px",
    gap: 12,
  } satisfies CSSProperties,

  summaryText: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--text-primary)",
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,

  scopeSection: {
    padding: "0 16px 14px",
  } satisfies CSSProperties,

  scopeLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    marginBottom: 6,
    marginTop: 10,
  } satisfies CSSProperties,

  scopeList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
  } satisfies CSSProperties,

  scopeItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  scopeBullet: {
    color: "var(--text-muted)",
    flexShrink: 0,
    marginTop: 1,
  } satisfies CSSProperties,

  emptyState: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic" as const,
  } satisfies CSSProperties,

  divider: {
    borderTop: "1px solid var(--border)",
    margin: "0 16px",
  } satisfies CSSProperties,
} as const;
