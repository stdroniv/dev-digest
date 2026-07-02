/**
 * Onboarding Tour routes (SPEC-02 T7) over a real Postgres.
 *
 * Boots the app with a mocked `llm` (MockLLMProvider — no real network) and a
 * mocked `repoIntel` (always a non-degraded indexed state, so grounding never
 * touches a real clone on disk) via `ContainerOverrides`. Polls a job to
 * completion via `container.jobs.onIdle()` — never a fixed sleep.
 *
 *   POST …/generate                              → 5 ready sections persisted
 *   POST …/sections/:kind/regenerate              → AC-24 section-scoped patch
 *   GET  …/tour  (not-cloned repo)                → availability:"unavailable" (AC-35)
 *   GET  …/tour  (stale stored index identity)    → stale:true (AC-30)
 *   persistence survives a fresh app/repository read (AC-29)
 *   AC-33 first-ever whole-tour failure            → availability:"empty" + job.error
 *   AC-33 whole-tour failure with a prior tour     → stays "ready", prior content intact
 *   AC-34 failing regen of an already-ready section → prior content/cost preserved
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import type { RepoIntel, IndexState } from '../repo-intel/types.js';
import type { GetTourResponse, TourJob, OnboardingTour, TourSectionKind } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[onboarding routes] Docker not available — skipping integration tests.');
}

const ALL_KINDS: TourSectionKind[] = [
  'architecture',
  'critical_paths',
  'how_to_run',
  'reading_path',
  'first_tasks',
];

function schemaNameFor(kind: TourSectionKind): string {
  const map: Record<TourSectionKind, string> = {
    architecture: 'ArchitectureContent',
    critical_paths: 'CriticalPathsContent',
    how_to_run: 'HowToRunContent',
    reading_path: 'ReadingPathContent',
    first_tasks: 'FirstTasksContent',
  };
  return map[kind];
}

const VALID_FIXTURE_BY_SCHEMA: Record<string, unknown> = {
  ArchitectureContent: {
    prose: 'The service starts in src/index.ts.',
    refs: ['src/index.ts'],
    diagram: { nodes: [{ id: 'src/index.ts', label: 'index.ts' }], edges: [] },
  },
  CriticalPathsContent: { rows: [{ path: 'src/index.ts', why: 'entry point' }] },
  HowToRunContent: { steps: [{ command: 'pnpm install' }] },
  ReadingPathContent: { steps: [{ path: 'src/index.ts', reason: 'start here' }] },
  FirstTasksContent: {
    tasks: [
      { title: 'Add a test', path: 'src/index.ts', complexity: 'low' },
      { title: 'Fix a bug', path: 'src/server.ts', complexity: 'medium' },
    ],
  },
};

/** Same valid fixtures, but with the given schemaName(s) swapped for a schema-invalid stub — forces `completeStructured` to throw for exactly those sections. */
function withBadSchema(...schemaNames: string[]): Record<string, unknown> {
  const out = { ...VALID_FIXTURE_BY_SCHEMA };
  for (const name of schemaNames) out[name] = { bogus: true };
  return out;
}

const ALL_SCHEMA_NAMES = Object.keys(VALID_FIXTURE_BY_SCHEMA);

const CURRENT_STATE: IndexState = {
  repoId: 'unused',
  status: 'full',
  filesIndexed: 7,
  filesSkipped: 0,
  durationMs: 5,
  lastIndexedSha: 'sha-current',
  indexerVersion: 4,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  degraded: false,
};

/** Non-degraded indexed repoIntel — grounding takes the index-grounded branch, never touching a real clone. */
function fakeRepoIntel(): RepoIntel {
  return {
    indexRepo: async () => ({ status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 }),
    refreshIndex: async () => ({ status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 }),
    getIndexState: async () => CURRENT_STATE,
    getBlastRadius: async () => ({ changedSymbols: [], callers: [], impactedEndpoints: [] }),
    getRepoMap: async () => ({ text: 'src/index.ts: main()', tokens: 5, cached: true }),
    getFileRank: async () => [],
    getSymbolsInFiles: async () => [],
    getCallerSignatures: async () => [],
    getUnresolvedReferences: async () => [],
    getConventionSamples: async () => [],
    getTopFilesByRank: async () => ['src/index.ts'],
    getCriticalPaths: async () => [['src/index.ts', 'src/server.ts']],
  };
}

