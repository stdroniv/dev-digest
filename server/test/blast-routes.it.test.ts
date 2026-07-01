/**
 * blast routes — DB-backed integration tests (testcontainers Postgres).
 *
 * Acceptance:
 *  - GET /pulls/:id/blast → 200 with grouped BlastResponse shape (facade called).
 *  - Grouped shape: symbol groups, callers, endpoints, totals, index block present.
 *  - No LLM provider is constructed on the core blast path.
 *  - Non-existent PR → 404.
 *
 * Seeds: workspace + repo + PR + pr_files (no GitHub token needed).
 * Injects a mock RepoIntel via ContainerOverrides so no real indexer runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { BlastResult, IndexState } from '../src/modules/repo-intel/types.js';
import type { BlastResponse } from '../src/modules/blast/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// ---------------------------------------------------------------------------
// Mock RepoIntel facade
// ---------------------------------------------------------------------------

const MOCK_INDEX_STATE: IndexState = {
  repoId: 'any',
  lastIndexedSha: 'def789abc',
  indexerVersion: 1,
  updatedAt: new Date('2024-01-01'),
  status: 'full',
  filesIndexed: 5,
  filesSkipped: 0,
  durationMs: 50,
};

const MOCK_BLAST_RESULT: BlastResult = {
  changedSymbols: [
    { file: 'src/payments.ts', name: 'processPayment', kind: 'function' },
  ],
  callers: [
    { file: 'src/api/checkout.ts', symbol: 'handleCheckout', viaSymbol: 'processPayment', line: 42, rank: 9 },
    { file: 'src/api/refunds.ts', symbol: 'handleRefund', viaSymbol: 'processPayment', line: 18, rank: 7 },
  ],
  impactedEndpoints: ['POST /api/checkout', 'POST /api/refunds'],
  factsByFile: {
    'src/api/checkout.ts': { endpoints: ['POST /api/checkout'], crons: [] },
    'src/api/refunds.ts': { endpoints: ['POST /api/refunds'], crons: [] },
  },
};

/** Mock implementation of the RepoIntel facade — returns deterministic fixtures. */
function buildMockRepoIntel(): RepoIntel & { blastCalls: number } {
  let blastCalls = 0;
  return {
    blastCalls: 0,
    async getBlastRadius(_repoId: string, _changedFiles: string[]): Promise<BlastResult> {
      blastCalls++;
      (this as { blastCalls: number }).blastCalls = blastCalls;
      return MOCK_BLAST_RESULT;
    },
    async getIndexState(_repoId: string): Promise<IndexState> {
      return MOCK_INDEX_STATE;
    },
    // Remaining methods are not used by the blast route; stubs that return safe defaults.
    async indexRepo() { return { status: 'full' as const, filesIndexed: 0, filesSkipped: 0, durationMs: 0 }; },
    async refreshIndex() { return { status: 'full' as const, filesIndexed: 0, filesSkipped: 0, durationMs: 0 }; },
    async getRepoMap() { return { text: '', tokens: 0, cached: false }; },
    async getFileRank() { return []; },
    async getSymbolsInFiles() { return []; },
    async getCallerSignatures() { return []; },
    async getUnresolvedReferences() { return []; },
    async getConventionSamples() { return []; },
    async getTopFilesByRank() { return []; },
    async getCriticalPaths() { return []; },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let repoSeq = 0;

async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `blast-rt-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme-blast', name, fullName: `acme-blast/${name}` })
    .returning();

  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 800 + repoSeq,
      title: 'Refactor payment processing',
      author: 'dev',
      branch: 'feat/payments',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 30,
      deletions: 5,
      filesCount: 1,
      status: 'needs_review',
      body: null,
    })
    .returning();

  // Seed pr_files so getBlast has changed files to pass to the facade.
  await db.insert(t.prFiles).values([
    { prId: pr!.id, path: 'src/payments.ts', additions: 30, deletions: 5 },
  ]);

  return { repo: repo!, pr: pr! };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

d('blast routes — DB-backed (testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(repoIntel: RepoIntel) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        // No LLM keys — proves the core blast path makes zero LLM calls.
        secrets: new MockSecretsProvider({}),
        repoIntel,
      },
    });
  }

  it('GET /pulls/:id/blast → 200 with grouped BlastResponse shape', async () => {
    const mockRepoIntel = buildMockRepoIntel();
    const app = await makeApp(mockRepoIntel);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastResponse;

    // Symbol groups
    expect(body.symbols).toHaveLength(1);
    expect(body.symbols[0]!.name).toBe('processPayment');
    expect(body.symbols[0]!.callers).toHaveLength(2);

    // Caller rank-desc sort
    expect(body.symbols[0]!.callers[0]!.rank).toBeGreaterThanOrEqual(
      body.symbols[0]!.callers[1]!.rank,
    );

    // Endpoints attributed
    expect(body.symbols[0]!.endpoints).toContain('POST /api/checkout');
    expect(body.symbols[0]!.endpoints).toContain('POST /api/refunds');

    // Totals
    expect(body.totals.symbols).toBe(1);
    expect(body.totals.callers).toBe(2);
    expect(body.totals.endpoints).toBe(2);

    // Flat union
    expect(body.impactedEndpoints).toContain('POST /api/checkout');
    expect(body.impactedEndpoints).toContain('POST /api/refunds');

    // Index block
    expect(body.index.status).toBe('full');
    expect(body.index.lastIndexedSha).toBe('def789abc');

    await app.close();
  });

  it('GET /pulls/:id/blast calls repoIntel.getBlastRadius exactly once', async () => {
    const mockRepoIntel = buildMockRepoIntel();
    const app = await makeApp(mockRepoIntel);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });

    expect(mockRepoIntel.blastCalls).toBe(1);

    await app.close();
  });

  it('GET /pulls/:id/blast → 404 for a non-existent PR id', async () => {
    const mockRepoIntel = buildMockRepoIntel();
    const app = await makeApp(mockRepoIntel);
    const fakePrId = '00000000-0000-0000-0000-000000000000';

    const res = await app.inject({ method: 'GET', url: `/pulls/${fakePrId}/blast` });

    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('GET /pulls/:id/blast → 422 for a non-uuid id', async () => {
    const mockRepoIntel = buildMockRepoIntel();
    const app = await makeApp(mockRepoIntel);

    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' });

    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('GET /pulls/:id/blast does not construct any LLM provider (zero AI on core path)', async () => {
    // MockSecretsProvider({}) has no API keys. If BlastService accidentally calls
    // container.llm(id), the Container will throw ConfigError (no key). Since no
    // LLM override is injected and secrets are empty, any llm() call would throw
    // and the test would fail with a 500 error (not 200). The 200 above already
    // proves this — but we add a parallel check by asserting no 500s.
    const mockRepoIntel = buildMockRepoIntel();
    const app = await makeApp(mockRepoIntel);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });

    // 200 with no keys configured proves LLM was never constructed.
    expect(res.statusCode).toBe(200);

    await app.close();
  });
});
