/**
 * Smart Diff routes — DB-backed integration tests.
 *
 * Acceptance (plan steps 6 + acceptance criterion #2):
 *  - GET /pulls/:id/smart-diff returns 200 with a SmartDiff.parse-valid body
 *  - Lock file lands in the 'boilerplate' group
 *  - Core source file lands in the 'core' group with finding_lines populated
 *  - Non-existent PR → 404
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
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
import { SmartDiff } from '../src/vendor/shared/contracts/brief.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const CORE_FILE_PATH = 'src/modules/reviews/service.ts';
const LOCK_FILE_PATH = 'pnpm-lock.yaml';
const FINDING_START_LINE = 42;

// Multi-agent test: two distinct core files, one per agent
const CORE_FILE_A = 'src/modules/reviews/service.ts';
const CORE_FILE_B = 'src/modules/pulls/routes.ts';
const FINDING_LINE_A = 42;
const FINDING_LINE_B = 88;

let repoSeq = 0;

async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  // Use a unique repo name per test so there are no unique-constraint collisions.
  const name = `smart-diff-rt-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();

  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + repoSeq,
      title: 'Smart Diff test PR',
      author: 'dev',
      branch: 'feat/smart-diff',
      base: 'main',
      headSha: 'abc123',
      additions: 20,
      deletions: 5,
      filesCount: 2,
      status: 'needs_review',
      body: null,
    })
    .returning();

  // Insert pr_files: a lock file (boilerplate) + a core source file
  await db.insert(t.prFiles).values([
    { prId: pr!.id, path: LOCK_FILE_PATH, additions: 100, deletions: 50 },
    { prId: pr!.id, path: CORE_FILE_PATH, additions: 20, deletions: 5 },
  ]);

  // Insert a review of kind='review' with a finding on the core file
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId: pr!.id,
      kind: 'review',
      verdict: 'request_changes',
      summary: 'Review for smart-diff integration test.',
      score: 75,
      model: 'test',
      agentId: null,
      runId: null,
    })
    .returning();

  await db.insert(t.findings).values([
    {
      reviewId: review!.id,
      file: CORE_FILE_PATH,
      startLine: FINDING_START_LINE,
      endLine: FINDING_START_LINE + 2,
      severity: 'WARNING',
      category: 'quality',
      title: 'Test finding',
      rationale: 'For integration test.',
      suggestion: null,
      confidence: 0.9,
    },
  ]);

  return { repo: repo!, pr: pr! };
}

/**
 * Inserts a PR reviewed by TWO agents each flagging a DIFFERENT core file.
 * On the broken `.find()` code, exactly one file's finding_lines will be empty
 * regardless of row order. On the fixed per-agentId loop, both are populated.
 */
