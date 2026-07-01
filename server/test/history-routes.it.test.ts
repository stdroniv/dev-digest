/**
 * history routes — DB-backed integration tests (testcontainers Postgres).
 *
 * Acceptance:
 *  - GET /pulls/:id/prior-prs → 200 with PrHistory: #101 lists both files
 *    (files_overlap length 2), #102 lists one, own PR #900 excluded,
 *    recency-ordered (newest first), notes populated.
 *  - A repo with clonePath: null → 200 { history: [] }.
 *  - Non-existent PR uuid → 404.
 *  - Non-uuid id → 422.
 *
 * Seeds: workspace + repo (clonePath set) + PR (number 900) + pr_files.
 * Injects MockGitClient with per-path logByPath seam (no real git).
 * No LLM keys needed — the history path makes zero model calls.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockSecretsProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrHistory } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// ---------------------------------------------------------------------------
// Mock git — per-path commit fixtures
// ---------------------------------------------------------------------------

// PR #101 touches both src/a.ts and src/b.ts.
// PR #900 is the current PR (own) → excluded.
// PR #102 touches only src/b.ts (merge-commit style).
const MOCK_GIT = new MockGitClient({
  logByPath: {
    'src/a.ts': [
      { sha: 'aa01', message: 'Feat A (#101)', author: 'alice', date: '2026-01-10' },
      { sha: 'aa00', message: 'My PR (#900)',   author: 'bob',   date: '2026-01-09' },
    ],
    'src/b.ts': [
      { sha: 'bb01', message: 'Feat A (#101)',                           author: 'alice', date: '2026-01-10' },
      { sha: 'bb02', message: 'Merge pull request #102 from acme/feat', author: 'carol', date: '2026-01-05' },
    ],
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let repoSeq = 0;

async function setupRepo(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { clonePath: string | null },
) {
  const seq = repoSeq++;
  const [repo] = await db
    .insert(t.repos)
    .values({
      workspaceId,
      owner: 'acme-hist',
      name: `repo-${seq}`,
      fullName: `acme-hist/repo-${seq}`,
      clonePath: opts.clonePath,
    })
    .returning();
  return repo!;
}

async function setupPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  repoId: string,
  number = 900,
) {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number,
      title: 'Add rate limiting',
      author: 'bob',
      branch: 'feat/rate-limit',
      base: 'main',
      headSha: 'cafebabe',
      additions: 10,
      deletions: 2,
      filesCount: 2,
      status: 'needs_review',
      body: null,
    })
    .returning();
  return pr!;
}

async function setupPrFiles(
  db: PgFixture['handle']['db'],
  prId: string,
) {
  await db.insert(t.prFiles).values([
    { prId, path: 'src/a.ts', additions: 5, deletions: 1 },
    { prId, path: 'src/b.ts', additions: 5, deletions: 1 },
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

d('history routes — DB-backed (testcontainers pg)', () => {
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
        secrets: new MockSecretsProvider({}),
        git: MOCK_GIT,
      },
    });
  }

  it('GET /pulls/:id/prior-prs → 200 with PrHistory (correct items, exclusion, order, notes)', async () => {
    const app = await makeApp();
    const repo = await setupRepo(pg.handle.db, workspaceId, { clonePath: '/mock/clones/acme-hist/repo' });
    const pr = await setupPr(pg.handle.db, workspaceId, repo.id, 900);
    await setupPrFiles(pg.handle.db, pr.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/prior-prs` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PrHistory;

    // Must have at least 2 items: #101 and #102
    expect(body.history.length).toBeGreaterThanOrEqual(2);

    const pr101 = body.history.find((h) => h.pr_number === 101);
    const pr102 = body.history.find((h) => h.pr_number === 102);

    // #101 touches both files
    expect(pr101).toBeDefined();
    expect(pr101!.files_overlap).toContain('src/a.ts');
    expect(pr101!.files_overlap).toContain('src/b.ts');
    expect(pr101!.notes).toBe('Touched 2 of these files');

    // #102 touches only src/b.ts
    expect(pr102).toBeDefined();
    expect(pr102!.files_overlap).toContain('src/b.ts');
    expect(pr102!.notes).toBe('Touched 1 of these files');

    // Own PR #900 excluded
    const ownPr = body.history.find((h) => h.pr_number === 900);
    expect(ownPr).toBeUndefined();

    // Recency order: #101 (2026-01-10) before #102 (2026-01-05)
    const idx101 = body.history.findIndex((h) => h.pr_number === 101);
    const idx102 = body.history.findIndex((h) => h.pr_number === 102);
    expect(idx101).toBeLessThan(idx102);

    // notes is populated
    expect(pr101!.notes).toBeTruthy();
    expect(pr102!.notes).toBeTruthy();

    await app.close();
  });

  it('GET /pulls/:id/prior-prs → 200 { history: [] } for repo with clonePath null', async () => {
    const app = await makeApp();
    const repo = await setupRepo(pg.handle.db, workspaceId, { clonePath: null });
    const pr = await setupPr(pg.handle.db, workspaceId, repo.id, 901);
    await setupPrFiles(pg.handle.db, pr.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/prior-prs` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PrHistory;
    expect(body.history).toEqual([]);

    await app.close();
  });

  it('GET /pulls/:id/prior-prs → 404 for a non-existent PR uuid', async () => {
    const app = await makeApp();
    const fakePrId = '00000000-0000-0000-0000-000000000000';

    const res = await app.inject({ method: 'GET', url: `/pulls/${fakePrId}/prior-prs` });

    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('GET /pulls/:id/prior-prs → 422 for a non-uuid id', async () => {
    const app = await makeApp();

    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/prior-prs' });

    expect(res.statusCode).toBe(422);

    await app.close();
  });
});
