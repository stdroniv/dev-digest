import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionStatus } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions Extractor module.
 *   POST /repos/:id/conventions/extract        → run a scan; persist verified candidates
 *   GET  /repos/:id/conventions                → list candidates for a repo
 *   PATCH /conventions/:id                      → accept / reject / edit one candidate
 *   POST /repos/:id/conventions/skill-preview   → assemble the editable skill from ACCEPTED
 *
 * The generated skill is persisted through the existing skills module
 * (POST /skills with source=extracted) once the user confirms in the modal.
 */

const PatchBody = z
  .object({
    status: ConventionStatus.optional(),
    category: z.string().min(1).optional(),
    rule: z.string().min(1).optional(),
  })
  .refine((b) => b.status !== undefined || b.category !== undefined || b.rule !== undefined, {
    message: 'Provide at least one of: status, category, rule.',
  });

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  // Extraction calls a model — tighter per-route limit than the global 120/min.
  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.extract(workspaceId, req.params.id);
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.patch('/conventions/:id', { schema: { params: IdParams, body: PatchBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const updated = await service.patch(workspaceId, req.params.id, req.body);
    if (!updated) throw new NotFoundError('Convention not found');
    return updated;
  });

  app.post(
    '/repos/:id/conventions/skill-preview',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const preview = await service.buildSkillPreview(workspaceId, req.params.id);
      if (!preview) throw new NotFoundError('Repo not found');
      return preview;
    },
  );
}
