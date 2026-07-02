import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { NotFoundError } from '../../platform/errors.js';

export interface RepoRef {
  id: string;
  workspaceId: string;
  clonePath: string | null;
}

/**
 * Resolve a repo scoped to the caller's workspace, 404ing on a miss —
 * mirrors the inline `getRepoRef` in `documents/routes.ts`. Shared here so
 * any route accepting a client-supplied `repo_id` (e.g. the agent/skill
 * document-attach endpoints) can validate it actually belongs to the
 * caller's workspace before threading it through to storage, instead of
 * trusting it as a bare uuid.
 */
export async function getRepoRef(db: Db, workspaceId: string, repoId: string): Promise<RepoRef> {
  const [row] = await db
    .select({ id: t.repos.id, workspaceId: t.repos.workspaceId, clonePath: t.repos.clonePath })
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
  if (!row) throw new NotFoundError('Repo not found');
  return row;
}
