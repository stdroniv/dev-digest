"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { RiskSeverity } from "@devdigest/shared";
import { useRisks } from "@/lib/hooks/brief";
import { s, severityColor } from "./styles";

/** Severity → icon name (all three confirmed present in vendor/ui/icons.tsx). */
const RISK_ICON: Record<RiskSeverity, keyof typeof Icon> = {
  high:   "AlertOctagon",
  medium: "AlertTriangle",
  low:    "Info",
};

interface RiskAreasProps {
  prId: string | null | undefined;
}

/**
 * RiskAreas — co-located chip component rendered inside the Intent card body.
 *
 * Shows severity-tinted chips for each risk. Clicking a chip pins its detail
 * open (single-open accordion via `openIdx`). Hover/focus transiently reveals
 * the same detail (`hoverIdx`). `aria-expanded` reflects only the pinned state
 * so screen readers report the deliberate toggle, while mouse/focus users get
 * the transient reveal. Returns null when loading or when there are no risks.
 */
export function RiskAreas({ prId }: RiskAreasProps) {
  const t = useTranslations("brief");
  const { data: risks, isLoading } = useRisks(prId);
  const [openIdx, setOpenIdx] = React.useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);

  // While loading → return null (intent body above holds the card's height).
  if (isLoading) return null;

  // No risks → return null (no bare "RISK AREAS" label).
  if (!risks || risks.risks.length === 0) return null;

  return (
    <>
      {/* Top divider — reuses the existing IntentCard divider style */}
      <div style={s.divider} />

      <div style={s.riskAreasSection}>
        {/* Sub-label styled like scopeLabel */}
        <p style={s.scopeLabel}>{t("riskAreas")}</p>

        <div style={s.riskChipRow}>
          {risks.risks.map((r, i) => {
            const sev = r.severity;
            const open = openIdx === i || hoverIdx === i;
            const detailId = `risk-detail-${String(prId)}-${i}`;
            const SevIcon = Icon[RISK_ICON[sev]];

            return (
              <div key={i} style={s.riskChipWrap}>
                <button
                  type="button"
                  style={{
                    ...s.riskChip,
                    color: severityColor[sev].c,
                    background: severityColor[sev].bg,
                    borderColor: severityColor[sev].c,
                  }}
                  aria-expanded={openIdx === i}
                  aria-controls={detailId}
                  title={r.explanation}
                  onClick={() => setOpenIdx(openIdx === i ? null : i)}
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx((h) => (h === i ? null : h))}
                  onFocus={() => setHoverIdx(i)}
                  onBlur={() => setHoverIdx((h) => (h === i ? null : h))}
                >
                  <SevIcon size={12} aria-hidden="true" />
                  <span style={s.riskChipTitle}>{r.title}</span>
                </button>

                {open && (
                  <div id={detailId} role="region" aria-label={r.title} style={s.riskDetail}>
                    <p style={s.riskExplanation}>{r.explanation}</p>
                    {r.file_refs.length > 0 && (
                      <div style={s.riskFileRefs}>
                        {r.file_refs.map((ref, j) => (
                          <span key={j} style={s.riskFileRef}>
                            <Icon.FileText size={11} aria-hidden="true" /> {ref}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
