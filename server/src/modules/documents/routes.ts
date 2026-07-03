import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { DocumentsService, type RepoCloneRef } from './service.js';
import { RepoRelativePath } from './path-safety.js';

/**
 * Project Context documents module (SPEC-01 T6) — list + preview.
 *   GET /repos/:id/documents          → discovered `.md` docs + a `ready |
 *     not_cloned | empty` state (AC-4/5), each doc carrying its `tokens` estimate.
 *   GET /repos/:id/documents/content  → fresh file content for one path, for the
 *     preview pane (AC-3/14). Wiring for attaching documents to agents/skills
 *     lives in T7/T8; this module only discovers + previews.
 */

/**
 * Reject any `path` that isn't a plain repo-relative path before it ever
 * reaches `DocumentsService.readContent`/`preview` — those methods do no
 * traversal guarding themselves (they just `join(clonePath, path)`), so this
 * is the actual security boundary against `..`/absolute-path escapes out of
 * the clone directory (`security` skill). Shared with the agent/skill
 * document-attach endpoints via `./path-safety.js`.
 */
const ContentQuery = z.object({
  path: RepoRelativePath,
});

export default async function documentsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new DocumentsService(app.container);

  /** Minimal workspace-scoped repo lookup — mirrors `workspace/routes.ts`. */
  async function getRepoRef(workspaceId: string, repoId: string): Promise<RepoCloneRef> {
    const [row] = await app.container.db
      .select({ id: t.repos.id, workspaceId: t.repos.workspaceId, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    if (!row) throw new NotFoundError('Repo not found');
    return row;
  }

  app.get('/repos/:id/documents', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const repo = await getRepoRef(workspaceId, req.params.id);
    const result = await service.discover(repo);
    if (!result.cloned) {
      return { documents: [], state: 'not_cloned' as const };
    }
    return {
      documents: result.documents,
      state: result.documents.length === 0 ? ('empty' as const) : ('ready' as const),
    };
  });

  app.get(
    '/repos/:id/documents/content',
    { schema: { params: IdParams, querystring: ContentQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const repo = await getRepoRef(workspaceId, req.params.id);
      const content = await service.preview(repo, req.query.path);
      if (content == null) throw new NotFoundError('Document not found');
      return { path: req.query.path, content };
    },
  );
}
