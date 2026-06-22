/* SkillsWorkspace — the Skills Lab master/detail. Left: searchable list of skill
   cards + "Add Skill" (create / import). Right: the SkillEditor for the selected
   skill, or a "select a skill" prompt. Used by /skills and /skills/:id. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, TextInput, Icon, EmptyState, ErrorState, Skeleton, Badge } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { useSkills, useSkill, useUpdateSkill } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { uniqueName } from "@/lib/unique-name";
import { SkillCard } from "../SkillCard";
import { ImportSkillDrawer } from "../ImportSkillDrawer";
import { SkillEditor } from "../../[id]/_components/SkillEditor";
import { ConfigTab } from "../../[id]/_components/SkillEditor/_components/ConfigTab";
import { VALID_SKILL_TABS } from "../../[id]/_components/SkillEditor/constants";

export function SkillsWorkspace({
  selectedId,
  tab,
  onTab,
}: {
  selectedId: string | null;
  tab: string;
  onTab: (t: string) => void;
}) {
  const t = useTranslations("skills");
  const router = useRouter();

  const { data: skills, isLoading, isError, error, refetch } = useSkills();
  const selected = useSkill(selectedId);
  const update = useUpdateSkill();

  const [query, setQuery] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  // An unsaved new-skill draft. Nothing is persisted until the user hits Save in
  // the editor (then it's created at v1); clicking Create just opens this form.
  const [draft, setDraft] = React.useState<{ defaultName: string; defaultBody: string } | null>(null);

  const activeTab = VALID_SKILL_TABS.includes(tab) ? tab : "config";

  const filtered = (skills ?? []).filter((s) =>
    `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()),
  );

  const open = (id: string) => {
    setDraft(null);
    // scroll:false — selecting a skill is an intra master/detail navigation; the
    // App Router default would reset the left list's scroll container to the top.
    router.push(`/skills/${id}?tab=${activeTab}`, { scroll: false });
  };

  // Open an unsaved draft seeded with a collision-free default name.
  const onCreate = () =>
    setDraft({
      defaultName: uniqueName((skills ?? []).map((sk) => sk.name), t("new.defaultName")),
      defaultBody: t("new.defaultBody"),
    });

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbSkills"), href: "/skills" }];

  return (
    <AppShell crumb={crumb}>
      <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>
        {/* left: skills list */}
        <div
          style={{
            width: 300,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-surface)",
          }}
        >
          <div style={{ padding: "16px 16px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>{t("page.heading")}</h1>
              <Dropdown
                width={210}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                    {t("page.addSkill")}
                  </Button>
                }
                items={[
                  { label: t("page.menu.create"), icon: "Edit", onClick: onCreate },
                  { label: t("page.menu.fromFile"), icon: "Upload", onClick: () => setImporting(true) },
                ]}
              />
            </div>
            <TextInput value={query} onChange={setQuery} placeholder={t("page.searchPlaceholder")} />
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: "0 12px 12px" }}>
            {isError ? (
              <ErrorState title={t("page.loadError")} body={error instanceof ApiError ? error.message : undefined} onRetry={() => refetch()} />
            ) : isLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Skeleton height={86} />
                <Skeleton height={86} />
                <Skeleton height={86} />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon="Sparkles"
                title={t("page.empty.title")}
                body={t("page.empty.body")}
                cta={t("page.empty.cta")}
                onCta={() => setImporting(true)}
              />
            ) : (
              filtered.map((sk: Skill) => (
                <SkillCard
                  key={sk.id}
                  skill={sk}
                  active={sk.id === selectedId}
                  onClick={() => open(sk.id)}
                  onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
                />
              ))
            )}
          </div>
        </div>

        {/* right: editor / prompt */}
        {draft ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px 0", flexShrink: 0 }}>
              <Icon.Sparkles size={18} style={{ color: "var(--accent)" }} />
              <h1 className="mono" style={{ fontSize: 16, fontWeight: 700 }}>
                {draft.defaultName}
              </h1>
              <Badge color="var(--text-muted)">{t("preview.draft")}</Badge>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 24 }}>
              <ConfigTab
                key="new-skill-draft"
                create={{
                  defaultName: draft.defaultName,
                  defaultBody: draft.defaultBody,
                  onCreated: (skill) => {
                    setDraft(null);
                    router.push(`/skills/${skill.id}?tab=config`);
                  },
                  onCancel: () => setDraft(null),
                }}
              />
            </div>
          </div>
        ) : !selectedId ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <EmptyState icon="Sparkles" title={t("page.selectPrompt.title")} body={t("page.selectPrompt.body")} />
          </div>
        ) : selected.isError || (!selected.isLoading && !selected.data) ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ErrorState title={t("detail.notFound.title")} body={t("detail.notFound.body")} onRetry={() => selected.refetch()} />
          </div>
        ) : selected.isLoading || !selected.data ? (
          <div style={{ flex: 1, padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
            <Skeleton height={24} width={240} />
            <Skeleton height={300} />
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px 0", flexShrink: 0 }}>
              <Icon.Sparkles size={18} style={{ color: "var(--accent)" }} />
              <h1 className="mono" style={{ fontSize: 16, fontWeight: 700 }}>
                {selected.data.name}
              </h1>
              <Badge color="var(--text-secondary)">{t(`listItem.type.${selected.data.type}`)}</Badge>
              {!selected.data.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
            </div>
            <SkillEditor skill={selected.data} tab={activeTab} onTab={onTab} />
          </div>
        )}
      </div>

      {importing && (
        <ImportSkillDrawer
          onClose={() => setImporting(false)}
          onCreated={(skill) => {
            setImporting(false);
            router.push(`/skills/${skill.id}?tab=config`);
          }}
        />
      )}
    </AppShell>
  );
}
