import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 20,
  } satisfies CSSProperties,
  title: { fontSize: 20, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em" } satisfies CSSProperties,
  subline: { fontSize: 13, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } satisfies CSSProperties,
};
