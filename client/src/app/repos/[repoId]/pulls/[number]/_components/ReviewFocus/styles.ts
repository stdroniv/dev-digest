import type { CSSProperties } from "react";

/** Co-located styles for ReviewFocus. Mirrors IntentCard/PriorPrs's card shell. */
export const s = {
  card: {
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,

  // In-card header (icon + uppercase title + optional count badge) — replaces the
  // external SectionLabel so the "Read these first" title is part of the card,
  // mirroring SectionLabel's type treatment.
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  cardHeaderTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  // Count badge — mirrors PriorPrs's s.countBadge.
  countBadge: {
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

  list: {
    listStyle: "decimal",
    margin: 0,
    padding: "10px 16px 14px 32px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  } satisfies CSSProperties,

  listItem: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  reason: {
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  emptyWrap: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    padding: "40px 20px",
    gap: 8,
  } satisfies CSSProperties,

  emptyIconBox: {
    width: 40,
    height: 40,
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    background: "var(--bg-surface)",
    borderStyle: "solid" as const,
    borderWidth: 1,
    borderColor: "var(--border)",
    color: "var(--text-muted)",
    marginBottom: 4,
  } satisfies CSSProperties,

  emptyHeading: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,

  emptySubtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    maxWidth: 280,
    lineHeight: 1.5,
    margin: 0,
  } satisfies CSSProperties,
} as const;
