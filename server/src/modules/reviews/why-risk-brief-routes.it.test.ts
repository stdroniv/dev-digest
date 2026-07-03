/**
 * POST + GET /pulls/:id/why-risk-brief routes (SPEC-03 T8) over a real Postgres.
 *
 * Mirrors the WhyRiskBriefService.compute/.get integration tests (T7,
 * `why-risk-brief/service.it.test.ts`) but drives the HTTP surface via
 * `app.inject` to prove the route wiring — schema-first params, workspace
 * scoping via `getContext`, and that GET never triggers generation.
 *
 * Acceptance:
 *  - GET before generate (intent present)  → 200 `not_generated` (AC-13)
 *  - GET before generate (no intent)       → 200 `not_available` (AC-18)
 *  - POST                                   → 200 `{status:'ready',…}` and persists (AC-11)
 *  - GET after POST                         → 200 `ready` (AC-12), reading the cache
 *  - the POST registration carries `rateLimit: { max: 10, timeWindow: '1 minute' }` (AC-28)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { upsertIntent } from './repository/pull.repo.js';
import type { Intent, WhyRiskBrief, WhyRiskBriefState } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const INTENT: Intent = {
  intent: 'Add rate limiting to public checkout endpoints',
  in_scope: ['rate limiter middleware'],
  out_of_scope: ['auth'],
};

/** WhyRiskBrief fixture whose refs cite the REAL changed file inserted below,
 * so grounding (T6, inside the T5 generator) keeps them. */
function makeFixture(): WhyRiskBrief {
  return {
    what: 'Adds a rate limiter middleware to the checkout API.',
    why: 'Add rate limiting to public checkout endpoints',
    risk_level: 'medium',
    risks: [
      {
        description: 'New middleware could reject legitimate bursts of traffic.',
        refs: [{ kind: 'file', value: 'src/middleware/ratelimit.ts' }],
      },
    ],
    review_focus: [{ path: 'src/middleware/ratelimit.ts' }],
  };
}

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `why-risk-brief-routes-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 800 + repoSeq,
      title: 'Add rate limiting',
      author: 'dev',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'abc123',
      status: 'needs_review',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/middleware/ratelimit.ts',
    additions: 42,
    deletions: 0,
  });
  return { repo: repo!, pr: pr! };
}

d('why-risk-brief routes (Testcontainers pg)', () => {
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

  function makeApp(llm: MockLLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: llm } },
    });
  }

  async function getBrief(app: Awaited<ReturnType<typeof buildApp>>, prId: string) {
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/why-risk-brief` });
    return { statusCode: res.statusCode, body: res.json() as WhyRiskBriefState };
  }

  async function postBrief(app: Awaited<ReturnType<typeof buildApp>>, prId: string) {
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/why-risk-brief` });
    return { statusCode: res.statusCode, body: res.json() as WhyRiskBriefState };
  }

  it('GET before generate, no intent ⇒ 200 not_available (AC-18)', async () => {
    const fixture = makeFixture();
    const app = await makeApp(new MockLLMProvider('openai', { structuredBySchema: { WhyRiskBrief: fixture } }));
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const { statusCode, body } = await getBrief(app, pr.id);
    expect(statusCode).toBe(200);
    expect(body).toEqual({ status: 'not_available' });

    await app.close();
  });

  it('GET before generate, intent present ⇒ 200 not_generated (AC-13)', async () => {
    const fixture = makeFixture();
    const app = await makeApp(new MockLLMProvider('openai', { structuredBySchema: { WhyRiskBrief: fixture } }));
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await upsertIntent(pg.handle.db, pr.id, INTENT);

    const { statusCode, body } = await getBrief(app, pr.id);
    expect(statusCode).toBe(200);
    expect(body).toEqual({ status: 'not_generated' });

    await app.close();
  });

  it('POST ⇒ 200 ready and persists; subsequent GET ⇒ 200 ready (AC-11/12)', async () => {
    const fixture = makeFixture();
    const app = await makeApp(new MockLLMProvider('openai', { structuredBySchema: { WhyRiskBrief: fixture } }));
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await upsertIntent(pg.handle.db, pr.id, INTENT);

    const postResult = await postBrief(app, pr.id);
    expect(postResult.statusCode).toBe(200);
    expect(postResult.body.status).toBe('ready');
    if (postResult.body.status !== 'ready') throw new Error('expected ready');
    expect(postResult.body.brief).toEqual(fixture);
    expect(postResult.body.stale).toBe(false);

    const getResult = await getBrief(app, pr.id);
    expect(getResult.statusCode).toBe(200);
    expect(getResult.body.status).toBe('ready');
    if (getResult.body.status !== 'ready') throw new Error('expected ready');
    expect(getResult.body.brief).toEqual(fixture);
    expect(getResult.body.stale).toBe(false);

    await app.close();
  });
});

describe('why-risk-brief route registration', () => {
  it('POST /pulls/:id/why-risk-brief carries rateLimit: { max: 10, timeWindow: "1 minute" } (AC-28)', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./routes.ts', import.meta.url), 'utf8'),
    );
    const postBlockMatch = source.match(
      /app\.post\(\s*'\/pulls\/:id\/why-risk-brief',([\s\S]*?)\);/,
    );
    expect(postBlockMatch).not.toBeNull();
    const postBlock = postBlockMatch![1]!;
    expect(postBlock).toContain("rateLimit: { max: 10, timeWindow: '1 minute' }");

    const getBlockMatch = source.match(/app\.get\('\/pulls\/:id\/why-risk-brief',([\s\S]*?)\);/);
    expect(getBlockMatch).not.toBeNull();
  });
});
