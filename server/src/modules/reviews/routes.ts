import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { RunRequest } from '@devdigest/shared';
import type { RunEvent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';
import { IntentService } from './intent.service.js';
import { SmartDiffService } from './smart-diff.service.js';
import { RisksService } from './risks.service.js';
import { WhyRiskBriefService } from '../why-risk-brief/service.js';
import { FileSummaryService } from '../file-summary/service.js';

/**
 * reviews module.
 *   POST   /pulls/:id/review      {agentId} | {all:true}  → run review(s); returns runs
 *   POST   /pulls/:id/intent                               → compute/recompute PR intent (LLM)
 *   GET    /pulls/:id/intent                               → read stored PR intent
 *   GET    /pulls/:id/risks                               → read stored PR risk areas
 *   GET    /pulls/:id/smart-diff                           → risk-ordered diff grouping (no LLM)
 *   POST   /pulls/:id/why-risk-brief                       → (re)compute + persist the Why+Risk Brief (LLM)
 *   GET    /pulls/:id/why-risk-brief                       → read cached Why+Risk Brief (never computes)
 *   POST   /pulls/:id/file-summary                         → (re)compute + persist a per-file "What this does" summary (LLM)
 *   GET    /pulls/:id/file-summary                          → read cached per-file summary (never computes)
 *   GET    /runs/:id/events                                → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                                 → the single-document RunTrace
 *   GET    /pulls/:id/reviews                              → persisted reviews + findings for a PR
 *   POST   /findings/:id/(accept|dismiss)                  → finding actions
 */
const FINDING_ACTIONS = ['accept', 'dismiss'] as const;

/** Body for POST /pulls/:id/file-summary. */
const FileSummaryBody = z.object({
  path: z.string(),
  regenerate: z.boolean().optional(),
});

/** Querystring for GET /pulls/:id/file-summary. */
const FileSummaryQuery = z.object({
  path: z.string(),
});

export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);
  const intentService = new IntentService(container);
  const smartDiffService = new SmartDiffService(container);
  const risksService = new RisksService(container);
  const whyRiskBriefService = new WhyRiskBriefService(container);
  const fileSummaryService = new FileSummaryService(container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  // Body stays a tolerant manual parse (both fields optional; empty body is OK).
  app.post(
    '/pulls/:id/review',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = RunRequest.parse(req.body ?? {});
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    const { runs, reviews } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
    );
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- Intent: (re)compute or read the PR's classified intent ---------------
  // POST recomputes (same rate limit as the review trigger — each call is an
  // LLM round-trip). GET is a lightweight read; no rate limit needed.
  app.post(
    '/pulls/:id/intent',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await intentService.compute(workspaceId, req.params.id, { logger: req.log });
      return result.intent;
    },
  );

  app.get('/pulls/:id/intent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const intent = await intentService.get(workspaceId, req.params.id);
    return intent ?? null;
  });

  app.get('/pulls/:id/risks', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return (await risksService.get(workspaceId, req.params.id)) ?? null;
  });

  // ---- Smart Diff: risk-ordered diff grouping (deterministic, no LLM) ------
  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return smartDiffService.get(workspaceId, req.params.id);
  });

  // ---- Why+Risk Brief: (re)compute or read the cached standalone brief ----
  // POST recomputes and replaces the cached brief (same rate limit as the
  // review/intent triggers — each call is an LLM round-trip, AC-28). GET is a
  // lightweight cached read; it NEVER computes (AC-14).
  app.post(
    '/pulls/:id/why-risk-brief',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return whyRiskBriefService.compute(workspaceId, req.params.id, { logger: req.log });
    },
  );

  app.get('/pulls/:id/why-risk-brief', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return whyRiskBriefService.get(workspaceId, req.params.id);
  });

  // ---- File Summary: (re)compute or read a cached per-file "What this does" summary ----
  // POST recomputes and replaces the cached summary for one file (same rate
  // limit as the review/intent/why-risk-brief triggers — each call is an LLM
  // round-trip). GET is a lightweight cached read; it NEVER computes.
  app.post(
    '/pulls/:id/file-summary',
    {
      schema: { params: IdParams, body: FileSummaryBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return fileSummaryService.compute(workspaceId, req.params.id, req.body.path, {
        ...(req.body.regenerate !== undefined ? { regenerate: req.body.regenerate } : {}),
        logger: req.log,
      });
    },
  );

  app.get(
    '/pulls/:id/file-summary',
    { schema: { params: IdParams, querystring: FileSummaryQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return fileSummaryService.get(workspaceId, req.params.id, req.query.path);
    },
  );

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
    await getContext(container, req);
    const runId = req.params.id;

    reply.sse(
      (async function* () {
        // Bridge the in-memory RunBus to an async iterator the SSE plugin drains.
        const queue: RunEvent[] = [];
        let resolve: (() => void) | null = null;
        let done = false;

        const unsubscribe = container.runBus.subscribe(runId, (e) => {
          queue.push(e);
          resolve?.();
        });
        const offDone = container.runBus.onDone(runId, () => {
          done = true;
          resolve?.();
        });

        try {
          while (true) {
            if (queue.length === 0) {
              if (done) break;
              await new Promise<void>((r) => (resolve = r));
              resolve = null;
              continue;
            }
            const e = queue.shift()!;
            yield {
              id: String(e.seq),
              event: e.kind,
              data: JSON.stringify(e),
            };
          }
        } finally {
          unsubscribe();
          offDone();
        }
      })(),
    );
  });

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get('/pulls/:id/runs/active', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.activeRuns(workspaceId, req.params.id);
  });

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete('/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post('/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    await service.cancelRun(req.params.id);
    return { ok: true };
  });

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get('/runs/:id/trace', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get('/pulls/:id/reviews', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Review not found');
    return { ok: true };
  });

  // ---- Finding actions (accept / dismiss) ---------------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(`/findings/:id/${action}`, { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.actOnFinding(workspaceId, req.params.id, action);
      return result;
    });
  }
}
