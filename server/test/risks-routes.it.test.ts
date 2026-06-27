/**
 * Risks routes — DB-backed integration tests.
 *
 * Acceptance:
 *  - GET /pulls/:id/risks returns null (200) for a PR that has no computed brief.
 *  - GET /pulls/:id/risks returns 404 for a non-existent PR id.
 *  - upsertBrief is idempotent: a second write replaces the row without constraint error.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockLLMProvider,
  MockEmbedder,
  MockGitHubClient,
  MockGitClient,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { getBrief, upsertBrief } from '../src/modules/reviews/repository/pull.repo.js';
import { PrBrief } from '@devdigest/shared';
import type { Risks } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// ---- shared fixtures -------------------------------------------------------

const RISKS_V1: Risks = {
  risks: [
    {
      kind: 'regression',
      title: 'Auth middleware reorder may break session handling',
      explanation: 'Moving the session middleware after auth can break CSRF checks.',
      severity: 'medium',
      file_refs: ['src/middleware.ts'],
    },
  ],
};

const RISKS_V2: Risks = {
  risks: [
    {
      kind: 'security',
      title: 'Secret key committed in plain text',
      explanation: 'A live API key was found hard-coded in the config file.',
      severity: 'high',
      file_refs: ['src/config.ts'],
    },
  ],
};

/** Minimal valid PrBrief wrapping a given Risks object. */
function makeBrief(risks: Risks): PrBrief {
  return {
    intent: { intent: '', in_scope: [], out_of_scope: [] },
    blast: { changed_symbols: [], downstream: [], summary: '' },
    risks,
    history: { history: [] },
  };
}

// ---- DB setup helper -------------------------------------------------------

let repoSeq = 0;
async function setupPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `risks-rt-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 600,
      title: 'Test PR for risks routes',
      author: 'dev',
      branch: 'feat/test',
      base: 'main',
      headSha: 'aabbccdd',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: null,
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

// ---- Suite -----------------------------------------------------------------

d('Risks routes — DB-backed (Testcontainers pg)', () => {
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

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openai: new MockLLMProvider('openai') },
      },
    });
  }

  it('GET /pulls/:id/risks returns null (200) for a PR with no computed brief', async () => {
    const app = await makeApp();
    const { pr } = await setupPr(pg.handle.db, workspaceId);

    // No review has been run — no brief row exists.
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/risks` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();

    await app.close();
  });

  it('GET /pulls/:id/risks returns 404 for a non-existent PR id', async () => {
    const app = await makeApp();
    const fakePrId = '00000000-0000-0000-0000-000000000000';

    const res = await app.inject({ method: 'GET', url: `/pulls/${fakePrId}/risks` });

    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('upsertBrief is idempotent: a second write replaces the row without error', async () => {
    const { pr } = await setupPr(pg.handle.db, workspaceId);
    const db = pg.handle.db;

    // First write
    await upsertBrief(db, pr.id, makeBrief(RISKS_V1));
    const afterFirst = await getBrief(db, pr.id);
    expect(afterFirst).toBeDefined();
    expect(afterFirst!.risks.risks[0]!.kind).toBe('regression');

    // Second write (update, same prId) — must not throw a unique constraint error
    await upsertBrief(db, pr.id, makeBrief(RISKS_V2));
    const afterSecond = await getBrief(db, pr.id);
    expect(afterSecond).toBeDefined();
    // The stored data must reflect the new value, not the old one.
    expect(afterSecond!.risks.risks[0]!.kind).toBe('security');
    expect(afterSecond!.risks.risks[0]!.severity).toBe('high');

    // And PrBrief.safeParse must still succeed (contract validity).
    const parsed = PrBrief.safeParse(afterSecond);
    expect(parsed.success).toBe(true);
  });
});
