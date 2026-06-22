import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 760 } as CSSProperties,
  header: { display: "flex", alignItems: "center", marginBottom: 20 } as CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 10, flex: 1 } as CSSProperties,
  enabledLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
  } as CSSProperties,
  bodyLabel: { display: "inline-flex", alignItems: "center", gap: 8 } as CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 12, marginTop: 8 } as CSSProperties,
  savedNote: { fontSize: 12, color: "var(--ok)" } as CSSProperties,
  deleteBtn: { marginLeft: "auto" } as CSSProperties,
} as const;
