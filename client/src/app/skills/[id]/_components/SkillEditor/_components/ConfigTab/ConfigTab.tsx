/* Skill Config tab — name, description (the skill's directive interface), type,
   markdown body with a live token-count badge, and the enabled toggle. Saving a
   changed body creates a new immutable version (server-side).

   Two modes:
   - edit (default): `skill` is the persisted row; Save PATCHes it.
   - create: `create` is set, no row exists yet; the first Save POSTs the skill at
     v1 (nothing is persisted until then), then hands the new skill to the caller. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, Textarea, Toggle, Button, Badge } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useCreateSkill, useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { SKILL_TYPE_VALUES } from "../../constants";
import { s } from "./styles";

export interface ConfigCreateMode {
  /** Pre-computed unique default name for the new skill. */
  defaultName: string;
  /** Scaffold body the editor opens with. */
  defaultBody: string;
  /** Called with the persisted skill after a successful first Save. */
  onCreated: (skill: Skill) => void;
  /** Called when the user discards the unsaved draft. */
  onCancel: () => void;
}

export function ConfigTab({ skill, create }: { skill?: Skill; create?: ConfigCreateMode }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const createSkill = useCreateSkill();
  const isCreate = !!create;

  const [name, setName] = React.useState(skill?.name ?? create?.defaultName ?? "");
  const [description, setDescription] = React.useState(skill?.description ?? "");
  const [type, setType] = React.useState<SkillType>(skill?.type ?? "custom");
  const [body, setBody] = React.useState(skill?.body ?? create?.defaultBody ?? "");
  const [enabled, setEnabled] = React.useState(skill?.enabled ?? true);
  const [nameError, setNameError] = React.useState<string | null>(null);

  // Reset the local form when switching skills (edit mode only; the create draft
  // is mounted fresh per session via a key, so it never needs a reset here).
  React.useEffect(() => {
    if (!skill) return;
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
    setNameError(null);
  }, [skill?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeName = (v: string) => {
    setName(v);
    if (nameError) setNameError(null);
  };

  const dirtyBody = !!skill && body !== skill.body;
  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  // Per-field dirty tracking. We PATCH only the fields that actually changed so
  // the server's body-only versioning rule isn't defeated. Save stays disabled
  // until something changes (in create mode it's always enabled).
  const isDirty =
    isCreate ||
    (!!skill &&
      (name !== skill.name ||
        description !== skill.description ||
        type !== skill.type ||
        dirtyBody ||
        enabled !== skill.enabled));

  const pending = isCreate ? createSkill.isPending : update.isPending;

  // A 409 means a duplicate name — surface it inline by the Name field.
  const handleConflict = (e: unknown): boolean => {
    if (e instanceof ApiError && e.status === 409) {
      setNameError(e.message);
      return true;
    }
    return false;
  };

  const save = () => {
    setNameError(null);
    if (isCreate) {
      createSkill.mutate(
        { name: name.trim(), description, type, body, enabled },
        {
          onSuccess: (data) => {
            toast.success(t("new.created"));
            create!.onCreated(data);
          },
          onError: (e) => {
            if (!handleConflict(e)) toast.error(e instanceof ApiError ? e.message : t("config.saveError"));
          },
        },
      );
      return;
    }
    const patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">> = {};
    if (name !== skill!.name) patch.name = name;
    if (description !== skill!.description) patch.description = description;
    if (type !== skill!.type) patch.type = type;
    if (body !== skill!.body) patch.body = body;
    if (enabled !== skill!.enabled) patch.enabled = enabled;
    update.mutate(
      { id: skill!.id, patch },
      {
        onSuccess: (data) => toast.success(t("config.savedToast", { name: data.name, version: data.version })),
        onError: (e) => {
          if (!handleConflict(e)) toast.error(e instanceof ApiError ? e.message : t("config.saveError"));
        },
      },
    );
  };

  const versionBadge =
    isCreate || (skill && skill.version < 1) ? t("preview.draft") : t("preview.version", { version: skill!.version });

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>
          {t("config.title")}
          <Badge color="var(--text-muted)" mono>
            {versionBadge}
          </Badge>
        </h2>
        <label style={s.enabledLabel}>
          {t("config.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>

      <FormField label={t("config.name")} required>
        <TextInput value={name} onChange={changeName} />
        {nameError && (
          <div style={{ fontSize: 12, color: "var(--crit)", marginTop: 8 }}>{nameError}</div>
        )}
      </FormField>

      <FormField label={t("config.description")} hint={t("config.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>

      <FormField label={t("config.type")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
      </FormField>

      <FormField
        label={t("config.body")}
        required
        hint={t("config.bodyHint")}
        right={
          <Badge color="var(--text-muted)" mono>
            {t("config.tokens", { count: skill?.tokens ?? 0 })}
            {dirtyBody ? ` · ${t("config.unsaved")}` : ""}
          </Badge>
        }
      >
        <Textarea value={body} onChange={setBody} rows={18} mono />
      </FormField>

      <div style={s.actions}>
        <Button
          kind="primary"
          icon="Check"
          onClick={save}
          disabled={pending || !isDirty || !name.trim() || !body.trim()}
        >
          {pending ? t("config.saving") : t("config.save")}
        </Button>
        {isCreate && (
          <Button kind="secondary" onClick={create!.onCancel} disabled={pending}>
            {t("new.cancel")}
          </Button>
        )}
        {!isCreate && update.isSuccess && (
          <span style={s.savedNote}>{t("config.saved", { version: update.data?.version })}</span>
        )}
      </div>
    </div>
  );
}
