/**
 * multi-agent-review — HTTP route plugin.
 *
 *   POST /pulls/:id/multi-agent-run   {agent_ids}  → launch a run over a
 *                                                     curated agent set; returns
 *                                                     immediately (non-blocking)
 *   GET  /multi-agent-runs/:id                     → the grouped run: columns,
 *                                                     summed totals, disagreement
 *                                                     grouping (all derived on read)
 *   GET  /multi-agent/estimates                    → per-enabled-agent pre-launch
 *                                                     time/cost estimate
 *
 * Schema-first throughout (Zod `params`/`body`/`response` via
 * `fastify-type-provider-zod`) — no hand-rolled `.parse()` in a handler.
 * Registration itself is T8's job (`modules/index.ts`), not this file's.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MultiAgentRun, MultiAgentRunRequest } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { MultiAgentReviewService } from './service.js';

/**
 * GET /multi-agent/estimates response row. Module-local (NOT a shared
 * vendored contract) — the plan pins this exact shape for the client's
 * `useAgentEstimates` hook to consume directly.
 */
const EstimateRow = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  avg_latency_ms: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  runs: z.number().int(),
});

const EstimatesResponse = z.object({ estimates: z.array(EstimateRow) });

export default async function multiAgentReviewRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new MultiAgentReviewService(container);

  // ---- Launch a multi-agent run --------------------------------------------
  // Tight per-route limit, mirroring POST /pulls/:id/review: each call fans
  // out to N expensive LLM runs.
  app.post(
    '/pulls/:id/multi-agent-run',
    {
      schema: { params: IdParams, body: MultiAgentRunRequest },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.launch(workspaceId, req.params.id, req.body.agent_ids, req.log);
    },
  );

  // ---- Read a grouped run (columns + totals + disagreement grouping) ------
  app.get(
    '/multi-agent-runs/:id',
    { schema: { params: IdParams, response: { 200: MultiAgentRun } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getRun(workspaceId, req.params.id);
    },
  );

  // ---- Pre-launch estimates (one row per enabled agent) --------------------
  app.get(
    '/multi-agent/estimates',
    { schema: { response: { 200: EstimatesResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getEstimates(workspaceId);
    },
  );
}
