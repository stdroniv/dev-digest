/* lib/hooks/use-document-attachment.ts — shared attach/detach/reorder/preview
   logic for the Project Context document picker.

   Extracted from the near-identical logic that used to live duplicated in
   `AgentEditor/_components/ContextTab/ContextTab.tsx` and the skill Config
   tab's now-deleted embedded "Project context to use" section (R1's "reuse
   existing logic" instruction) — both call sites become thin JSX wrappers
   around this hook.

   Each agent/skill now keeps an INDEPENDENT per-repo document list (repo_id
   is part of the composite PK server-side), so there is no cross-repo
   anchor/conflict to reconcile here — `repoId` is simply the caller's
   currently active repo, and every mutation is scoped to it.

   Domain-agnostic: parameterized by the caller's own `links` (query result)
   and `setDocuments` (mutation result), so it works identically for an agent
   or a skill (AC-32 symmetry) without knowing which. */
"use client";

import React from "react";
import type { ProjectDocument } from "@devdigest/shared";
import { useDocumentPreview } from "./documents";

/** The shape both `AgentDocumentLink` and `SkillDocumentLink` share. */
export interface DocumentLinkLike {
  path: string;
  order: number;
  repo_id: string | null;
}

export interface UseDocumentAttachmentArgs<TLink extends DocumentLinkLike> {
  /** Stable identity of the agent/skill being edited — drives the hydration
   *  effect's dependency list (mirrors the two original components'
   *  `[id, links, docs]` pattern). */
  id: string;
  /** The caller's currently active repo. Non-null whenever a document list
   *  is being shown (the caller renders an AC-38 empty state otherwise). */
  repoId: string | null;
  /** The currently browsed repo's discovered document catalog. Pass a
   *  STABLE empty-array default (e.g. a module-level `EMPTY_DOCS` sentinel)
   *  when there's no catalog yet — a fresh `[]` literal every render would
   *  re-trigger the hydration effect on every render (client/INSIGHTS). */
  docs: ProjectDocument[];
  /** The agent's/skill's persisted document links (order + repo_id), from
   *  `useAgentDocuments`/`useSkillDocuments`. */
  links: TLink[] | undefined;
  /** The wholesale-replace mutation (`useSetAgentDocuments`/
   *  `useSetSkillDocuments`). Typed as the minimal subset this hook actually
   *  calls (not the full `UseMutateFunction`) — the real mutation's `mutate`
   *  is structurally assignable here (its `onSuccess`/`onSettled` accept
   *  more args than we declare, which is fine), and it keeps this hook
   *  test-doubleable with a plain `vi.fn()`. */
  setDocuments: {
    mutate: (
      variables: { paths: string[]; repoId: string },
      options?: { onSuccess?: () => void; onSettled?: () => void },
    ) => void;
  };
}

export interface UseDocumentAttachmentResult {
  order: string[];
  attached: Set<string>;
  toggle: (path: string, on: boolean) => void;
  onDrop: (targetPath: string) => void;
  dragId: React.MutableRefObject<string | null>;
  previewPath: string | null;
  togglePreview: (path: string) => void;
  preview: ReturnType<typeof useDocumentPreview>;
  attachedTokens: number;
}

/** Order all docs: attached (in link order) first — even one no longer
    present in the current repo's catalog, so it stays visible/detachable
    (attachments are portable paths, not tied to one repo clone — switching
    the picker only changes what you're BROWSING) — then the rest of the
    repo's catalog by list order. */
function initialOrder(docs: ProjectDocument[], linkedPaths: string[]): string[] {
  const rest = docs.filter((d) => !linkedPaths.includes(d.path)).map((d) => d.path);
  return [...linkedPaths, ...rest];
}

export function useDocumentAttachment<TLink extends DocumentLinkLike>({
  id,
  repoId,
  docs,
  links,
  setDocuments,
}: UseDocumentAttachmentArgs<TLink>): UseDocumentAttachmentResult {
  const [order, setOrder] = React.useState<string[]>([]);
  const [attached, setAttached] = React.useState<Set<string>>(new Set());
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const dragId = React.useRef<string | null>(null);
  // Per-path in-flight guard. The vendored Checkbox is a <button> in a
  // <label>, so one click fires onChange twice; if a re-render lands between
  // the two fires the second computes the opposite intent and
  // re-attaches/re-detaches. Drop the spurious second fire and clear the
  // guard when the mutation settles.
  const toggling = React.useRef<Set<string>>(new Set());

  const byPath = React.useMemo(() => new Map(docs.map((d) => [d.path, d])), [docs]);

  // Hydrate local state once the links (and current repo's catalog) land,
  // and whenever the agent/skill or repo changes.
  React.useEffect(() => {
    if (!links) return;
    const linkedPaths = [...links].sort((a, b) => a.order - b.order).map((l) => l.path);
    setOrder(initialOrder(docs, linkedPaths));
    setAttached(new Set(linkedPaths));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, links, docs]);

  const preview = useDocumentPreview(repoId, previewPath);

  const attachedTokens = order
    .filter((p) => attached.has(p))
    .reduce((sum, p) => sum + (byPath.get(p)?.tokens ?? 0), 0);

  /** Persist the current checked set in row order, scoped to the active
   *  repo. `toggle`/`onDrop` are only reachable while a list is shown (the
   *  caller renders an AC-38 empty state otherwise), so `repoId` is expected
   *  non-null here; a null `repoId` is a no-op guard rather than a mutation
   *  with a missing repo. */
  const persist = (
    nextOrder: string[],
    nextAttached: Set<string>,
    options?: { onSuccess?: () => void; onSettled?: () => void },
  ) => {
    if (!repoId) return;
    const paths = nextOrder.filter((p) => nextAttached.has(p));
    setDocuments.mutate({ paths, repoId }, options);
  };

  const toggle = (path: string, on: boolean) => {
    if (toggling.current.has(path)) return; // drop the label's duplicate fire

    toggling.current.add(path);
    const next = new Set(attached);
    if (on) next.add(path);
    else next.delete(path);
    setAttached(next);
    persist(order, next, { onSettled: () => toggling.current.delete(path) });
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

  return {
    order,
    attached,
    toggle,
    onDrop,
    dragId,
    previewPath,
    togglePreview,
    preview,
    attachedTokens,
  };
}
