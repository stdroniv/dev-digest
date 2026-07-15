import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { MemoryService } from './service.js';

/**
 * T6 — minimal `memory` module (Knowledge/RAG). One route:
 *
 *   POST /findings/:id/learn → "Learn" (AC-25): seed a durable, repo-scoped
 *                              memory row from a finding, attributable to the
 *                              finding and its producing agent + PR. No LLM
 *                              call (Non-functional "No added model cost").
 *
 * NOT registered in `modules/index.ts` here (T8 owns that single-edit wiring,
 * to keep this module's owned paths disjoint from T5's).
 */
export default async function memoryRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new MemoryService(app.container);

  app.post('/findings/:id/learn', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.learnFromFinding(workspaceId, req.params.id);
    if (result.status === 'not_found') throw new NotFoundError('Finding not found');
    reply.status(201);
    return { memory_id: result.memoryId };
  });
}
