"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { useRisks } from "@/lib/hooks/brief";
import { s, severityColor } from "./styles";

/**
 * RisksCard — shows the PR's risk areas on the Overview tab.
 *
 * Displays: a list of risks with severity badge, title, explanation,
 * and file references. Shows an empty state when no risks have been
 * computed yet (or the brief has no risks).
 */
export function RisksCard({ prId }: { prId: string | null | undefined }) {
  const t = useTranslations("brief");
  const { data: risks, isLoading } = useRisks(prId);

  if (isLoading) {
    return null;
  }

  return (
    <section>
      <SectionLabel icon="AlertTriangle">{t("block.risks")}</SectionLabel>
      <div style={s.card}>
        {!risks || risks.risks.length === 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "14px 16px",
            }}
          >
            <span style={s.emptyState}>{t("noRisks")}</span>
          </div>
        ) : (
          <div style={s.riskList}>
            {risks.risks.map((r, i) => (
              <div key={i} style={s.riskItem}>
                <div style={s.riskHeader}>
                  <span
                    style={{
                      ...s.badge,
                      color: severityColor[r.severity].c,
                      background: severityColor[r.severity].bg,
                    }}
                  >
                    {t(`risks.${r.severity}`)}
                  </span>
                  <span style={s.title}>{r.title}</span>
                </div>
                <p style={s.explanation}>{r.explanation}</p>
                {r.file_refs.length > 0 && (
                  <div style={s.fileRefs}>
                    {r.file_refs.map((ref, j) => (
                      <span key={j} style={s.fileRef}>
                        {ref}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
