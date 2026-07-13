import type { CSSProperties } from "react";
import { POPOVER_WIDTH } from "./constants";

/** Co-located inline styles for AgentPicker — pixel-faithful to the design mock's
 *  `RunReviewDropdown` popover (only the copy/behaviour changed to honest). */
export const s = {
  root: { position: "relative", display: "inline-block" },

  popover: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    zIndex: 30,
    width: POPOVER_WIDTH,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 10,
    boxShadow: "0 14px 40px rgba(0,0,0,.4)",
    overflow: "hidden",
  },

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "11px 14px 8px",
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  },
  selectAllBtn: {
    border: "none",
    background: "transparent",
    color: "var(--accent-text)",
    fontSize: 11.5,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
  },

  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 14px",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  },
  rowName: { fontSize: 13, fontWeight: 500, flex: 1 },
  rowGuide: { fontSize: 10.5, color: "var(--text-muted)" },

  runBar: {
    padding: "10px 14px",
    borderTop: "1px solid var(--border)",
    marginTop: 4,
  },

  configureBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "9px 14px",
    border: "none",
    borderTop: "1px solid var(--border)",
    background: "transparent",
    cursor: "pointer",
    color: "var(--text-muted)",
    fontSize: 12,
    fontFamily: "inherit",
  },
} satisfies Record<string, CSSProperties>;

/** The bespoke 16px checkbox square inside each agent row (mock lines 51-53). */
export function checkboxStyle(on: boolean): CSSProperties {
  return {
    width: 16,
    height: 16,
    borderRadius: 4,
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    border: "1.5px solid " + (on ? "var(--accent)" : "var(--border-strong)"),
    background: on ? "var(--accent)" : "transparent",
  };
}

/** Row background: highlighted while hovered (mock hover behaviour). */
export function rowStyle(hovered: boolean): CSSProperties {
  return { ...s.row, background: hovered ? "var(--bg-hover)" : "transparent" };
}
