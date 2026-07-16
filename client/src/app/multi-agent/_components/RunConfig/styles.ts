/* RunConfig/styles.ts — co-located style map for the Configure-run subtree
   (SPEC-05, T14). Values are a faithful port of the mock `RunConfig` +
   `PersonaPickCard` (`8bb91114:93-148`). Colour/PR-conditional and per-agent
   (agent-colour) fragments are composed inline at the call site since they
   depend on runtime state — everything static lives here. */
import type { CSSProperties } from "react";

export const s = {
  // ---- RunConfig shell ----
  root: { padding: "24px 28px 40px", maxWidth: 720, margin: "0 auto" },
  title: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" },
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4, marginBottom: 22 },

  // ---- step header (circle + label + optional select-all) ----
  stepRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 99,
    fontSize: 12,
    fontWeight: 700,
    display: "grid",
    placeItems: "center",
  },
  stepLabel: { fontSize: 13.5, fontWeight: 600 },
  selectAllBtn: {
    marginLeft: "auto",
    border: "none",
    background: "transparent",
    color: "var(--accent-text)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },

  // ---- step 1 body (PR dropdown slot) ----
  prSlot: { marginLeft: 32, marginBottom: 24 },

  // ---- step 2 body ----
  agentList: { marginLeft: 32, display: "flex", flexDirection: "column", gap: 8 },

  // dashed "pick a PR first" empty state (mock `8bb91114:137-141`)
  emptyBox: {
    marginLeft: 32,
    padding: "34px 20px",
    borderRadius: 10,
    border: "1px dashed var(--border-strong)",
    background: "var(--bg-elevated)",
    textAlign: "center",
  },
  emptyIconTile: {
    width: 42,
    height: 42,
    borderRadius: 11,
    background: "var(--bg-hover)",
    display: "grid",
    placeItems: "center",
    margin: "0 auto 12px",
  },
  emptyTitle: { fontSize: 14, fontWeight: 600 },
  emptyBody: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginTop: 5,
    maxWidth: 320,
    marginInline: "auto",
    lineHeight: 1.5,
  },

  // ---- run bar ----
  runBar: { display: "flex", alignItems: "center", gap: 14, marginTop: 26, marginLeft: 32 },
  estimate: { fontSize: 11.5, color: "var(--text-muted)" },

  // ---- PersonaPickCard (mock `8bb91114:93-105`) ----
  card: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 9,
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    transition: "border-color .12s, background .12s",
  },
  cardCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    flexShrink: 0,
    marginTop: 1,
    display: "grid",
    placeItems: "center",
  },
  cardIconTile: {
    width: 30,
    height: 30,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  cardText: { minWidth: 0, flex: 1 },
  cardName: { display: "block", fontSize: 13.5, fontWeight: 600 },
  cardSummary: {
    display: "block",
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginTop: 3,
    lineHeight: 1.45,
  },
  cardGuideline: {
    fontSize: 10.5,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
} satisfies Record<string, CSSProperties>;
