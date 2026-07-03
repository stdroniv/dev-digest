import type { CSSProperties } from "react";

/** Co-located styles for SmartDiffViewer. */
export const s = {
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,

  groupBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,

  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
    padding: "0 2px",
  } satisfies CSSProperties,

  roleIndicator: {
    width: 10,
    height: 10,
    borderRadius: 2,
    flexShrink: 0,
  } satisfies CSSProperties,

  roleLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  roleDesc: {
    fontSize: 12,
    color: "var(--text-muted)",
    flex: 1,
  } satisfies CSSProperties,

  roleCount: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,

  fileCard: {
    borderRadius: 7,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--border)",
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  fileHeader: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
    userSelect: "none" as const,
  } satisfies CSSProperties,

  summaryToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    background: "transparent",
    color: "var(--accent-text)",
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--accent)",
    flexShrink: 0,
  } satisfies CSSProperties,

  summaryLineWrap: {
    flexBasis: "100%",
    marginTop: 8,
  } satisfies CSSProperties,

  summaryLine: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 6,
    fontSize: 12,
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
  } satisfies CSSProperties,

  summaryStale: {
    fontSize: 11,
    color: "var(--text-muted)",
    fontStyle: "italic" as const,
  } satisfies CSSProperties,

  summaryRegenerate: {
    marginLeft: "auto",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--accent-text)",
    background: "transparent",
    borderStyle: "none" as const,
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline" as const,
  } satisfies CSSProperties,

  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } satisfies CSSProperties,

  fileStat: { fontSize: 12 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,

  fileBody: {
    borderTopStyle: "solid",
    borderTopWidth: 1,
    borderTopColor: "var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,

  lineRow: {
    display: "flex",
    alignItems: "stretch",
    fontSize: 13,
    lineHeight: "20px",
  } satisfies CSSProperties,

  lineNo: {
    width: 44,
    textAlign: "right" as const,
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none" as const,
    flexShrink: 0,
  } satisfies CSSProperties,

  lineSign: {
    width: 14,
    textAlign: "center" as const,
    flexShrink: 0,
  } satisfies CSSProperties,

  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,

  findingHighlight: {
    background: "var(--code-del)",
  } satisfies CSSProperties,

  splitBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 7,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--warn)",
    background: "var(--code-del)",
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 4,
  } satisfies CSSProperties,

  empty: {
    padding: "24px",
    fontSize: 14,
    color: "var(--text-muted)",
    textAlign: "center" as const,
  } satisfies CSSProperties,
} as const;
