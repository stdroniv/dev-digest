import { z } from 'zod';

/**
 * Shared repo-relative path safety guard (SPEC-01 security fix).
 *
 * Rejects any path that isn't a plain repo-relative path BEFORE it reaches
 * `DocumentsService.readContent`/`preview`/`readFromClone` — those methods do
 * no traversal guarding of their own (they just `join(clonePath, path)`), so
 * this is the actual security boundary against `..`/absolute-path escapes out
 * of the clone directory (`security` skill).
 *
 * Originally lived only on the documents-preview `?path=` query
 * (`documents/routes.ts` `ContentQuery`); extracted here so the SAME guard
 * also applies to `SetDocumentsBody.paths` on the agent/skill attach
 * endpoints (`agents/routes.ts`, `skills/routes.ts`) — those persist paths
 * that get re-read on every future run, so an unvalidated path there is a
 * standing traversal vector, not just a one-shot preview request.
 */
const PATH_TRAVERSAL_RE = /(^|\/)\.\.(\/|$)/;
const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;

export function isRepoRelativePath(p: string): boolean {
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  if (WINDOWS_ABS_RE.test(p)) return false;
  if (PATH_TRAVERSAL_RE.test(p.split('\\').join('/'))) return false;
  return true;
}

/** A single repo-relative path — rejects absolute paths, Windows drive-absolute forms, and `..` segments. */
export const RepoRelativePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.startsWith('\\') && !WINDOWS_ABS_RE.test(p), {
    message: 'path must be a repo-relative path, not absolute',
  })
  .refine((p) => !PATH_TRAVERSAL_RE.test(p.split('\\').join('/')), {
    message: 'path must not contain ".." segments',
  });
