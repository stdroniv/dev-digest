"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";
import { FileTreeRow } from "./FileTreeRow";
import { s } from "./styles";

/** Step 2 — the "FILES TO CREATE" tree (AC-2/4/5) with a content preview pane;
 *  selecting a file shows its contents and marks it editable (AC-3). */
export function PreviewStep({
  files,
  isLoading,
  selectedPath,
  onSelect,
}: {
  files: CiFile[];
  isLoading: boolean;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const t = useTranslations("ci");
  const selected = files.find((f) => f.path === selectedPath) ?? null;

  return (
    <div style={s.previewGrid}>
      <div style={s.fileTreePane}>
        <div style={s.fileTreeLabel}>{t("exportWizard.filesToCreate")}</div>
        {isLoading && <div style={s.previewMuted}>{t("exportWizard.generating")}</div>}
        {!isLoading &&
          files.map((f) => (
            <FileTreeRow
              key={f.path}
              file={f}
              active={f.path === selectedPath}
              onClick={() => onSelect(f.path)}
            />
          ))}
      </div>
      <div style={s.fileContentPane}>
        {selected && (
          <>
            <div style={s.fileContentHeader}>
              <span className="mono" style={s.fileContentPath}>
                {selected.path}
              </span>
              {selected.editable && (
                <Badge color="var(--text-muted)" icon="Edit">
                  {t("exportWizard.editable")}
                </Badge>
              )}
            </div>
            <pre className="mono" style={s.fileContentBody}>
              {selected.contents}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