d('onboarding tour routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });

  afterAll(async () => {
    await pg?.stop();
  });

  async function insertRepo(name: string, clonePath: string | null): Promise<string> {
    const [row] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return row!.id;
  }

  function makeApp(llm: MockLLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: llm }, repoIntel: fakeRepoIntel() },
    });
  }

  async function getTour(app: Awaited<ReturnType<typeof buildApp>>, repoId: string) {
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/tour` });
    return { statusCode: res.statusCode, body: res.json() as GetTourResponse };
  }

  it('POST generate → 5 ready sections persisted with per-section token costs', async () => {
    const repoId = await insertRepo('widgets-ready', '/mock/clones/acme/widgets-ready');
    const llm = new MockLLMProvider('openrouter', { structuredBySchema: VALID_FIXTURE_BY_SCHEMA });
    const app = await makeApp(llm);

    const genRes = await app.inject({ method: 'POST', url: `/repos/${repoId}/tour/generate` });
    expect(genRes.statusCode).toBe(202);
    const { job } = genRes.json() as { job: TourJob };
    expect(job.kind).toBe('whole');
    expect(['queued', 'running']).toContain(job.status);

    await app.container.jobs.onIdle();

    const { statusCode, body } = await getTour(app, repoId);
    expect(statusCode).toBe(200);
    expect(body.availability).toBe('ready');
    expect(body.stale).toBe(false);
    expect(body.tour!.sections).toHaveLength(5);
    for (const section of body.tour!.sections) {
      expect(section.status).toBe('ready');
      expect(section.content).not.toBeNull();
      expect(section.cost).toEqual({ tokensIn: 100, tokensOut: 50 });
      expect(section.generatedAt).not.toBeNull();
    }
    expect(body.job!.status).toBe('done');
    expect(body.job!.failedSectionKinds).toEqual([]);
    await app.close();
  });

  it('POST regenerate section (AC-24) changes only that section; the other four are byte-identical', async () => {
    const repoId = await insertRepo('widgets-section', '/mock/clones/acme/widgets-section');
    const app1 = await makeApp(
      new MockLLMProvider('openrouter', { structuredBySchema: VALID_FIXTURE_BY_SCHEMA }),
    );
    await app1.inject({ method: 'POST', url: `/repos/${repoId}/tour/generate` });
    await app1.container.jobs.onIdle();
    const before = (await getTour(app1, repoId)).body.tour!;
    await app1.close();

    const changedFixtures = {
      ...VALID_FIXTURE_BY_SCHEMA,
      CriticalPathsContent: { rows: [{ path: 'src/server.ts', why: 'a different reason' }] },
    };
    const app2 = await makeApp(new MockLLMProvider('openrouter', { structuredBySchema: changedFixtures }));
    const regenRes = await app2.inject({
      method: 'POST',
      url: `/repos/${repoId}/tour/sections/critical_paths/regenerate`,
    });
    expect(regenRes.statusCode).toBe(202);
    const { job } = regenRes.json() as { job: TourJob };
    expect(job.kind).toBe('section');
    expect(job.sectionKind).toBe('critical_paths');

    await app2.container.jobs.onIdle();

    const after = (await getTour(app2, repoId)).body.tour!;
    const changedSection = after.sections.find((s) => s.kind === 'critical_paths')!;
    expect(changedSection.status).toBe('ready');
    expect(changedSection.content).toEqual(changedFixtures.CriticalPathsContent);

    for (const kind of ALL_KINDS.filter((k) => k !== 'critical_paths')) {
      const b = before.sections.find((s) => s.kind === kind)!;
      const a = after.sections.find((s) => s.kind === kind)!;
      expect(a).toEqual(b);
    }
    await app2.close();
  });

  it('GET tour for a not-cloned repo returns availability:"unavailable" (AC-35)', async () => {
    const repoId = await insertRepo('widgets-unavailable', null);
    const app = await makeApp(new MockLLMProvider('openrouter', { structuredBySchema: VALID_FIXTURE_BY_SCHEMA }));
    const { statusCode, body } = await getTour(app, repoId);
    expect(statusCode).toBe(200);
    expect(body.availability).toBe('unavailable');
    expect(body.tour).toBeNull();
    await app.close();
  });

  it('GET tour returns stale:true when the stored index identity differs from the current one (AC-30)', async () => {
    const repoId = await insertRepo('widgets-stale', '/mock/clones/acme/widgets-stale');
    const staleTour: OnboardingTour = {
      repoId,
      sections: ALL_KINDS.map((kind) => ({
        kind,
        status: 'ready' as const,
        content: VALID_FIXTURE_BY_SCHEMA[schemaNameFor(kind)] as OnboardingTour['sections'][number]['content'],
        cost: { tokensIn: 10, tokensOut: 5 },
        error: null,
        generatedAt: '2025-01-01T00:00:00.000Z',
      })),
      provenance: {
        fileCount: 1,
        indexed: true,
        indexerVersion: 1, // stale vs CURRENT_STATE.indexerVersion = 4
        lastIndexedSha: 'sha-old', // stale vs CURRENT_STATE.lastIndexedSha
        model: 'deepseek/deepseek-v4-flash',
        githubUrl: 'https://github.com/acme/widgets-stale',
      },
      generatedAt: '2025-01-01T00:00:00.000Z',
    };
    await pg.handle.db
      .insert(t.onboarding)
      .values({ repoId, json: staleTour, generatedAt: new Date(staleTour.generatedAt) });

    const app = await makeApp(new MockLLMProvider('openrouter', { structuredBySchema: VALID_FIXTURE_BY_SCHEMA }));
    const { body } = await getTour(app, repoId);
    expect(body.availability).toBe('ready');
    expect(body.stale).toBe(true);
    await app.close();
  });

  it('persists across a fresh app instance / repository read (AC-29)', async () => {
    const repoId = await insertRepo('widgets-persist', '/mock/clones/acme/widgets-persist');
    const app1 = await makeApp(
      new MockLLMProvider('openrouter', { structuredBySchema: VALID_FIXTURE_BY_SCHEMA }),
    );
    await app1.inject({ method: 'POST', url: `/repos/${repoId}/tour/generate` });
    await app1.container.jobs.onIdle();
    const first = (await getTour(app1, repoId)).body.tour;
    await app1.close();

    const app2 = await makeApp(new MockLLMProvider('openrouter'));
    const second = (await getTour(app2, repoId)).body.tour;
    expect(second).toEqual(first);
    await app2.close();
  });

  it(
    'AC-33 first-ever generation fails → availability:"empty" with job.status:"failed" + a non-empty error ' +
      '(NOT a ready five-card tour)',
    async () => {
      const repoId = await insertRepo('widgets-first-fail', '/mock/clones/acme/widgets-first-fail');
      const app = await makeApp(
        new MockLLMProvider('openrouter', { structuredBySchema: withBadSchema(...ALL_SCHEMA_NAMES) }),
      );

      await app.inject({ method: 'POST', url: `/repos/${repoId}/tour/generate` });
      await app.container.jobs.onIdle();

      const { body } = await getTour(app, repoId);
      expect(body.availability).toBe('empty');
      expect(body.job!.status).toBe('failed');
      expect(body.job!.error).toBeTruthy();
      expect([...body.job!.failedSectionKinds].sort()).toEqual([...ALL_KINDS].sort());
      await app.close();
    },
  );

  it('AC-33 whole-tour regenerate fails with a prior tour present → stays "ready", prior content intact, job.error present', async () => {
    const repoId = await insertRepo('widgets-prior-fail', '/mock/clones/acme/widgets-prior-fail');
    const app1 = await makeApp(
      new MockLLMProvider('openrouter', { structuredBySchema: VALID_FIXTURE_BY_SCHEMA }),
    );
    await app1.inject({ method: 'POST', url: `/repos/${repoId}/tour/generate` });
    await app1.container.jobs.onIdle();
    const before = (await getTour(app1, repoId)).body.tour!;
    await app1.close();

    const app2 = await makeApp(
      new MockLLMProvider('openrouter', { structuredBySchema: withBadSchema(...ALL_SCHEMA_NAMES) }),
    );
    await app2.inject({ method: 'POST', url: `/repos/${repoId}/tour/generate` });
    await app2.container.jobs.onIdle();

    const { body } = await getTour(app2, repoId);
    expect(body.availability).toBe('ready');
    expect(body.job!.status).toBe('failed');
    expect(body.job!.error).toBeTruthy();
    for (const section of body.tour!.sections) {
      const prior = before.sections.find((s) => s.kind === section.kind)!;
      expect(section.status).toBe('failed');
      expect(section.content).toEqual(prior.content);
      expect(section.cost).toEqual(prior.cost);
      expect(section.generatedAt).toEqual(prior.generatedAt);
    }
    await app2.close();
  });

  it('AC-34 regenerating an already-populated section that fails keeps its prior content/cost/generatedAt; other sections + total unchanged', async () => {
    const repoId = await insertRepo('widgets-section-fail', '/mock/clones/acme/widgets-section-fail');
    const app1 = await makeApp(
      new MockLLMProvider('openrouter', { structuredBySchema: VALID_FIXTURE_BY_SCHEMA }),
    );
    await app1.inject({ method: 'POST', url: `/repos/${repoId}/tour/generate` });
    await app1.container.jobs.onIdle();
    const before = (await getTour(app1, repoId)).body.tour!;
    await app1.close();

    const app2 = await makeApp(
      new MockLLMProvider('openrouter', { structuredBySchema: withBadSchema('CriticalPathsContent') }),
    );
    await app2.inject({
      method: 'POST',
      url: `/repos/${repoId}/tour/sections/critical_paths/regenerate`,
    });
    await app2.container.jobs.onIdle();

    const { body } = await getTour(app2, repoId);
    expect(body.availability).toBe('ready');

    const failedSection = body.tour!.sections.find((s) => s.kind === 'critical_paths')!;
    const priorSection = before.sections.find((s) => s.kind === 'critical_paths')!;
    expect(failedSection.status).toBe('failed');
    expect(failedSection.error).toBeTruthy();
    expect(failedSection.content).toEqual(priorSection.content);
    expect(failedSection.cost).toEqual(priorSection.cost);
    expect(failedSection.generatedAt).toEqual(priorSection.generatedAt);

    for (const kind of ALL_KINDS.filter((k) => k !== 'critical_paths')) {
      const b = before.sections.find((s) => s.kind === kind)!;
      const a = body.tour!.sections.find((s) => s.kind === kind)!;
      expect(a).toEqual(b);
    }

    expect(body.job!.status).toBe('failed');
    expect(body.job!.sectionKind).toBe('critical_paths');
    expect(body.job!.failedSectionKinds).toEqual(['critical_paths']);
    await app2.close();
  });
});
