"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, FormField, TextInput, Icon } from "@devdigest/ui";
import type { CiTarget } from "@devdigest/shared";
import { CI_TARGETS } from "./constants";
import { isValidRepoRef } from "./helpers";
import { s } from "./styles";

/** Step 1 — pick a CI target (AC-1) and the destination repo. GitHub Actions
 *  is the only selectable target; CircleCI/Jenkins/Generic CLI are visible but
 *  disabled ("coming soon"). */
export function TargetStep({
  target,
  onTargetChange,
  repo,
  onRepoChange,
  error,
}: {
  target: CiTarget;
  onTargetChange: (target: CiTarget) => void;
  repo: string;
  onRepoChange: (value: string) => void;
  /** Server-side failure from the preview call (distinct from the local
   *  format check below), rendered as a banner under the field. */
  error?: string | null;
}) {
  const t = useTranslations("ci");
  const repoTrimmed = repo.trim();
  const showFormatError = repoTrimmed.length > 0 && !isValidRepoRef(repoTrimmed);

  return (
    <div>
      <div style={s.targetGrid}>
        {CI_TARGETS.map((opt) => {
          const I = Icon[opt.icon];
          const selected = target === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              disabled={opt.disabled}
              aria-pressed={selected}
              onClick={() => {
                if (!opt.disabled) onTargetChange(opt.key);
              }}
              style={s.targetCard(selected, !!opt.disabled)}
            >
              <div style={s.targetCardHead}>
                <div style={s.targetIconBox(selected)}>
                  <I size={18} />
                </div>
                <span style={s.targetName}>{t(`exportWizard.targets.${opt.key}`)}</span>
                {opt.recommended && (
                  <Badge color="var(--accent-text)" bg="var(--accent-bg)" style={s.badgeRight}>
                    {t("exportWizard.recommended")}
                  </Badge>
                )}
                {opt.disabled && (
                  <Badge color="var(--text-muted)" style={s.badgeRight}>
                    {t("exportWizard.comingSoon")}
                  </Badge>
                )}
              </div>
              <p style={s.targetDesc}>{t(`exportWizard.targets.${opt.key}Desc`)}</p>
            </button>
          );
        })}
      </div>

      <div style={s.repoField}>
        <FormField
          label={t("exportWizard.repoLabel")}
          hint={
            showFormatError ? (
              <span style={{ color: "var(--crit)" }}>{t("exportWizard.repoInvalid")}</span>
            ) : (
              t("exportWizard.repoHint")
            )
          }
          required
        >
          <TextInput
            value={repo}
            onChange={onRepoChange}
            placeholder={t("exportWizard.repoPlaceholder")}
            aria-invalid={showFormatError}
            mono
          />
        </FormField>
        {error && (
          <div role="alert" style={s.errorBox}>
            <div style={s.errorTitle}>{t("exportWizard.targetErrorTitle")}</div>
            <div style={s.errorBody}>{error}</div>
          </div>
        )}
      </div>
    </div>
  );
}
