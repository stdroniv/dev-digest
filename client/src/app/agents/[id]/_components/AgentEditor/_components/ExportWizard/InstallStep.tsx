"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { s } from "./styles";

/** Step 4 — "Open a PR with these files" (AC-9) as the primary path, "Copy
 *  files as a zip" (AC-10) as the degraded fallback, always visible so an
 *  install failure still offers it (AC-11). */
export function InstallStep({
  repo,
  fileCount,
  onInstall,
  installPending,
  installError,
  prUrl,
  installed,
  onDownloadZip,
  zipPending,
}: {
  repo: string;
  fileCount: number;
  onInstall: () => void;
  installPending: boolean;
  installError: string | null;
  prUrl: string | null;
  installed: boolean;
  onDownloadZip: () => void;
  zipPending: boolean;
}) {
  const t = useTranslations("ci");

  return (
    <div style={s.installWrap}>
      <button
        type="button"
        onClick={onInstall}
        disabled={installPending || installed}
        style={s.installPrimaryCard}
      >
        <div style={s.installCardHead}>
          {installed ? (
            <Icon.Check size={18} style={{ color: "var(--accent)" }} />
          ) : (
            <Icon.GitPullRequest size={18} style={{ color: "var(--accent)" }} />
          )}
          <span style={s.installCardTitle}>
            {installed ? t("exportWizard.installedCardTitle") : t("exportWizard.installCardTitle")}
          </span>
          {!installed && (
            <Badge color="var(--accent-text)" bg="var(--bg-elevated)" style={s.badgeRight}>
              {t("exportWizard.recommended")}
            </Badge>
          )}
        </div>
        <p style={s.installCardBody}>
          {t("exportWizard.installCardBody", { repo: repo || t("exportWizard.ownerRepo"), count: fileCount })}
        </p>
      </button>

      {prUrl && (
        <div style={s.prSuccessBox}>
          <a href={prUrl} target="_blank" rel="noreferrer" style={s.prLink}>
            {prUrl}
          </a>
        </div>
      )}

      {installError && (
        <div role="alert" style={s.errorBox}>
          <div style={s.errorTitle}>{t("exportWizard.installErrorTitle")}</div>
          <div style={s.errorBody}>{installError}</div>
        </div>
      )}

      <button type="button" onClick={onDownloadZip} disabled={zipPending} style={s.installSecondaryCard}>
        <div style={s.installSecondaryHead}>
          <Icon.Copy size={16} style={{ color: "var(--text-secondary)" }} />
          <span style={s.installSecondaryTitle}>{t("exportWizard.zipCardTitle")}</span>
          <span style={s.installSecondaryHint}>{t("exportWizard.zipCardBody")}</span>
        </div>
      </button>

      <p style={s.docsFooter}>
        {t("exportWizard.docsFooterPrefix")}{" "}
        <a href="https://docs.github.com/en/actions" target="_blank" rel="noreferrer" style={s.docsLink}>
          {t("exportWizard.docsFooterLink")}
        </a>
      </p>
    </div>
  );
}
