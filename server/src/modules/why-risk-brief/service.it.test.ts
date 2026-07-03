/**
 * WhyRiskBriefService.compute / .get — DB-backed integration tests (SPEC-03 T7).
 *
 * Acceptance:
 *  - no intent           ⇒ compute() and get() both return `not_available` (AC-18), no model call
 *  - no LLM provider      ⇒ compute() returns `skipped/no_model`, persists NOTHING (AC-20)
 *  - happy path           ⇒ compute() returns `ready` + persists a row; get() returns `ready` (AC-11/12)
 *  - get before compute (intent present) ⇒ `not_generated` (AC-13), never computes
 *  - after compute, mutate stored intent, then get() ⇒ `stale: true`, SAME cached brief (AC-15/16)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockSecretsProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { WhyRiskBriefService } from './service.js';
import { upsertIntent, getIntent } from '../reviews/repository/pull.repo.js';
import { getWhyRiskBrief } from './repository.js';
import type { Intent, WhyRiskBrief } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const INTENT: Intent = {
  intent: 'Add rate limiting to public checkout endpoints',
  in_scope: ['rate limiter middleware'],
  out_of_scope: ['auth'],
};

const MUTATED_INTENT: Intent = {
  intent: 'Something entirely different was later classified for this PR',
  in_scope: ['a different scope'],
  out_of_scope: [],
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
  const name = `why-risk-brief-svc-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 700 + repoSeq,
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

d('WhyRiskBriefService — DB-backed (Testcontainers pg)', () => {
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

  it('no intent ⇒ compute() and get() both return not_available, with no model call (AC-18)', async () => {
    const mockLLM = new MockLLMProvider('openai', { structuredBySchema: { WhyRiskBrief: makeFixture() } });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: mockLLM } },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const service = new WhyRiskBriefService(app.container);

    const computeResult = await service.compute(workspaceId, pr.id);
    expect(computeResult).toEqual({ status: 'not_available' });

    const getResult = await service.get(workspaceId, pr.id);
    expect(getResult).toEqual({ status: 'not_available' });

    // No model call was made — no intent means compute refuses before resolving a model.
    expect(mockLLM.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });

  it('no LLM provider configured ⇒ compute() returns skipped/no_model and persists nothing (AC-20)', async () => {
    // No overrides.llm at all, and MockSecretsProvider({}) has no keys for any
    // provider — container.llm(...) throws ConfigError for openai/anthropic/openrouter.
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider({}) },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await upsertIntent(pg.handle.db, pr.id, INTENT);
    const service = new WhyRiskBriefService(app.container);

    const result = await service.compute(workspaceId, pr.id);
    expect(result).toEqual({ status: 'skipped', reason: 'no_model' });

    const row = await getWhyRiskBrief(pg.handle.db, pr.id);
    expect(row).toBeUndefined();

    await app.close();
  });

  it('happy path: compute() returns ready + persists; get() then returns ready (AC-11/12)', async () => {
    const fixture = makeFixture();
    const mockLLM = new MockLLMProvider('openai', { structuredBySchema: { WhyRiskBrief: fixture } });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: mockLLM } },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await upsertIntent(pg.handle.db, pr.id, INTENT);
    const service = new WhyRiskBriefService(app.container);

    const computeResult = await service.compute(workspaceId, pr.id);
    expect(computeResult.status).toBe('ready');
    if (computeResult.status !== 'ready') throw new Error('expected ready');
    expect(computeResult.brief).toEqual(fixture);
    expect(computeResult.stale).toBe(false);

    // Exactly one model round-trip (AC-27).
    expect(mockLLM.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    const row = await getWhyRiskBrief(pg.handle.db, pr.id);
    expect(row).toBeDefined();
    expect(row!.brief).toEqual(fixture);

    const getResult = await service.get(workspaceId, pr.id);
    expect(getResult.status).toBe('ready');
    if (getResult.status !== 'ready') throw new Error('expected ready');
    expect(getResult.brief).toEqual(fixture);
    expect(getResult.stale).toBe(false);

    // get() must never call the LLM (AC-16) — still exactly one call from compute().
    expect(mockLLM.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    await app.close();
  });

  it('get() before compute() (intent present) ⇒ not_generated, never computes (AC-13/14)', async () => {
    const mockLLM = new MockLLMProvider('openai', { structuredBySchema: { WhyRiskBrief: makeFixture() } });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: mockLLM } },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await upsertIntent(pg.handle.db, pr.id, INTENT);
    const service = new WhyRiskBriefService(app.container);

    const getResult = await service.get(workspaceId, pr.id);
    expect(getResult).toEqual({ status: 'not_generated' });

    expect(mockLLM.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);
    const row = await getWhyRiskBrief(pg.handle.db, pr.id);
    expect(row).toBeUndefined();

    await app.close();
  });

  it('after compute(), mutating stored intent then get() ⇒ stale:true, same cached brief (AC-15/16)', async () => {
    const fixture = makeFixture();
    const mockLLM = new MockLLMProvider('openai', { structuredBySchema: { WhyRiskBrief: fixture } });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: mockLLM } },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await upsertIntent(pg.handle.db, pr.id, INTENT);
    const service = new WhyRiskBriefService(app.container);

    const computeResult = await service.compute(workspaceId, pr.id);
    expect(computeResult.status).toBe('ready');

    // Mutate the stored intent — one of the fingerprinted deterministic inputs.
    await upsertIntent(pg.handle.db, pr.id, MUTATED_INTENT);
    const storedIntent = await getIntent(pg.handle.db, pr.id);
    expect(storedIntent).toEqual(MUTATED_INTENT);

    const getResult = await service.get(workspaceId, pr.id);
    expect(getResult.status).toBe('ready');
    if (getResult.status !== 'ready') throw new Error('expected ready');
    expect(getResult.stale).toBe(true);
    // Same cached brief — get() never recomputes/regenerates (AC-16).
    expect(getResult.brief).toEqual(fixture);

    // Still exactly one model round-trip total (from compute() only).
    expect(mockLLM.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    await app.close();
  });
});
