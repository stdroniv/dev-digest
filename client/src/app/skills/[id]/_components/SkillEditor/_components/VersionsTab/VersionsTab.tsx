/* Skill Versions tab — every saved body change is an immutable snapshot. Restore
   re-saves a past body, which itself appends a new version (history is append-only). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Skeleton, EmptyState } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions, useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading } = useSkillVersions(skill.id);
  const update = useUpdateSkill();

  const restore = (version: number, body: string) =>
    update.mutate(
      { id: skill.id, patch: { body } },
      { onSuccess: (data) => toast.success(t("versions.restored", { version, newVersion: data.version })) },
    );

  if (isLoading) {
    return (
      <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 10 }}>
        <Skeleton height={64} />
        <Skeleton height={64} />
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    return <EmptyState icon="History" title={t("versions.emptyTitle")} body={t("versions.emptyBody")} />;
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{t("versions.title")}</h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("versions.subtitle")}</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {versions.map((v) => {
          const isCurrent = v.version === skill.version;
          return (
            <div
              key={v.version}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 10,
                border: `1px solid ${isCurrent ? "var(--accent)" : "var(--border)"}`,
                background: "var(--bg-elevated)",
              }}
            >
              <span
                className="mono"
                style={{
                  width: 34,
                  height: 24,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 6,
                  background: "var(--bg-hover)",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}
              >
                v{v.version}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  {new Date(v.created_at).toLocaleString()}
                </div>
              </div>
              {isCurrent ? (
                <Badge color="var(--ok)" icon="Check">
                  {t("versions.current")}
                </Badge>
              ) : (
                <Button
                  kind="secondary"
                  size="sm"
                  icon="RefreshCw"
                  onClick={() => restore(v.version, v.body)}
                  disabled={update.isPending}
                >
                  {t("versions.restore")}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
