import type { CSSProperties } from "react";

export const st = {
  // Page-level padding — AppFrame's <main> has none, so each page supplies its
  // own gutter (matches the PR list's "24px 32px" convention).
  page: { padding: "24px 32px 44px" } as CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 24,
  } as CSSProperties,
  title: { margin: 0, fontSize: 24, fontWeight: 700, color: "var(--text-primary)" } as CSSProperties,
  titleRepo: { color: "var(--accent)", marginLeft: 8 } as CSSProperties,
  subtitle: { margin: "6px 0 0", fontSize: 13.5, color: "var(--text-tertiary, #8a8f98)" } as CSSProperties,
  headerActions: { display: "flex", gap: 10, flexShrink: 0 } as CSSProperties,
  stack: { display: "flex", flexDirection: "column", gap: 14 } as CSSProperties,
};
