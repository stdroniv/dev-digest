"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, FormField, Badge, Icon } from "@devdigest/ui";
import { TRIGGER_OPTIONS, POST_AS_OPTIONS, POST_AS_I18N_KEY, type TriggerOption, type PostAsOption } from "./constants";
import { s } from "./styles";

/** Step 3 — trigger chips (AC-6), "Post results as" (AC-7), and the
 *  merge-block hint (AC-8, copy verbatim from `ci.json`). */
export function ConfigureStep({
  triggers,
  onToggleTrigger,
  postAs,
  onPostAsChange,
}: {
  triggers: Set<TriggerOption>;
  onToggleTrigger: (trigger: TriggerOption) => void;
  postAs: PostAsOption;
  onPostAsChange: (value: PostAsOption) => void;
}) {
  const t = useTranslations("ci");

  return (
    <div style={s.configureWrap}>
      <FormField label={t("exportWizard.triggerLabel")}>
        <div style={s.chipsRow}>
          {TRIGGER_OPTIONS.map((trig) => {
            const active = triggers.has(trig);
            return (
              <Chip
                key={trig}
                active={active}
                icon={active ? "Check" : undefined}
                onClick={() => onToggleTrigger(trig)}
              >
                {`pull_request:${trig}`}
              </Chip>
            );
          })}
        </div>
      </FormField>

      <FormField label={t("exportWizard.postResultsLabel")}>
        <div style={s.radioColumn}>
          {POST_AS_OPTIONS.map((opt) => (
            <label key={opt} style={s.radioRow}>
              <input
                type="radio"
                name="ci-post-as"
                value={opt}
                checked={postAs === opt}
                onChange={() => onPostAsChange(opt)}
              />
              {t(`exportWizard.postAs.${POST_AS_I18N_KEY[opt]}`)}
              {opt === "github_review" && (
                <>
                  <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                    {t("exportWizard.recommended")}
                  </Badge>
                  <Badge color="var(--text-muted)">{t("exportWizard.verdictLabel")}</Badge>
                </>
              )}
            </label>
          ))}
        </div>
      </FormField>

      <div style={s.infoBox}>
        <Icon.Info size={15} style={s.infoIcon} />
        <div style={s.infoText}>
          <span style={s.infoTitle}>{t("exportWizard.blockMergeTitle")}</span>
          {": "}
          {t("exportWizard.blockMergeDesc")}
        </div>
      </div>
    </div>
  );
}
