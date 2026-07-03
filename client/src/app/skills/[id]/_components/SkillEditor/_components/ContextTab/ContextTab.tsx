/* Skill → Context tab (SPEC-01 Gap 1 follow-up + the per-repository
   attachment model). Promotes "Project context to use" from an embedded
   ConfigTab section to a real sibling tab (AC-11), mirroring the Agent
   editor's Context tab exactly — same shape, same shared
   `useDocumentAttachment` hook (T6) AND shared `DocumentAttachmentPicker`
   presentational component (client/src/components), parameterized for
   skills (`useSkillDocuments`/`useSetSkillDocuments`) instead of agents
   (AC-32 symmetry). Both scoped to the globally active repo via
   `useActiveRepo()`.

   Attaching/detaching/reordering a document goes through its OWN mutation —
   completely separate from the Config tab's body-only per-field-diff PATCH
   and `isDirty` gate. It must NEVER dirty the skill's Config form or bump its
   body version (client/INSIGHTS: the server versions skills strictly on body
   content, never on metadata/links) — unchanged by this move. */
"use client";

import { useTranslations } from "next-intl";
import type { ProjectDocument } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import { useRepoDocuments, useSkillDocuments, useSetSkillDocuments } from "@/lib/hooks/documents";
import { useDocumentAttachment } from "@/lib/hooks/use-document-attachment";
import { DocumentAttachmentPicker } from "@/components/DocumentAttachmentPicker";

// Stable empty-array sentinel — a fresh `[]` literal every render would
// re-trigger the shared hook's hydration effect on every render (client/
// INSIGHTS: infinite-loop-hang).
const EMPTY_DOCS: ProjectDocument[] = [];

export function ContextTab({ skillId }: { skillId: string }) {
  const t = useTranslations("skills");
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;
  const repoName = activeRepo?.full_name;

  const { data: repoDocs, isLoading: docsLoading } = useRepoDocuments(repoId);
  const { data: links, isLoading: linksLoading } = useSkillDocuments(skillId, repoId);
  const setDocuments = useSetSkillDocuments(skillId);

  const docs = repoDocs?.documents ?? EMPTY_DOCS;

  const attachment = useDocumentAttachment({
    id: skillId,
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
