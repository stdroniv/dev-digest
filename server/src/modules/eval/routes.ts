import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalExpectedFinding, EvalPromoteInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { EvalService } from './service.js';

/**
 * T7 — eval module routes (schema-first, AC-19). All `:id`/`:agentId`/`:skillId`
 * params are workspace-scoped via `getContext`; a cross-workspace id 404s
 * (defense-in-depth, mirroring `agents`/`documents` routes) because every
 * service lookup is itself workspace-scoped.
 *
 *   GET    /findings/:id/eval-case/preview → non-saving preview of the frozen
 *                                            draft (Gap 2, T2)
 *   POST   /findings/:id/eval-case      → create-from-finding, optional edits
 *                                          body (AC-1..AC-5, Gap 2 T2)
 *   GET    /agents/:id/eval-cases       → list (AC-6)
 *   POST   /agents/:id/eval-cases       → author from scratch (AC-22)
 *   GET    /skills/:id/eval-cases       → skill-keyed list (R-G1-3)
 *   POST   /skills/:id/eval-cases       → skill-keyed author from scratch (R-G1-3)
 *   PUT    /eval-cases/:id              → rename + expected-output edit (AC-23)
 *   DELETE /eval-cases/:id              → soft-delete, retains run history (AC-24)
 *   POST   /agents/:id/eval-runs        → run all cases for the agent (AC-9)
 *   POST   /skills/:id/eval-runs        → run all cases for the skill (R-G1-4)
 *   POST   /eval-cases/:id/eval-runs    → run a single case, agent OR skill (AC-25)
 *   POST   /eval-runs/run-all-agents    → run every agent, isolated (AC-26)
 *   GET    /agents/:id/eval-runs        → run history, newest-first (AC-15)
 *   GET    /skills/:id/eval-runs        → skill-keyed run history (R-G1-4)
 *   GET    /agents/:id/eval-dashboard   → agent metrics + delta + trend (AC-8/28)
 *   GET    /skills/:id/eval-dashboard   → skill metrics + delta + trend (R-G1-5)
 *   GET    /eval-dashboard              → cross-agent dashboard (AC-17; agent-only, A3)
 *   POST   /eval-runs/compare           → two run_group ids → EvalComparison (AC-16)
 *   POST   /agents/:id/eval-promote     → promote a version to active (AC-27)
 *
 * Skill compare/promote are intentionally NOT added (A3 — agent-version-config
 * specific; see docs/plans/skill-evals-tab-and-eval-case-modal.md).
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

/**
 * Optional edits (Gap 2, T2/A2) applied over the frozen draft before insert.
 * MUST accept a MISSING body so the existing no-body call site keeps working
 * (AC-3 one-click still valid programmatically) — `.nullish()`, not just
 * `.optional()`: a bodyless `app.inject`/fetch POST arrives as `request.body
 * === null` (no Content-Type to parse), not `undefined`, so `.optional()`
 * alone 422s a real no-body call (verified via T3's it.test). The frozen
 * `input_diff` is not an accepted override (R-G2-3) — only `name`/
 * `expected_output` are editable.
 */
const FindingCaseEditsBody = z
  .object({
    name: z.string().min(1).optional(),
    expected_output: z.array(EvalExpectedFinding).optional(),
  })
  .nullish();

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalService(app.container);

  // ---- create-from-finding (AC-1..AC-5; Gap 2 preview T2) -------------------

  // Non-saving preview (GET, no LLM call → no extra rate limit needed). Mirrors
  // the POST route's not_found/no_decision handling.
  app.get(
    '/findings/:id/eval-case/preview',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.previewCaseFromFinding(workspaceId, req.params.id);
      if (result.status === 'not_found') throw new NotFoundError('Finding not found');
      if (result.status === 'no_decision') {
        throw new ValidationError(
          'Finding has no decision (accept/dismiss) yet — an eval expectation cannot be derived',
        );
      }
      return result.preview;
    },
  );

  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams, body: FindingCaseEditsBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.createCaseFromFinding(workspaceId, req.params.id, req.body ?? undefined);
      if (result.status === 'not_found') throw new NotFoundError('Finding not found');
      if (result.status === 'no_decision') {
        throw new ValidationError(
          'Finding has no decision (accept/dismiss) yet — an eval expectation cannot be derived',
        );
      }
      if (result.status === 'created') reply.status(201);
      return { case: result.case, already_added: result.status === 'already_exists' };
    },
  );

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

  // ---- skill-keyed case management (R-G1-3) --------------------------------

  app.get('/skills/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const cases = await service.listSkillCases(workspaceId, req.params.id);
    if (!cases) throw new NotFoundError('Skill not found');
    return cases;
  });

  app.post(
    '/skills/:id/eval-cases',
    { schema: { params: IdParams, body: AuthorCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.authorSkillCase(workspaceId, req.params.id, req.body);
      if (!created) throw new NotFoundError('Skill not found');
      reply.status(201);
      return created;
    },
  );

  // Update/delete/run-single are OWNER-AGNOSTIC (`/eval-cases/:id...`) and
  // already work for a skill-owned case — no new routes needed (A3/T9).

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
    '/skills/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const run = await service.runAllForSkill(workspaceId, req.params.id);
      if (!run) throw new NotFoundError('Skill not found');
      return run;
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

  // ---- history + dashboard (AC-8, AC-14, AC-15, AC-17, AC-28; R-G1-4/5) ----

  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const history = await service.runHistory(workspaceId, req.params.id);
    if (!history) throw new NotFoundError('Agent not found');
    return history;
  });

  app.get('/skills/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const history = await service.skillRunHistory(workspaceId, req.params.id);
    if (!history) throw new NotFoundError('Skill not found');
    return history;
  });

  app.get('/agents/:id/eval-dashboard', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const dashboard = await service.agentDashboard(workspaceId, req.params.id);
    if (!dashboard) throw new NotFoundError('Agent not found');
    return dashboard;
  });

  app.get('/skills/:id/eval-dashboard', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const dashboard = await service.skillDashboard(workspaceId, req.params.id);
    if (!dashboard) throw new NotFoundError('Skill not found');
    return dashboard;
  });

  // Cross-owner dashboard stays agent-only (A3 — compare/promote are agent-
  // version-config specific; there is no skill-owner equivalent to fold in).
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
