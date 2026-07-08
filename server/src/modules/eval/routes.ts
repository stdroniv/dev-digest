import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalExpectedFinding, EvalPromoteInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { EvalService } from './service.js';

/**
 * T7 — eval module routes (schema-first, AC-19). All `:id`/`:agentId` params
 * are workspace-scoped via `getContext`; a cross-workspace id 404s (defense-
 * in-depth, mirroring `agents`/`documents` routes) because every service
 * lookup is itself workspace-scoped.
 *
 *   POST   /findings/:id/eval-case      → create-from-finding (AC-1..AC-5)
 *   GET    /agents/:id/eval-cases       → list (AC-6)
 *   POST   /agents/:id/eval-cases       → author from scratch (AC-22)
 *   PUT    /eval-cases/:id              → rename + expected-output edit (AC-23)
 *   DELETE /eval-cases/:id              → soft-delete, retains run history (AC-24)
 *   POST   /agents/:id/eval-runs        → run all cases for the agent (AC-9)
 *   POST   /eval-cases/:id/eval-runs    → run a single case (AC-25)
 *   POST   /eval-runs/run-all-agents    → run every agent, isolated (AC-26)
 *   GET    /agents/:id/eval-runs        → run history, newest-first (AC-15)
 *   GET    /agents/:id/eval-dashboard   → agent metrics + delta + trend (AC-8/28)
 *   GET    /eval-dashboard              → cross-agent dashboard (AC-17)
 *   POST   /eval-runs/compare           → two run_group ids → EvalComparison (AC-16)
 *   POST   /agents/:id/eval-promote     → promote a version to active (AC-27)
 */

const AuthorCaseBody = z.object({
  name: z.string().min(1),
  input_diff: z.string().optional(),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.array(EvalExpectedFinding).optional(),
  notes: z.string().nullish(),
});

const UpdateCaseBody = z.object({
  name: z.string().min(1).optional(),
  expected_output: z.array(EvalExpectedFinding).optional(),
  notes: z.string().nullish(),
});

const CompareBody = z.object({
  old_run_group_id: z.string().uuid(),
  new_run_group_id: z.string().uuid(),
});

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalService(app.container);

  // ---- create-from-finding (AC-1..AC-5) ------------------------------------

  app.post('/findings/:id/eval-case', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.createCaseFromFinding(workspaceId, req.params.id);
    if (result.status === 'not_found') throw new NotFoundError('Finding not found');
    if (result.status === 'no_decision') {
      throw new ValidationError(
        'Finding has no decision (accept/dismiss) yet — an eval expectation cannot be derived',
      );
    }
    if (result.status === 'created') reply.status(201);
    return { case: result.case, already_added: result.status === 'already_exists' };
  });

  // ---- case management (AC-6, AC-22, AC-23, AC-24) -------------------------

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const cases = await service.listCases(workspaceId, req.params.id);
    if (!cases) throw new NotFoundError('Agent not found');
    return cases;
  });

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: AuthorCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.authorCase(workspaceId, req.params.id, req.body);
      if (!created) throw new NotFoundError('Agent not found');
      reply.status(201);
      return created;
    },
  );

  app.put('/eval-cases/:id', { schema: { params: IdParams, body: UpdateCaseBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const updated = await service.updateCase(workspaceId, req.params.id, req.body);
    if (!updated) throw new NotFoundError('Eval case not found');
    return updated;
  });

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Eval case not found');
    return { ok: true };
  });

  // ---- run orchestration (AC-9, AC-10, AC-25, AC-26) -----------------------

  // These three trigger real LLM calls per case (run-all-agents fans out over
  // every agent × every live case), so they carry the same per-route rate limit
  // as the other LLM-triggering routes in `reviews/routes.ts` to cap runaway cost.
  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.runAllForAgent(workspaceId, req.params.id);
    },
  );

  app.post(
    '/eval-cases/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.runSingleCase(workspaceId, req.params.id);
      if (!result) throw new NotFoundError('Eval case not found');
      return result;
    },
  );

  app.post(
    '/eval-runs/run-all-agents',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.runAllAgents(workspaceId);
    },
  );

  // ---- history + dashboard (AC-8, AC-14, AC-15, AC-17, AC-28) --------------

  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const history = await service.runHistory(workspaceId, req.params.id);
    if (!history) throw new NotFoundError('Agent not found');
    return history;
  });

  app.get('/agents/:id/eval-dashboard', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const dashboard = await service.agentDashboard(workspaceId, req.params.id);
    if (!dashboard) throw new NotFoundError('Agent not found');
    return dashboard;
  });

  app.get('/eval-dashboard', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.dashboard(workspaceId);
  });

  // ---- comparison + promote (AC-16, AC-27) ---------------------------------

  app.post('/eval-runs/compare', { schema: { body: CompareBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.compare(workspaceId, req.body.old_run_group_id, req.body.new_run_group_id);
  });

  app.post(
    '/agents/:id/eval-promote',
    { schema: { params: IdParams, body: EvalPromoteInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const agent = await service.promote(workspaceId, req.params.id, req.body.version);
      if (!agent) throw new NotFoundError('Agent not found');
      return agent;
    },
  );
}
