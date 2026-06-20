/* SeverityFilter — the per-run findings counters that double as a filter.
   Click a severity to show only its findings inline; click the active one again
   to clear. Reuses the shared SEV/Icon tokens (same source as the PR-list
   FindingsCounts badge) so colors/icons stay consistent. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";
import { SEVERITY_FILTERS } from "./constants";
import { s } from "./styles";

export function SeverityFilter({
  counts,
  active,
  onChange,
}: {
  counts: Record<Severity, number>;
  active: Severity | null;
  onChange: (sev: Severity | null) => void;
}) {
  const t = useTranslations("prReview");

  return (
    <div
      style={s.filterGroup}
      role="group"
      aria-label={t("panel.severityFilterGroupLabel")}
    >
      {SEVERITY_FILTERS.map((sev) => {
        const n = counts[sev] ?? 0;
        const meta = SEV[sev];
        const I = Icon[meta.icon];
        const isActive = active === sev;
        const disabled = n === 0;
        return (
          <button
            key={sev}
            type="button"
            aria-pressed={isActive}
            aria-label={t("panel.filterSeverity", { severity: meta.label, count: n })}
            disabled={disabled}
            onClick={() => onChange(isActive ? null : sev)}
            style={{
              ...s.chip,
              color: meta.c,
              borderColor: isActive ? meta.c : "var(--border)",
              background: isActive ? meta.bg : "transparent",
              ...(disabled ? s.chipDisabled : null),
            }}
          >
            <I size={13} aria-hidden />
            <span className="tnum">{n}</span>
            <span>{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
