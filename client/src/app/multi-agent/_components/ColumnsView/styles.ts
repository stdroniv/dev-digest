import type { CSSProperties } from "react";

import type { AgentColumn } from "@devdigest/shared";

/** Co-located styles for the Columns view (ported from the design mock's
 *  `ColumnsView` / `AgentColHeader` / `AgentFindingMini`, `8bb91114`:3-19,52-65).
 *  Dynamic values (grid track count, agent colour, severity colour) are computed
 *  by the helper fns; the rest are static objects. */

/** Status → dot/label colour for the live per-agent header state (AC-31/33). */
export const STATUS_COLOR: Record<AgentColumn["status"], string> = {
  running: "var(--accent)",
  done: "var(--ok)",
  failed: "var(--crit)",
};

export const s = {
  wrapper: { padding: "20px 28px 40px" } as CSSProperties,

  grid: (cols: number, scroll: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: `repeat(${cols}, minmax(220px, 1fr))`,
    gap: 12,
    overflowX: scroll ? "auto" : "visible",
  }),

  column: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  } as CSSProperties,

  /** 2px top border in the agent colour (design `8bb91114`:58). */
  header: (color: string): CSSProperties => ({
    padding: 12,
    borderBottom: "1px solid var(--border)",
    borderTop: `2px solid ${color}`,
  }),

  body: {
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 7,
    flex: 1,
  } as CSSProperties,

  emptyBody: {
    fontSize: 11.5,
    color: "var(--text-muted)",
  } as CSSProperties,

  footer: {
    padding: "9px 12px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } as CSSProperties,

  count: {
    fontSize: 11,
    color: "var(--text-muted)",
  } as CSSProperties,

  // --- AgentColHeader --------------------------------------------------------
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 9,
  } as CSSProperties,

  iconTile: (color: string): CSSProperties => ({
    width: 30,
    height: 30,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    background: `${color}1f`,
    color,
    flexShrink: 0,
  }),

  nameBlock: {
    minWidth: 0,
    flex: 1,
  } as CSSProperties,

  name: {
    fontSize: 12.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } as CSSProperties,

  sub: {
    fontSize: 10.5,
    color: "var(--text-muted)",
  } as CSSProperties,

  statusBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
  } as CSSProperties,

  statusDot: (color: string): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: 99,
    background: color,
    flexShrink: 0,
  }),

  statusLabel: (color: string): CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    color,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  }),

  // --- AgentFindingMini ------------------------------------------------------
  finding: (sevColor: string): CSSProperties => ({
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--bg-surface)",
    borderLeft: `2px solid ${sevColor}`,
  }),

  findingLink: {
    display: "block",
    color: "inherit",
    textDecoration: "none",
  } as CSSProperties,

  findingTop: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } as CSSProperties,

  findingTitle: {
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.3,
  } as CSSProperties,

  findingLoc: {
    fontSize: 10.5,
    color: "var(--text-muted)",
    marginTop: 4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as CSSProperties,
};
