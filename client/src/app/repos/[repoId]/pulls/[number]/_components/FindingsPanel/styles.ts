import type { CSSProperties } from "react";

/** Co-located styles for FindingsPanel (extracted from inline styles). */
export const s = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  divider: {
    width: 1,
    height: 18,
    background: "var(--border)",
    margin: "0 2px",
  } satisfies CSSProperties,
  toggleGroup: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  filterGroup: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 9px",
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    background: "transparent",
    fontSize: 12.5,
    fontWeight: 600,
    lineHeight: 1,
    cursor: "pointer",
    transition: "background .12s, border-color .12s, opacity .12s",
  } satisfies CSSProperties,
  chipDisabled: {
    cursor: "default",
    opacity: 0.45,
  } satisfies CSSProperties,
} as const;
