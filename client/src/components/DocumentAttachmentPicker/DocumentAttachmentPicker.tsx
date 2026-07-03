/* DocumentAttachmentPicker — shared presentational chrome for the Project
   Context document picker (doc-list + drag/drop, checkbox row, preview pane,
   empty states) used identically by the Agent and Skill Context tabs
   (AC-32 symmetry).

   Purely presentational: all state/behavior lives in the `useDocumentAttachment`
   hook (spread in via `UseDocumentAttachmentResult`); this component only
   renders it. i18n-agnostic — callers pass their own namespace-scoped `t`
   (`useTranslations("agents")` / `useTranslations("skills")`), both of which
   expose the same `context.*` keys (see messages/en/{agents,skills}.json).

   Each agent/skill keeps an independent per-repo document list, bound to the
   globally active repo — the caller (a `ContextTab.tsx` wrapper) derives
   `repoId`/`repoName` from `useActiveRepo()` and passes them down; this
   component must NOT call `useActiveRepo()` itself. When `repoId` is null
   (no active repo — AC-38), this renders a select-a-repository prompt
   instead of the doc list. */
"use client";

import React from "react";
import type { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon, Skeleton, EmptyState, TextInput } from "@devdigest/ui";
import type { ProjectDocument } from "@devdigest/shared";
import type { UseDocumentAttachmentResult } from "@/lib/hooks/use-document-attachment";
import { s } from "./styles";

export interface DocumentAttachmentPickerProps extends UseDocumentAttachmentResult {
  /** Namespace-scoped translation function — must expose the `context.*` keys. */
  t: ReturnType<typeof useTranslations>;
  /** The globally active repo (AC-38: null when none is selected/none exist). */
  repoId: string | null;
  repoName?: string;
  docsLoading: boolean;
  linksLoading: boolean;
  repoDocsState: "ready" | "not_cloned" | "empty" | undefined;
  docs: ProjectDocument[];
}

export function DocumentAttachmentPicker({
  t,
  repoId,
  docsLoading,
  linksLoading,
  repoDocsState,
  docs,
  order,
  attached,
  toggle,
  onDrop,
  dragId,
  previewPath,
  togglePreview,
  preview,
  attachedTokens,
}: DocumentAttachmentPickerProps) {
  const byPath = React.useMemo(() => new Map(docs.map((d) => [d.path, d])), [docs]);

  // Path filter scoped to THIS picker only — independent of the standalone
  // Project Context screen's own AC-7 filter (`ContextWorkspace.tsx`).
  const [filter, setFilter] = React.useState("");
  const isFiltering = filter.trim().length > 0;
  const filteredOrder = React.useMemo(
    () => order.filter((path) => path.toLowerCase().includes(filter.trim().toLowerCase())),
    [order, filter],
  );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("context.title")}</h2>
        <Badge color="var(--accent)">{t("context.tokenVolume", { count: attachedTokens })}</Badge>
      </div>
      <p style={s.hint}>{t("context.hint")}</p>

      {repoId == null && (
        <EmptyState
          icon="Folder"
          title={t("context.selectRepoTitle")}
          body={t("context.selectRepoBody")}
        />
      )}

      {repoId != null && (
        <>
          {(docsLoading || linksLoading) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
          )}

          {!docsLoading && !linksLoading && repoDocsState === "not_cloned" && (
            <EmptyState
              icon="GitBranch"
              title={t("context.notClonedTitle")}
              body={t("context.notClonedBody")}
            />
          )}

          {!docsLoading && !linksLoading && repoDocsState === "empty" && (
            <EmptyState icon="FileText" title={t("context.emptyTitle")} body={t("context.emptyBody")} />
          )}

          {!docsLoading && !linksLoading && repoDocsState === "ready" && (
            <>
              <div style={s.filterRow}>
                <div style={{ flex: 1 }}>
                  <TextInput
                    value={filter}
                    onChange={setFilter}
                    placeholder={t("context.filterPlaceholder")}
                  />
                </div>
                <div style={s.countRow}>
                  <Badge color="var(--text-muted)" bg="transparent">
                    {t("context.attachedCount", { count: attached.size })}
                  </Badge>
                  {isFiltering && (
                    <Badge color="var(--text-muted)" bg="transparent">
                      {t("context.filterShown", {
                        shown: filteredOrder.length,
                        total: order.length,
                      })}
                    </Badge>
                  )}
                </div>
              </div>
              <div style={s.list}>
                {filteredOrder.map((path) => {
                  const doc = byPath.get(path);
                  const isAttached = attached.has(path);
                  const isPreviewing = previewPath === path;
                  return (
                    <div key={path}>
                      <div
                        draggable
                        onDragStart={() => (dragId.current = path)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => onDrop(path)}
                        style={s.row(isAttached)}
                      >
                        <span style={s.handle} aria-hidden>
                          <Icon.Menu size={14} />
                        </span>
                        <Checkbox checked={isAttached} onChange={(v) => toggle(path, v)} />
                        <span className="mono" style={s.path}>
                          {path}
                        </span>
                        <Badge color="var(--text-muted)" bg="transparent">
                          {doc?.root ?? t("context.unknownRoot")}
                        </Badge>
                        <button
                          type="button"
                          style={s.previewBtn}
                          onClick={() => togglePreview(path)}
                          aria-label={`${t("context.previewToggle")}: ${path}`}
                          title={t("context.previewToggle")}
                        >
                          <Icon.Eye size={13} />
                        </button>
                      </div>
                      {isPreviewing && (
                        <pre className="mono" style={s.previewPane}>
                          {preview.isLoading ? t("context.previewLoading") : preview.data?.content || "—"}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      <div role="note" style={s.untrustedNote}>
        <Icon.AlertTriangle size={14} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} />
        <span>{t("context.untrustedNote")}</span>
      </div>
    </div>
  );
}
