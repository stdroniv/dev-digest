import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 820 } as CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 6 } as CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } as CSSProperties,
  filter: {
    marginLeft: "auto",
    width: 200,
    padding: "6px 10px",
    fontSize: 13,
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
  } as CSSProperties,
  orderHint: { fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 } as CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 6 } as CSSProperties,
  row: (attached: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "9px 12px",
    borderRadius: 9,
    border: `1px solid ${attached ? "var(--accent)" : "var(--border)"}`,
    background: attached ? "var(--bg-hover)" : "var(--bg-elevated)",
    cursor: "grab",
  }),
  handle: { color: "var(--text-muted)", display: "inline-flex", cursor: "grab" } as CSSProperties,
  name: { flex: 1, fontSize: 13, color: "var(--text-primary)" } as CSSProperties,
} as const;
