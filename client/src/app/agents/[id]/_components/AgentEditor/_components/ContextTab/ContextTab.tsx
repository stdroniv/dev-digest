/* Agent → Context tab (SPEC-01, T12). Lets the user browse a repo's
   discovered project docs (Markdown under the repo's configured root
   folders) and attach/detach + reorder them for this agent — the attached,
   ordered path list is injected into every run of this agent as an untrusted
   block (AC-16).

   Persistence goes through `useSetAgentDocuments` (POST /agents/:id/documents,
   wholesale ordered replace) — every checkbox toggle or drag-reorder must send
   the FULL current ordered path list, not a diff. Mirrors the interaction
   pattern of the sibling `SkillsTab` (attach/detach checkbox + native
   drag-reorder, same double-fire guard) and the sibling Skill "Project context
   to use" section (`skills/[id]/.../DocumentsSection`) for the document-domain
   bits (repo picker, cross-repo-portable attachments, in-row preview, token
   volume). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon, SelectInput, Skeleton, EmptyState } from "@devdigest/ui";
import type { Agent, ProjectDocument } from "@devdigest/shared";
import { useRepos } from "@/lib/hooks/core";
import {
  useRepoDocuments,
  useAgentDocuments,
  useSetAgentDocuments,
  useDocumentPreview,
} from "@/lib/hooks/documents";
import { s } from "./styles";

/** Order all docs: attached (in link order) first — even one no longer present
    in the current repo's catalog, so it stays visible/detachable (attachments
    are portable paths, not tied to one repo clone — switching the picker only
    changes what you're BROWSING) — then the rest of the repo's catalog by list
    order. */
function initialOrder(docs: ProjectDocument[], linkedPaths: string[]): string[] {
  const rest = docs.filter((d) => !linkedPaths.includes(d.path)).map((d) => d.path);
  return [...linkedPaths, ...rest];
}

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { data: repos, isLoading: reposLoading } = useRepos();

  // Default to the workspace's active/first CLONED repo (falls back to the
  // first repo overall so the "not cloned" state still renders honestly).
  const defaultRepoId = React.useMemo(() => {
    if (!repos || repos.length === 0) return null;
    return repos.find((r) => r.clone_path)?.id ?? repos[0]!.id;
  }, [repos]);

  const [repoId, setRepoId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (repoId == null && defaultRepoId) setRepoId(defaultRepoId);
  }, [repoId, defaultRepoId]);

  const { data: repoDocs, isLoading: docsLoading } = useRepoDocuments(repoId);
  const { data: links, isLoading: linksLoading } = useAgentDocuments(agent.id);
  const setDocuments = useSetAgentDocuments(agent.id);

  const docs = repoDocs?.documents ?? [];
  const byPath = React.useMemo(() => new Map(docs.map((d) => [d.path, d])), [docs]);

  const [order, setOrder] = React.useState<string[]>([]);
  const [attached, setAttached] = React.useState<Set<string>>(new Set());
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const dragId = React.useRef<string | null>(null);
  // Per-path in-flight guard. The vendored Checkbox is a <button> in a <label>,
  // so one click fires onChange twice; if a re-render lands between the two
  // fires the second computes the opposite intent and re-attaches/re-detaches.
  // Drop the spurious second fire and clear the guard when the mutation settles.
  const toggling = React.useRef<Set<string>>(new Set());

  // Hydrate local state once the links (and current repo's catalog) land, and
  // whenever the agent or repo changes.
  React.useEffect(() => {
    if (!links) return;
    const linkedPaths = [...links].sort((a, b) => a.order - b.order).map((l) => l.path);
    setOrder(initialOrder(docs, linkedPaths));
    setAttached(new Set(linkedPaths));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, links, repoDocs]);

  const preview = useDocumentPreview(repoId, previewPath);

  const attachedTokens = order
    .filter((p) => attached.has(p))
    .reduce((sum, p) => sum + (byPath.get(p)?.tokens ?? 0), 0);

  /** Persist the current checked set in row order. */
  const persist = (nextOrder: string[], nextAttached: Set<string>, onSettled?: () => void) => {
    const paths = nextOrder.filter((p) => nextAttached.has(p));
    setDocuments.mutate(paths, onSettled ? { onSettled } : undefined);
  };

  const toggle = (path: string, on: boolean) => {
    if (toggling.current.has(path)) return; // drop the label's duplicate fire
    toggling.current.add(path);
    const next = new Set(attached);
    if (on) next.add(path);
    else next.delete(path);
    setAttached(next);
    persist(order, next, () => toggling.current.delete(path));
  };

  const onDrop = (targetPath: string) => {
    const from = dragId.current;
    dragId.current = null;
    if (!from || from === targetPath) return;
    const next = [...order];
    next.splice(next.indexOf(from), 1);
    next.splice(next.indexOf(targetPath), 0, from);
    setOrder(next);
    persist(next, attached);
  };

  const togglePreview = (path: string) => setPreviewPath((cur) => (cur === path ? null : path));

  if (reposLoading) {
    return <Skeleton height={44} />;
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("context.title")}</h2>
        <Badge color="var(--accent)">{t("context.tokenVolume", { count: attachedTokens })}</Badge>
      </div>
      <p style={s.hint}>{t("context.hint")}</p>

      {(!repos || repos.length === 0) && (
        <EmptyState icon="Folder" title={t("context.noReposTitle")} body={t("context.noReposBody")} />
      )}

      {repos && repos.length > 0 && (
        <>
          <div style={s.repoPicker}>
            <span style={s.repoLabel}>{t("context.repoLabel")}</span>
            <SelectInput
              value={repoId ?? ""}
              onChange={setRepoId}
              options={repos.map((r) => ({ value: r.id, label: r.full_name }))}
              mono={false}
            />
          </div>

          {(docsLoading || linksLoading) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
          )}

          {!docsLoading && !linksLoading && repoDocs?.state === "not_cloned" && (
            <EmptyState
              icon="GitBranch"
              title={t("context.notClonedTitle")}
              body={t("context.notClonedBody")}
            />
          )}

          {!docsLoading && !linksLoading && repoDocs?.state === "empty" && (
            <EmptyState icon="FileText" title={t("context.emptyTitle")} body={t("context.emptyBody")} />
          )}

          {!docsLoading && !linksLoading && repoDocs?.state === "ready" && (
            <div style={s.list}>
              {order.map((path) => {
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
                        aria-label={t("context.previewToggle")}
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
