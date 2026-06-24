/**
 * IntentService.compute — DB-backed integration tests.
 *
 * Acceptance (plan C2):
 *  - compute() persists a pr_intent row readable by getIntent()
 *  - the classifier receives only hunk-header lines, never added/removed code
 *  - savedTokens is positive when patches have body content
 *  - falls back gracefully when GitHub is unavailable
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
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { IntentService } from '../src/modules/reviews/intent.service.js';
import { getIntent } from '../src/modules/reviews/repository/pull.repo.js';
import type { Intent } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const INTENT_FIXTURE: Intent = {
  intent: 'Add rate limiting to public API endpoints to prevent abuse',
  in_scope: ['rate limiter middleware', 'public API routes'],
  out_of_scope: ['authentication', 'payment processing'],
};

// A minimal diff so MockGitClient.diff() returns a parseable result for the
// diff-loader (used when the review runs; not directly by IntentService).
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

// GitHub detail: files with realistic patches that include many body lines.
// This drives both the hunk-header-stripping assertion and the savedTokens
// assertion (full patch >> header-only → meaningful savings).
const FILES_WITH_PATCH = [
  {
    path: 'src/middleware/ratelimit.ts',
    additions: 42,
    deletions: 0,
    patch:
      '@@ -0,0 +1,42 @@\n' +
      "+import Redis from 'ioredis';\n" +
      '+const redis = new Redis();\n' +
      '+export function rateLimit() {\n' +
      '+  return async (req: Request) => {\n' +
      '+    const key = req.ip;\n' +
      '+    const count = await redis.incr(key);\n' +
      '+    if (count > 100) throw new Error("rate limited");\n' +
      '+  };\n' +
      '+}\n',
  },
  {
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  },
];

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `intent-svc-${repoSeq++}`;
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
      title: 'Add rate limiting',
      author: 'dev',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'abc123',
      additions: 43,
      deletions: 0,
      filesCount: 2,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

d('IntentService.compute — DB-backed (Testcontainers pg)', () => {
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

  it('compute() persists a pr_intent row that getIntent() then reads back', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient({ detail: { files: FILES_WITH_PATCH } }),
        llm: { openai: new MockLLMProvider('openai', { structuredBySchema: { Intent: INTENT_FIXTURE } }) },
      },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const result = await new IntentService(app.container).compute(workspaceId, pr.id);

    // Returned intent matches the fixture
    expect(result.intent.intent).toBe(INTENT_FIXTURE.intent);
    expect(result.intent.in_scope).toEqual(INTENT_FIXTURE.in_scope);
    expect(result.intent.out_of_scope).toEqual(INTENT_FIXTURE.out_of_scope);

    // The row is now persisted in the DB
    const stored = await getIntent(pg.handle.db, pr.id);
    expect(stored).toBeDefined();
    expect(stored!.intent).toBe(INTENT_FIXTURE.intent);
    expect(stored!.in_scope).toEqual(INTENT_FIXTURE.in_scope);
    expect(stored!.out_of_scope).toEqual(INTENT_FIXTURE.out_of_scope);

    await app.close();
  });

  it('classifier receives hunk-header lines but no added/removed code body lines', async () => {
    const mockLLM = new MockLLMProvider('openai', {
      structuredBySchema: { Intent: INTENT_FIXTURE },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient({ detail: { files: FILES_WITH_PATCH } }),
        llm: { openai: mockLLM },
      },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await new IntentService(app.container).compute(workspaceId, pr.id);

    // Locate the Intent structured call in the mock's call log
    const intentCall = mockLLM.calls.find(
      (c) =>
        c.method === 'completeStructured' &&
        (c.req as { schemaName: string }).schemaName === 'Intent',
    );
    expect(intentCall).toBeDefined();
    const messages = (
      intentCall!.req as { messages: Array<{ role: string; content: string }> }
    ).messages;
    const allContent = messages.map((m) => m.content).join('\n');

    // Hunk-header lines must reach the classifier
    expect(allContent).toContain('@@ -0,0 +1,42 @@');
    expect(allContent).toContain('src/middleware/ratelimit.ts');

    // Added/removed code lines must NOT be present (they were stripped)
    expect(allContent).not.toContain("+import Redis from 'ioredis'");
    expect(allContent).not.toContain('redis.incr(key)');

    await app.close();
  });

  it('savedTokens is positive when files have more body content than hunk headers', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient({ detail: { files: FILES_WITH_PATCH } }),
        llm: { openai: new MockLLMProvider('openai', { structuredBySchema: { Intent: INTENT_FIXTURE } }) },
      },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const result = await new IntentService(app.container).compute(workspaceId, pr.id);

    // Full patches include many body lines; the hunk-headers block has only
    // @@ lines → full token count exceeds headers-only token count → savings > 0.
    expect(result.savedTokens).toBeGreaterThan(0);

    await app.close();
  });

  it('falls back gracefully when GitHub is unavailable — classifies from stored PR data', async () => {
    // Do NOT inject a github override; omit GITHUB_TOKEN from secrets so
    // container.github() throws ConfigError, which intent.service.ts catches.
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}), // no GITHUB_TOKEN
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structuredBySchema: { Intent: INTENT_FIXTURE } }) },
      },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Should complete without throwing; falls back to title+body with empty files
    const result = await new IntentService(app.container).compute(workspaceId, pr.id);
    expect(result.intent.intent).toBe(INTENT_FIXTURE.intent);

    // Savings are zero when there were no files to compare
    expect(result.savedTokens).toBe(0);

    await app.close();
  });
});