async function setupMultiAgentPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `smart-diff-ma-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();

  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + repoSeq,
      title: 'Multi-agent Smart Diff test PR',
      author: 'dev',
      branch: 'feat/multi-agent',
      base: 'main',
      headSha: 'def456',
      additions: 30,
      deletions: 10,
      filesCount: 2,
      status: 'needs_review',
      body: null,
    })
    .returning();

  // Two core files — distinct per agent so the broken .find() necessarily drops one
  await db.insert(t.prFiles).values([
    { prId: pr!.id, path: CORE_FILE_A, additions: 15, deletions: 3 },
    { prId: pr!.id, path: CORE_FILE_B, additions: 15, deletions: 7 },
  ]);

  const agentIdA = randomUUID();
  const agentIdB = randomUUID();

  // Agent A review — finding on CORE_FILE_A
  const [reviewA] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId: pr!.id,
      kind: 'review',
      verdict: 'request_changes',
      summary: 'Agent A review.',
      score: 70,
      model: 'test',
      agentId: agentIdA,
      runId: null,
    })
    .returning();

  await db.insert(t.findings).values([
    {
      reviewId: reviewA!.id,
      file: CORE_FILE_A,
      startLine: FINDING_LINE_A,
      endLine: FINDING_LINE_A + 2,
      severity: 'WARNING',
      category: 'quality',
      title: 'Agent A finding',
      rationale: 'Multi-agent test.',
      suggestion: null,
      confidence: 0.9,
    },
  ]);

  // Agent B review — finding on CORE_FILE_B
  const [reviewB] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId: pr!.id,
      kind: 'review',
      verdict: 'request_changes',
      summary: 'Agent B review.',
      score: 65,
      model: 'test',
      agentId: agentIdB,
      runId: null,
    })
    .returning();

  await db.insert(t.findings).values([
    {
      reviewId: reviewB!.id,
      file: CORE_FILE_B,
      startLine: FINDING_LINE_B,
      endLine: FINDING_LINE_B + 2,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Agent B finding',
      rationale: 'Multi-agent test.',
      suggestion: null,
      confidence: 0.95,
    },
  ]);

  return { repo: repo!, pr: pr! };
}

d('Smart Diff routes — DB-backed (Testcontainers pg)', () => {
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
        git: new MockGitClient({ diff: '' }),
        github: new MockGitHubClient(),
        llm: { openai: new MockLLMProvider('openai', {}) },
      },
    });
  }

  it('GET /pulls/:id/smart-diff returns 200 with SmartDiff.parse-valid body', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });

    expect(res.statusCode).toBe(200);
    expect(() => SmartDiff.parse(res.json())).not.toThrow();

    await app.close();
  });

  it('lock file lands in boilerplate group', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });

    expect(res.statusCode).toBe(200);
    const body = SmartDiff.parse(res.json());

    const boilerplateGroup = body.groups.find((g) => g.role === 'boilerplate');
    expect(boilerplateGroup).toBeDefined();
    const lockFile = boilerplateGroup!.files.find((f) => f.path === LOCK_FILE_PATH);
    expect(lockFile).toBeDefined();

    await app.close();
  });

  it('core file lands in core group with finding_annotations populated', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });

    expect(res.statusCode).toBe(200);
    const body = SmartDiff.parse(res.json());

    const coreGroup = body.groups.find((g) => g.role === 'core');
    expect(coreGroup).toBeDefined();
    const coreFile = coreGroup!.files.find((f) => f.path === CORE_FILE_PATH);
    expect(coreFile).toBeDefined();
    expect(
      coreFile!.finding_annotations.some(
        (a) => a.line === FINDING_START_LINE && a.severity === 'warning' && typeof a.finding_id === 'string' && a.finding_id.length > 0,
      ),
    ).toBe(true);

    await app.close();
  });

  it('returns 404 for a non-existent PR id', async () => {
    const app = await makeApp();
    const fakePrId = '00000000-0000-0000-0000-000000000000';

    const res = await app.inject({ method: 'GET', url: `/pulls/${fakePrId}/smart-diff` });

    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('aggregates finding_annotations across all agents in a multi-agent run with correct severity mapping', async () => {
    const app = await makeApp();
    const { pr } = await setupMultiAgentPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });

    expect(res.statusCode).toBe(200);
    const body = SmartDiff.parse(res.json());

    const coreGroup = body.groups.find((g) => g.role === 'core');
    expect(coreGroup).toBeDefined();

    // Both files must have their respective agent's finding annotation — order-independent
    const fileA = coreGroup!.files.find((f) => f.path === CORE_FILE_A);
    expect(fileA).toBeDefined();
    expect(
      fileA!.finding_annotations.some(
        (a) => a.line === FINDING_LINE_A && a.severity === 'warning' && typeof a.finding_id === 'string',
      ),
    ).toBe(true);

    const fileB = coreGroup!.files.find((f) => f.path === CORE_FILE_B);
    expect(fileB).toBeDefined();
    expect(
      fileB!.finding_annotations.some(
        (a) => a.line === FINDING_LINE_B && a.severity === 'critical' && typeof a.finding_id === 'string',
      ),
    ).toBe(true);

    await app.close();
  });
});
