/* ResultsHeader — the top bar of the results page: a "Configure run" affordance
   that returns to Configure with the current PR + agent selection preserved
   (AC-17), the title, an "N selected agents" label (no "· parallel"), and the
   Columns/Tabs view switch (AC-16, defaults Columns). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

export type ResultsView = "columns" | "tabs";

export function ResultsHeader({
  agentCount,
  view,
  onViewChange,
  configureHref,
}: {
  agentCount: number;
  view: ResultsView;
  onViewChange: (v: ResultsView) => void;
  configureHref: string;
}) {
  const t = useTranslations("multiAgent");

  return (
    <div style={s.header}>
      <Link href={configureHref} style={s.configureBtn} title={t("results.configureRun")}>
        <Icon.Settings size={14} />
        {t("results.configureRun")}
      </Link>
      <h1 style={s.title}>{t("results.title")}</h1>
      <span style={s.subtle}>{t("results.selectedAgents", { count: agentCount })}</span>
      <div style={s.switch} role="tablist" aria-label={t("results.title")}>
        {(["columns", "tabs"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={view === k}
            onClick={() => onViewChange(k)}
            style={{ ...s.switchBtn, ...(view === k ? s.switchOn : s.switchOff) }}
          >
            {k === "columns" ? t("results.view.columns") : t("results.view.tabs")}
          </button>
        ))}
      </div>
    </div>
  );
}
