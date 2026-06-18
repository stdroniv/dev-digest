"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import type { SeverityCounts } from "@devdigest/shared";

/**
 * Compact per-severity findings counters (🔴 critical · 🟡 warning · 🔵
 * suggestion), shown on the PR list's FINDINGS column and on each Agent-runs
 * timeline row. Only NON-ZERO severities render (icon + number, no pill); a
 * never-reviewed PR/run (`null` counts) or an all-zero tally shows a muted "—".
 *
 * Colours/icons reuse the shared `SEV` tokens so the counters match the finding
 * cards. The whole group carries an aria-label for screen readers (the icons
 * alone aren't announced).
 */

const ORDER = [
  { key: "critical", sev: "CRITICAL" },
  { key: "warning", sev: "WARNING" },
  { key: "suggestion", sev: "SUGGESTION" },
] as const;

export function FindingsCounts({
  counts,
  className,
}: {
  counts?: SeverityCounts | null;
  className?: string;
}) {
  const t = useTranslations("prReview");
  const total = counts ? counts.critical + counts.warning + counts.suggestion : 0;

  if (!counts || total === 0) {
    return (
      <span style={{ color: "var(--text-muted)" }} className={className}>
        —
      </span>
    );
  }

  const label = t("findings.countsLabel", {
    critical: counts.critical,
    warning: counts.warning,
    suggestion: counts.suggestion,
  });

  return (
    <span
      className={className}
      aria-label={label}
      style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
    >
      {ORDER.map(({ key, sev }) => {
        const n = counts[key];
        if (n <= 0) return null;
        const meta = SEV[sev];
        const I = Icon[meta.icon];
        return (
          <span
            key={key}
            aria-hidden
            style={{ display: "inline-flex", alignItems: "center", gap: 3, color: meta.c }}
          >
            <I size={13} />
            <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {n}
            </span>
          </span>
        );
      })}
    </span>
  );
}
