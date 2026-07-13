import type { CSSProperties } from "react";
import type { AgentColumn } from "@devdigest/shared";

/** Co-located styles for the Tabs + detail view (design `8bb91114` `TabsView`,
 *  lines ~67-91) and the multi-agent finding card. Honest overrides live in the
 *  components (SUM totals, 75/50 score threshold); this file is layout only. */
export const s = {
  root: { padding: "0 0 40px" } satisfies CSSProperties,

  // --- tab strip ---
  tabBar: {
    display: "flex",
    gap: 2,
    padding: "0 28px",
    borderBottom: "1px solid var(--border)",
    overflowX: "auto",
  } satisfies CSSProperties,
  tab: (on: boolean, color: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    border: "none",
    background: "transparent",
    // active tab underlined in the agent's own color (AC-21)
    borderBottom: "2px solid " + (on ? color : "transparent"),
    marginBottom: -1,
    cursor: "pointer",
    whiteSpace: "nowrap",
  }),
  tabName: (on: boolean): CSSProperties => ({
    fontSize: 13,
    fontWeight: on ? 600 : 500,
    color: on ? "var(--text-primary)" : "var(--text-secondary)",
  }),
  tabScore: (color: string): CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    color,
  }),
  statusDot: (status: AgentColumn["status"]): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: 99,
    flexShrink: 0,
    background:
      status === "failed"
        ? "var(--crit)"
        : status === "running"
          ? "var(--accent)"
          : "var(--text-muted)",
  }),

  // --- detail panel ---
  detailWrap: { padding: "20px 28px", maxWidth: 760 } satisfies CSSProperties,
  detailCard: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 18,
    borderLeft: "3px solid " + color,
  }),
  detailIdentity: { minWidth: 0, flex: 1 } satisfies CSSProperties,
  detailName: (color: string): CSSProperties => ({
    fontSize: 14,
    fontWeight: 600,
    color,
  }),
  detailSummary: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 4,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  detailMeta: {
    marginLeft: "auto",
    textAlign: "right",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    alignItems: "flex-end",
  } satisfies CSSProperties,
  detailMetaMono: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,

  findingList: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
} as const;

/** Styles for the multi-agent finding card (follows FindingCard's composition
 *  but always-expanded, and adds Learn + Turn-into-eval-case). */
export const fc = {
  card: (sevColor: string, muted: boolean): CSSProperties => ({
    borderRadius: 8,
    borderStyle: "solid",
    borderTopColor: "var(--border)",
    borderRightColor: "var(--border)",
    borderBottomColor: "var(--border)",
    borderWidth: 1,
    borderLeftWidth: 3,
    borderLeftColor: sevColor,
    background: "var(--bg-elevated)",
    overflow: "hidden",
    opacity: muted ? 0.72 : 1,
    transition: "opacity .2s",
  }),
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "14px 16px 0",
  } satisfies CSSProperties,
  headerMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: (dismissed: boolean): CSSProperties => ({
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    textDecoration: dismissed ? "line-through" : "none",
  }),
  tag: (color: string): CSSProperties => ({ fontSize: 12, fontWeight: 600, color }),
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 5,
  } satisfies CSSProperties,
  body: { padding: "12px 16px 16px" } satisfies CSSProperties,
  section: { marginTop: 12 } satisfies CSSProperties,
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    marginBottom: 6,
    textTransform: "uppercase",
  } satisfies CSSProperties,
  prose: {
    fontSize: 13.5,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    marginTop: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
} as const;
