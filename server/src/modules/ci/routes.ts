import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExportInput, CiRunStatus } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ValidationError } from '../../platform/errors.js';
import type { TriggerType } from './bundle.js';
import { UnresolvedSkillError, type ListCiRunsFilters } from './service.js';

/**
 * T7 — `ci` module routes (schema-first, `withTypeProvider<ZodTypeProvider>()`).
 * Fail-CI-on reuses the EXISTING `PATCH /agents/:id { ci_fail_on }` — no new
 * route here (AC-21, Rec3).
 *
 *   POST /agents/:id/ci/preview      → CiExport (no side effect) — AC-2/3/12
 *   POST /agents/:id/ci/install      → CiExport (commit+PR, idempotent) — AC-9/11/12/17
 *   GET  /agents/:id/ci/bundle.zip   → zip bytes (application/zip) — AC-10
 *   GET  /agents/:id/ci/installations → CiInstallation[] — AC-39/40
 *   GET  /ci-runs                    → CiRun[] (optional filters) — AC-35/36
 *   POST /ci/reconcile               → on-demand reconcile summary — AC-34
 *   GET  /agents/:id/runs            → RunSummary[] (local+ci, `source`) — AC-42
 */

/**
 * Preview only needs a subset of the full `CiExportInput` (repo + the two
 * generator-affecting knobs) — `target`/`action`/`base` are install-only and
 * are simply ignored if the client sends the same superset body it uses for
 * install (extra keys are stripped by default, non-strict Zod objects).
 */
const PreviewBody = z.object({
  repo: z.string().min(1),
  triggers: z.array(z.enum(['opened', 'synchronize', 'reopened'])).optional(),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).optional(),
});

const CiRunsQuery = z.object({
  agent_id: z.string().uuid().optional(),
  repo: z.string().optional(),
  status: CiRunStatus.optional(),
  /** Run origin (AC-36). Threaded into `ListCiRunsFilters` and applied in SQL
   *  with the other predicates — every `ci_runs` row is `source:'ci'` today,
   *  so `'local'` narrows to the empty set. */
  source: z.enum(['local', 'ci']).optional(),
  since: z.string().optional(),
});

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = app.container.ciService;

  app.post(
    '/agents/:id/ci/preview',
    { schema: { params: IdParams, body: PreviewBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      try {
        return await service.preview({
          workspaceId,
          agentId: req.params.id,
          repo: req.body.repo,
          triggers: req.body.triggers as TriggerType[] | undefined,
          postAs: req.body.post_as,
        });
      } catch (err) {
        // AC-12: block + name the unresolved skill as a 422, not a generic 500.
        if (err instanceof UnresolvedSkillError) throw new ValidationError(err.message);
        throw err;
      }
    },
  );

  app.post(
    '/agents/:id/ci/install',
    {
      schema: { params: IdParams, body: CiExportInput },
      // Expensive: a real commit + GitHub PR open — cap like the other
      // external-service-triggering routes (mirrors eval run-routes' 10/min).
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      try {
        // ExternalServiceError (PR-open failure, AC-11) and NotFoundError
        // flow straight to the central handler — no hand-rolled envelope.
        return await service.install({
          workspaceId,
          agentId: req.params.id,
          repo: req.body.repo,
          base: req.body.base,
          triggers: req.body.triggers as TriggerType[] | undefined,
          postAs: req.body.post_as,
        });
      } catch (err) {
        if (err instanceof UnresolvedSkillError) throw new ValidationError(err.message);
        throw err;
      }
    },
  );

  app.get('/agents/:id/ci/bundle.zip', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    try {
      const bytes = await service.exportZip({ workspaceId, agentId: req.params.id });
      reply
        .type('application/zip')
        .header('content-disposition', `attachment; filename="devdigest-ci-${req.params.id}.zip"`);
      return Buffer.from(bytes);
    } catch (err) {
      if (err instanceof UnresolvedSkillError) throw new ValidationError(err.message);
      throw err;
    }
  });

  app.get('/agents/:id/ci/installations', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listInstallations(workspaceId, req.params.id);
  });

  app.get('/ci-runs', { schema: { querystring: CiRunsQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const { source, agent_id, repo, status, since } = req.query;
    const filters: ListCiRunsFilters = {
      ...(agent_id ? { agentId: agent_id } : {}),
      ...(repo ? { repo } : {}),
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
      ...(since ? { since } : {}),
    };
    return service.listCiRuns(workspaceId, filters);
  });

  app.post(
    '/ci/reconcile',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      await getContext(app.container, req);
      return service.reconcile({ logger: req.log });
    },
  );

  app.get('/agents/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listAgentRuns(workspaceId, req.params.id);
  });
}
