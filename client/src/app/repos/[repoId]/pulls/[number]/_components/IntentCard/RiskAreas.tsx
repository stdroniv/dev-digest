"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, MonoLink } from "@devdigest/ui";
import type { RiskSeverity } from "@devdigest/shared";
import { useRisks } from "@/lib/hooks/brief";
import { githubPrFileUrl } from "@/lib/github-urls";
import { s, severityColor } from "./styles";

/** Severity → icon name (all three confirmed present in vendor/ui/icons.tsx). */
const RISK_ICON: Record<RiskSeverity, keyof typeof Icon> = {
  high:   "AlertOctagon",
  medium: "AlertTriangle",
  low:    "Info",
};

/** Split a `path:line` ref on the LAST colon so a path with no colon still
 *  yields a usable path (and so a Windows-style path is unaffected — there
 *  are none in this repo's refs, but splitting on the FIRST colon would be
 *  wrong the moment a path itself ever contained one). */
function parsePath(ref: string): string {
  const idx = ref.lastIndexOf(":");
  return idx === -1 ? ref : ref.slice(0, idx);
}

interface RiskAreasProps {
  prId: string | null | undefined;
  repoFullName: string | null | undefined;
  prNumber: number;
}

/**
 * RiskAreas — co-located section rendered inside the Intent card body.
 *
 * Each risk's title is always visible with its longer `explanation` exposed
 * only as a hover tooltip (native `title`/`aria-label`); its `file_refs` are
 * always-visible clickable links to the PR's Files-changed diff at `path:line`
 * (AC-7/AC-8) — no click-to-reveal accordion. Returns null when loading or
 * when there are no risks.
 */
export function RiskAreas({ prId, repoFullName, prNumber }: RiskAreasProps) {
  const t = useTranslations("brief");
  const { data: risks, isLoading } = useRisks(prId);

  // While loading → return null (intent body above holds the card's height).
  if (isLoading) return null;

  // No risks → return null (no bare "RISK AREAS" label).
  if (!risks || risks.risks.length === 0) return null;

  const canLink = Boolean(repoFullName) && Number.isFinite(prNumber);

  return (
    <>
      {/* Top divider — reuses the existing IntentCard divider style */}
      <div style={s.divider} />

      <div style={s.riskAreasSection}>
        {/* Sub-label styled like scopeLabel */}
        <p style={s.scopeLabel}>{t("riskAreas")}</p>

        <ul style={s.riskList}>
          {risks.risks.map((r, i) => {
            const sev = r.severity;
            const SevIcon = Icon[RISK_ICON[sev]];

            return (
              <li key={i} style={s.riskItem}>
                <span
                  style={{
                    ...s.riskTitle,
                    color: severityColor[sev].c,
                  }}
                  title={r.explanation}
                  aria-label={r.explanation}
                >
                  <SevIcon size={12} aria-hidden="true" />
                  <span style={s.riskChipTitle}>{r.title}</span>
                </span>

                {r.file_refs.length > 0 && (
                  <div style={s.riskFileRefs}>
                    {r.file_refs.map((ref, j) =>
                      canLink ? (
                        <MonoLink
                          key={j}
                          href={githubPrFileUrl(
                            repoFullName as string,
                            prNumber,
                            parsePath(ref),
                          )}
                        >
                          {ref}
                        </MonoLink>
                      ) : (
                        <span key={j} style={s.riskFileRef}>
                          <Icon.FileText size={11} aria-hidden="true" /> {ref}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
