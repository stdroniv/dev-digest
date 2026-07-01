/**
 * history — HTTP route plugin.
 *
 *   GET /pulls/:id/prior-prs → PrHistory  (git-log on the existing clone, zero AI)
 *
 * Route is schema-first: params validated by shared IdParams (uuid → 422);
 * response serialized by the vendored PrHistory Zod schema via fastify-type-provider-zod.
 * No hand-rolled .parse() in the handler.
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { HistoryService } from './service.js';
import { PrHistory } from '@devdigest/shared';

export default async function historyRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  /**
   * Prior PRs touching the same files as this PR.
   * Sources data from `git log` on the already-cloned repo.
   * Degrades to { history: [] } rather than 500 on any git/FS error.
   * Tighter per-route limit: each call fans out to one git-log per changed file.
   */
  app.get(
    '/pulls/:id/prior-prs',
    {
      schema: { params: IdParams, response: { 200: PrHistory } },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req): Promise<PrHistory> => {
      const { workspaceId } = await getContext(container, req);
      return new HistoryService(container).getPriorPrs(workspaceId, req.params.id);
    },
  );
}
