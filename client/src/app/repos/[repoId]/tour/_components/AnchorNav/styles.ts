import type { CSSProperties } from "react";

export const s = {
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    position: "sticky",
    top: 24,
    alignSelf: "flex-start",
    minWidth: 180,
  } satisfies CSSProperties,
  heading: {
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "var(--text-muted)",
    padding: "0 10px",
    marginBottom: 4,
  } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 1 } satisfies CSSProperties,
  item: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "6px 10px",
    borderRadius: 6,
    border: "none",
    background: "none",
    fontSize: 13,
    color: "var(--text-secondary)",
    cursor: "pointer",
  } satisfies CSSProperties,
  itemActive: {
    background: "var(--bg-hover)",
    color: "var(--text-primary)",
    fontWeight: 600,
  } satisfies CSSProperties,
};
