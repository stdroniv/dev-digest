"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  ConfidenceNum,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";

/**
 * Hover card that lists the findings behind a PR's FINDINGS counters: a
 * "{n} findings" header, then one compact row per finding (severity badge +
 * title + category, file:line + confidence, a 2-line rationale preview). Pure
 * presentation — the caller supplies the (already aggregated + sorted) findings,
 * the authoritative `total` for the header, and a `loading` flag. Reuses the
 * same primitives as the detail page's FindingCard so the two read identically.
 */

const MAX_ROWS = 6;

/** Strip the bits of markdown that would show as literal punctuation in a
 *  single-line preview (the full rationale renders as markdown on the detail
 *  page; here it's a plain 2-line teaser). */
function previewText(md: string): string {
  return md
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lineLabel(f: FindingRecord): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

export function FindingsPopover({
  total,
  findings,
  loading,
  headerLabel,
}: {
  total: number;
  findings: FindingRecord[];
  loading?: boolean;
  /** Override the header/aria text (defaults to "{count} findings"). The
   *  Agent-runs timeline passes "{count} findings in this run". */
  headerLabel?: string;
}) {
  const t = useTranslations("prReview");
  const shown = findings.slice(0, MAX_ROWS);
  const header = headerLabel ?? t("findings.summaryCount", { count: total });

  return (
    <div
      role="dialog"
      aria-label={header}
      style={{
        width: 560,
        maxWidth: "min(560px, 90vw)",
        maxHeight: 420,
        overflowY: "auto",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 8,
        }}
      >
        <Icon.Info size={13} />
        {header}
      </div>

      {loading && findings.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "6px 0" }}>
          {t("findings.loading")}
        </div>
      ) : (
        shown.map((f, i) => (
          <div
            key={f.id}
            style={{
              padding: "9px 0",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <SeverityBadge severity={f.severity as Severity} compact />
              <span
                style={{
                  fontSize: 13.5,
                  fontWeight: 650,
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.title}
              </span>
              <CategoryTag category={f.category as Category} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "3px 0 4px" }}>
              <span
                className="mono"
                style={{ fontSize: 12.5, color: "var(--accent-text)" }}
              >
                {f.file}:{lineLabel(f)}
              </span>
              <ConfidenceNum value={f.confidence} />
            </div>
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.45,
                color: "var(--text-secondary)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {previewText(f.rationale)}
            </div>
          </div>
        ))
      )}

      {findings.length > MAX_ROWS && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", paddingTop: 8 }}>
          {t("findings.more", { count: findings.length - MAX_ROWS })}
        </div>
      )}
    </div>
  );
}
