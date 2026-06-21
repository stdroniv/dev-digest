/* ImportSkillDrawer — import a skill from a markdown file or a .zip archive.
   The server PARSES the upload into a preview (it never persists, and executable
   archive entries are ignored); the user reviews, then we create the skill as
   UNTRUSTED data, DISABLED until vetted. A foreign skill is foreign instructions. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer, Button, TextInput, Markdown, Icon, Badge, ErrorState } from "@devdigest/ui";
import type { Skill, SkillImportPreview } from "@devdigest/shared";
import { useImportSkillPreview, useCreateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";

/** Read a File into base64 (no data: prefix) via FileReader. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ImportSkillDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (skill: Skill) => void;
}) {
  const t = useTranslations("skills");
  const toast = useToast();
  const preview = useImportSkillPreview();
  const create = useCreateSkill();

  const [parsed, setParsed] = React.useState<SkillImportPreview | null>(null);
  const [name, setName] = React.useState("");
  const fileInput = React.useRef<HTMLInputElement>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    const content_base64 = await fileToBase64(file);
    preview.mutate(
      { filename: file.name, content_base64 },
      {
        onSuccess: (p) => {
          setParsed(p);
          setName(p.name);
        },
      },
    );
  };

  const confirm = () => {
    if (!parsed) return;
    create.mutate(
      {
        name: name || parsed.name,
        // The body is the interface; until vetted we keep a neutral description.
        description: t("file.importedDescription"),
        type: parsed.type,
        body: parsed.body,
        source: parsed.source,
        enabled: false, // untrusted — disabled until a human vets it
      },
      {
        onSuccess: (skill) => {
          toast.success(t("file.success", { name: skill.name }));
          onCreated(skill);
        },
      },
    );
  };

  return (
    <Drawer width={640} title={t("drawer.title")} subtitle={t("drawer.subtitle")} onClose={onClose}>
      <div style={{ padding: 20, overflow: "auto" }}>
        {/* hidden native picker; .md + .zip */}
        <input
          ref={fileInput}
          type="file"
          accept=".md,.markdown,.zip"
          style={{ display: "none" }}
          aria-label={t("file.pick")}
          onChange={(e) => onPick(e.target.files?.[0])}
        />

        {!parsed && (
          <div
            onClick={() => fileInput.current?.click()}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              padding: "40px 20px",
              borderRadius: 12,
              border: "1.5px dashed var(--border-strong)",
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            <Icon.Upload size={26} style={{ color: "var(--accent)" }} />
            <div style={{ fontWeight: 600 }}>{t("file.dropTitle")}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", maxWidth: 360, lineHeight: 1.5 }}>
              {t("file.bodyHint")}
            </div>
            <Button kind="secondary" size="sm" icon="Upload" loading={preview.isPending}>
              {preview.isPending ? t("file.importing") : t("file.choose")}
            </Button>
          </div>
        )}

        {preview.isError && (
          <div style={{ marginTop: 16 }}>
            <ErrorState title={t("drawer.importFailed")} body={(preview.error as Error)?.message} />
          </div>
        )}

        {parsed && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                {t("file.nameLabel")}
              </label>
              <div style={{ marginTop: 8 }}>
                <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge color="var(--text-secondary)" mono>
                {t("config.tokens", { count: parsed.tokens })}
              </Badge>
              <Badge color="var(--warn)" icon="AlertTriangle">
                {t("preview.untrustedBadge")}
              </Badge>
            </div>

            {parsed.ignored_files.length > 0 && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-hover)",
                  fontSize: 12.5,
                  color: "var(--text-secondary)",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {t("file.ignoredTitle", { count: parsed.ignored_files.length })}
                </div>
                <div className="mono" style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
                  {parsed.ignored_files.join(", ")}
                </div>
              </div>
            )}

            <div
              style={{
                padding: "16px 18px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--bg-elevated)",
                maxHeight: 280,
                overflow: "auto",
                fontSize: 13.5,
              }}
            >
              <Markdown>{parsed.body}</Markdown>
            </div>

            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {t("file.bodyHint")}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <Button kind="primary" icon="Check" onClick={confirm} disabled={create.isPending || !name}>
                {create.isPending ? t("file.importing") : t("file.import")}
              </Button>
              <Button kind="ghost" onClick={() => setParsed(null)}>
                {t("file.chooseAnother")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
