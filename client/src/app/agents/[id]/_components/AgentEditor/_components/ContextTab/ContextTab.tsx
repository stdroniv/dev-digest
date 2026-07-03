/* Agent → Context tab (SPEC-01, T12 + the per-repository attachment model
   follow-up). Lets the user browse a repo's discovered project docs
   (Markdown under the repo's configured root folders) and attach/detach +
   reorder them for this agent, scoped to the globally active repo — the
   attached, ordered path list is injected into every run of this agent as an
   untrusted block (AC-16).

   Thin data wrapper: derives the active repo from `useActiveRepo()` and
   calls its own hooks (this agent's repo-scoped document catalog/links) and
   the shared `useDocumentAttachment` hook (T6), then delegates ALL rendering
   to the shared `DocumentAttachmentPicker` (client/src/components) — the
   presentational chrome (doc list, drag/drop, preview pane) is identical to
   the sibling Skill Context tab (AC-32 symmetry). */
"use client";

import { useTranslations } from "next-intl";
import type { Agent, ProjectDocument } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import { useRepoDocuments, useAgentDocuments, useSetAgentDocuments } from "@/lib/hooks/documents";
import { useDocumentAttachment } from "@/lib/hooks/use-document-attachment";
import { DocumentAttachmentPicker } from "@/components/DocumentAttachmentPicker";

// Stable empty-array sentinel — a fresh `[]` literal every render would
// re-trigger the shared hook's hydration effect on every render (client/
// INSIGHTS: infinite-loop-hang).
const EMPTY_DOCS: ProjectDocument[] = [];

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;
  const repoName = activeRepo?.full_name;

  const { data: repoDocs, isLoading: docsLoading } = useRepoDocuments(repoId);
  const { data: links, isLoading: linksLoading } = useAgentDocuments(agent.id, repoId);
  const setDocuments = useSetAgentDocuments(agent.id);

  const docs = repoDocs?.documents ?? EMPTY_DOCS;

  const attachment = useDocumentAttachment({
    id: agent.id,
    repoId,
    docs,
    links,
    setDocuments,
  });

  return (
    <DocumentAttachmentPicker
      t={t}
      repoId={repoId}
      repoName={repoName}
      docsLoading={docsLoading}
      linksLoading={linksLoading}
      repoDocsState={repoDocs?.state}
      docs={docs}
      {...attachment}
    />
  );
}
