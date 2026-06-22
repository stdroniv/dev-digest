/* CreateSkillModal — pre-filled from the repo's ACCEPTED conventions (assembled
   server-side), fully editable before saving. Save → POST /skills with
   source="extracted"; Cancel discards. Matches the "Create skill from
   conventions" screenshot. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Modal, Button, FormField, TextInput, Textarea, SelectInput, Icon } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { uniqueName } from "@/lib/unique-name";
import { useCreateSkill, useSkills } from "@/lib/hooks/skills";
import type { ConventionSkillPreview } from "@/lib/hooks/conventions";

const SKILL_TYPES: SkillType[] = ["convention", "rubric", "security", "custom"];

export interface CreateSkillModalProps {
  preview: ConventionSkillPreview;
  acceptedCount: number;
  repoName: string;
  onClose: () => void;
}

export function CreateSkillModal({ preview, acceptedCount, repoName, onClose }: CreateSkillModalProps) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const toast = useToast();
  const create = useCreateSkill();
  const { data: skills } = useSkills();

  const [name, setName] = React.useState(preview.name);
  const [description, setDescription] = React.useState(preview.description);
  const [type, setType] = React.useState<SkillType>("convention");
  const [body, setBody] = React.useState(preview.body);

  // Suffix the default name if a skill already uses it, so re-creating from the
  // same repo doesn't collide (the server enforces unique names). Runs once the
  // skills list is available.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current || !skills) return;
    seeded.current = true;
    setName((cur) => uniqueName(skills.map((sk) => sk.name), cur));
  }, [skills]);

  const canSave = name.trim().length > 0 && body.trim().length > 0 && !create.isPending;

  async function save() {
    try {
      const skill = await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        type,
        body,
        source: "extracted",
        enabled: true,
      });
      toast.success(t("toast.skillCreated", { name: skill.name }));
      onClose();
      router.push(`/skills/${skill.id}?tab=config`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("toast.skillError"));
    }
  }

  return (
    <Modal
      width={760}
      title={t("modal.title")}
      subtitle={name}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button kind="secondary" onClick={onClose} disabled={create.isPending}>
            {t("modal.cancel")}
          </Button>
          <Button kind="primary" icon="Sparkles" onClick={save} disabled={!canSave} loading={create.isPending}>
            {t("modal.save")}
          </Button>
        </div>
      }
    >
      <div style={{ padding: 24, overflowY: "auto" }}>
        <div style={banner}>
          <Icon.Sparkles size={15} />
          <span>{t("modal.mergedFrom", { count: acceptedCount, repo: repoName })}</span>
        </div>

        <FormField label={t("modal.name")} required>
          <TextInput value={name} onChange={setName} />
        </FormField>

        <FormField label={t("modal.description")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>

        <FormField label={t("modal.type")}>
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={[...SKILL_TYPES]} />
        </FormField>

        <FormField label={t("modal.body")} required>
          <Textarea value={body} onChange={setBody} rows={16} mono />
        </FormField>
      </div>
    </Modal>
  );
}

const banner: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-hover)",
  color: "var(--text-secondary)",
  fontSize: 13,
  marginBottom: 20,
};
