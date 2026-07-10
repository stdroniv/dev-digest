/* SkillEditor — Config / Preview / Versions tabs for one skill. Tab state lives
   in ?tab= (managed by the page). Mirrors the AgentEditor layout. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { ContextTab } from "./_components/ContextTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { EvalsTab } from "./_components/EvalsTab";
import { TABS } from "./constants";

export function SkillEditor({
  skill,
  tab,
  onTab,
}: {
  skill: Skill;
  tab: string;
  onTab: (t: string) => void;
}) {
  const t = useTranslations("skills");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ flexShrink: 0 }}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 24 }}>
        {tab === "config" && <ConfigTab skill={skill} />}
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "context" && <ContextTab skillId={skill.id} />}
        {tab === "stats" && <StatsTab skill={skill} />}
        {tab === "versions" && <VersionsTab skill={skill} />}
        {tab === "evals" && <EvalsTab skill={skill} />}
      </div>
    </div>
  );
}
