"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, FormField, TextInput } from "@devdigest/ui";
import { useRootFolders, useSetRootFolders, DEFAULT_ROOT_FOLDERS } from "@/lib/hooks/settings";
import { SectionTitle } from "../SectionTitle";
import { s } from "./styles";

/**
 * Settings → Project Doc Roots. View/edit the per-workspace override of the
 * top-level folder names (e.g. `specs`/`docs`/`insights`) scanned for Markdown
 * project-context docs, applied to every repo in the workspace (AC-8/AC-9).
 * Add/remove edit a local buffer; Save persists the full ordered list via
 * `useSetRootFolders` (`PUT /settings`, `root_folders` key — T4's API). Reset
 * restores AND immediately persists the `specs`/`docs`/`insights` default.
 */
export function SettingsRootFolders() {
  const t = useTranslations("settings");
  const { data: rootFolders, isLoading } = useRootFolders();
  const setRootFolders = useSetRootFolders();

  const [folders, setFolders] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Hydrate the local edit buffer whenever the persisted list changes (initial
  // load, or after a save/reset round-trips through the shared settings cache).
  React.useEffect(() => {
    if (rootFolders) setFolders(rootFolders);
  }, [rootFolders]);

  const addFolder = () => {
    const name = draft.trim();
    if (!name) return;
    if (folders.includes(name)) {
      setError(t("rootFolders.duplicate"));
      return;
    }
    setError(null);
    setFolders((f) => [...f, name]);
    setDraft("");
  };

  const removeFolder = (name: string) => {
    setError(null);
    setFolders((f) => f.filter((x) => x !== name));
  };

  const save = () => {
    if (folders.length === 0) {
      setError(t("rootFolders.empty"));
      return;
    }
    setError(null);
    setRootFolders.mutate(folders);
  };

  const reset = () => {
    setError(null);
    setFolders([...DEFAULT_ROOT_FOLDERS]);
    setRootFolders.mutate([...DEFAULT_ROOT_FOLDERS]);
  };

  return (
    <div style={s.wrap}>
      <SectionTitle title={t("rootFolders.title")} body={t("rootFolders.body")} />

      <FormField label={t("rootFolders.foldersLabel")}>
        {!isLoading && (
          <div style={s.chips}>
            {folders.map((folder) => (
              <span key={folder} className="mono" style={s.chip}>
                {folder}
                <button
                  type="button"
                  style={s.chipRemove}
                  aria-label={t("rootFolders.remove", { folder })}
                  onClick={() => removeFolder(folder)}
                >
                  <Icon.X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div style={s.addRow}>
          <div style={s.addInput}>
            <TextInput
              value={draft}
              onChange={setDraft}
              mono
              placeholder={t("rootFolders.addPlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addFolder();
                }
              }}
            />
          </div>
          <Button kind="secondary" size="md" icon="Plus" onClick={addFolder}>
            {t("rootFolders.add")}
          </Button>
        </div>
        {error && <div style={s.error}>{error}</div>}
      </FormField>

      <div style={s.actions}>
        <Button kind="primary" size="md" onClick={save} disabled={setRootFolders.isPending}>
          {t("rootFolders.save")}
        </Button>
        <Button kind="ghost" size="md" icon="RefreshCw" onClick={reset} disabled={setRootFolders.isPending}>
          {t("rootFolders.reset")}
        </Button>
      </div>

      <div style={s.note}>
        <Icon.Info size={15} style={s.noteIcon} />
        <span>{t("rootFolders.note")}</span>
      </div>
    </div>
  );
}
