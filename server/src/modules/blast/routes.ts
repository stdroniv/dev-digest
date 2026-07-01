/**
 * blast — HTTP route plugin.
 *
 *   GET /pulls/:id/blast         → BlastResponse  (facade read + shaping, zero AI)
 *   GET /pulls/:id/blast/summary → BlastSummaryResponse (optional one-call LLM)
 *
 * Routes are schema-first: params validated by shared IdParams (uuid).
 * No hand-rolled body/params parsing.
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';
import { BlastSummaryService } from './summary.service.js';
import type { BlastResponse, BlastSummaryResponse } from './types.js';

export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  /**
   * Core blast-radius read — zero model calls.
   * Returns the shaped grouped payload from the repoIntel facade.
   */
  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams } },
    async (req): Promise<BlastResponse> => {
      const { workspaceId } = await getContext(container, req);
      return new BlastService(container).getBlast(workspaceId, req.params.id);
    },
  );

  /**
   * Optional LLM summary — one cheap-model call, in-memory cached.
   * Returns skipped:'no_key' (no error) when no provider is configured.
   * Tighter per-route limit: each call can fan out to a paid LLM round-trip.
   */
  app.get(
    '/pulls/:id/blast/summary',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req): Promise<BlastSummaryResponse> => {
      const { workspaceId } = await getContext(container, req);
      return new BlastSummaryService(container).getSummary(workspaceId, req.params.id);
    },
  );
}
