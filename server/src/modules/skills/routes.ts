import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { getRepoRef } from '../_shared/repo-ref.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import { ImportError } from './import-parse.js';
import { RepoRelativePath } from '../documents/path-safety.js';

/**
 * A1 — skills module (owner A1).
 *   GET    /skills                       → list (workspace-scoped, newest first)
 *   GET    /skills/:id                   → one skill
 *   POST   /skills                       → create (manual or post-import confirm)
 *   PUT    /skills/:id                   → update / toggle enabled (versions body)
 *   DELETE /skills/:id                   → delete
 *   GET    /skills/:id/versions          → body history (newest first)
 *   GET    /skills/:id/versions/:version → one body snapshot
 *   GET    /skills/:id/stats             → usage stats (agents, pull%, accept%, findings)
 *   POST   /skills/import                → parse a file/archive into a PREVIEW
 *   GET    /skills/:id/documents         → linked project-context documents (ordered)
 *   POST   /skills/:id/documents         → set/reorder linked documents (wholesale replace)
 *
 * The agent SIDE of the link table (`agent_skills`) is owned by the agents module
 * (`POST /agents/:id/skills`); this module never touches it.
 */

const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: SkillType,
  body: z.string().min(1),
  source: SkillSource.optional(),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

const ImportBody = z.object({
  filename: z.string().min(1),
  content_base64: z.string().min(1),
  name: z.string().optional(),
});

/** `GET /skills/:id/documents` — the repository whose per-repo list to read (AC-29). */
const DocumentsQuery = z.object({ repo_id: z.string().uuid() });

/**
 * Wholesale replace + reorder the skill's linked project-context documents
 * WITHIN one repository. Each path is validated as repo-relative (no
 * `..`/absolute escapes — `security`) BEFORE it's ever persisted, since it
 * gets re-read from the clone on every future run. `repo_id` is now always
 * required — each repository has its own independent ordered list (AC-29),
 * so even clearing (`paths: []`) must target a specific repo.
 */
const SetDocumentsBody = z.object({
  paths: z.array(RepoRelativePath),
  repo_id: z.string().uuid(),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const b = req.body;
    const skill = await service.create(workspaceId, {
      name: b.name,
      description: b.description,
      type: b.type,
      body: b.body,
      ...(b.source !== undefined ? { source: b.source } : {}),
      ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await service.getStats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Skill not found');
    return stats;
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get(
    '/skills/:id/versions/:version',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
      if (!version) throw new NotFoundError('Skill version not found');
      return version;
    },
  );

  // Import is a READ-ONLY parse → preview. It never persists; the client confirms
  // and then POSTs /skills. Executable archive entries are ignored upstream.
  app.post('/skills/import', { schema: { body: ImportBody } }, async (req) => {
    await getContext(app.container, req);
    try {
      return service.importPreview(req.body);
    } catch (err) {
      if (err instanceof ImportError) throw new ValidationError(err.message);
      throw err;
    }
  });

  app.get(
    '/skills/:id/documents',
    { schema: { params: IdParams, querystring: DocumentsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      // A `repo_id` must resolve to a repo in the caller's workspace before
      // it's used to scope the read (`security`, defense-in-depth ahead of
      // real multi-tenant auth).
      await getRepoRef(app.container.db, workspaceId, req.query.repo_id);
      const links = await service.documentLinks(workspaceId, req.params.id, req.query.repo_id);
      if (!links) throw new NotFoundError('Skill not found');
      return links;
    },
  );

  app.post(
    '/skills/:id/documents',
    { schema: { params: IdParams, body: SetDocumentsBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      // A `repo_id` must resolve to a repo in the caller's workspace before
      // it's threaded through to storage — 404s on a cross-workspace id
      // (`security`, defense-in-depth ahead of real multi-tenant auth).
      await getRepoRef(app.container.db, workspaceId, req.body.repo_id);
      const links = await service.setDocuments(
        workspaceId,
        req.params.id,
        req.body.paths,
        req.body.repo_id,
      );
      if (!links) throw new NotFoundError('Skill not found');
      return links;
    },
  );
}
