/**
 * Onboarding Tour HTTP module (SPEC-02).
 *
 *   GET  /repos/:id/tour                              → GetTourResponse
 *   POST /repos/:id/tour/generate                      → { job: TourJob } (202)
 *   POST /repos/:id/tour/sections/:kind/regenerate     → { job: TourJob } (202)
 *
 * Schema-first (`fastify-type-provider-zod`); the two generate endpoints
 * return immediately with a `TourJob` — they never block on the 30-60s
 * generation, which runs as a background `container.jobs` job (AC-28).
 *
 * Touching `container.onboarding` (the lazy singleton getter,
 * `platform/container.ts`) here registers the `onboarding.generate` /
 * `onboarding.regenerate-section` job handlers exactly once, at module-plugin
 * registration (app bootstrap) — mirrors `repo-intel/routes.ts`.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import { TourSectionKind, type GetTourResponse, type TourJob } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import type { OnboardingRepoRef } from './grounding.js';

const SectionParams = IdParams.extend({ kind: TourSectionKind });

export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = container.onboarding;

  /** Minimal workspace-scoped repo lookup — mirrors `documents/routes.ts`. */
  async function getRepoRef(workspaceId: string, repoId: string): Promise<OnboardingRepoRef> {
    const [row] = await container.db
      .select({
        id: t.repos.id,
        workspaceId: t.repos.workspaceId,
        owner: t.repos.owner,
        name: t.repos.name,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    if (!row) throw new NotFoundError('Repo not found');
    return row;
  }

  app.get(
    '/repos/:id/tour',
    { schema: { params: IdParams } },
    async (req): Promise<GetTourResponse> => {
      const { workspaceId } = await getContext(container, req);
      const repo = await getRepoRef(workspaceId, req.params.id);
      return service.getTour(repo);
    },
  );

  // Generation calls a model 5x (whole tour) — tighter per-route limit than
  // the global 120/min, consistent with other expensive endpoints
  // (conventions/extract, blast/summary).
  app.post(
    '/repos/:id/tour/generate',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply): Promise<{ job: TourJob }> => {
      const { workspaceId } = await getContext(container, req);
      const repo = await getRepoRef(workspaceId, req.params.id);
      const job = await service.startWhole(workspaceId, repo);
      reply.code(202);
      return { job };
    },
  );

  app.post(
    '/repos/:id/tour/sections/:kind/regenerate',
    {
      schema: { params: SectionParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply): Promise<{ job: TourJob }> => {
      const { workspaceId } = await getContext(container, req);
      const repo = await getRepoRef(workspaceId, req.params.id);
      const job = await service.regenerateSection(workspaceId, repo, req.params.kind);
      reply.code(202);
      return { job };
    },
  );
}
