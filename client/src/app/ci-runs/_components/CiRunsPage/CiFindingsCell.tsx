"use client";

import React from "react";
import { Icon, SEV } from "@devdigest/ui";
import type { SeverityCounts } from "@devdigest/shared";

const ORDER = [
  { key: "critical", sev: "CRITICAL" },
  { key: "warning", sev: "WARNING" },
  { key: "suggestion", sev: "SUGGESTION" },
] as const;

/**
 * The CI Runs FINDINGS cell (AC-35): per-severity count chips (CRITICAL /
 * WARNING / SUGGESTION), reusing the client's existing `SEV` severity color
 * tokens (mirrors `components/FindingsCounts`) rather than inventing a new
 * palette. Only non-zero severities render; a null/all-zero tally shows "—".
 */
export function CiFindingsCell({ counts }: { counts?: SeverityCounts | null }) {
  const total = counts ? counts.critical + counts.warning + counts.suggestion : 0;

  if (!counts || total === 0) {
    return <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>;
  }

  return (
    <div style={{ display: "flex", gap: 7 }}>
      {ORDER.map(({ key, sev }) => {
        const n = counts[key];
        if (n <= 0) return null;
        const meta = SEV[sev];
        const I = Icon[meta.icon];
        return (
          <span
            key={key}
            aria-label={`${n} ${sev}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 11.5,
              fontWeight: 600,
              color: meta.c,
            }}
          >
            <I size={12} />
            <span className="tnum">{n}</span>
          </span>
        );
      })}
    </div>
  );
}
