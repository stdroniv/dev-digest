import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildDeps, structured } from './helpers/harness.js';
import { seed } from '@devdigest/api/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient, MockSecretsProvider } from '@devdigest/api/adapters/mocks.js';
import { getWorkspaceId } from '../src/context.js';
import { parsePrRef, resolvePull } from '../src/resolvers.js';
import type {
  LLMProvider,
  ModelInfo,
  CompletionResult,
  StructuredResult,
  Review,
} from '@devdigest/shared';
import { makeReviewPrTool } from '../src/tools/review-pr.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/** Diff touching src/config.ts line 11 so grounding keeps a finding there. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** One valid finding (line 11) + one hallucinated (line 999, dropped by grounding). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

/** An LLM provider whose structured calls never resolve — forces the timeout path. */
class HangingLLMProvider implements LLMProvider {
  readonly id = 'openrouter' as const;
  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([{ id: 'deepseek/deepseek-v4-flash', provider: 'openrouter' }]);
  }
  complete(): Promise<CompletionResult> {
    return new Promise<CompletionResult>(() => undefined);
  }
  completeStructured<T>(): Promise<StructuredResult<T>> {
    return new Promise<StructuredResult<T>>(() => undefined);
  }
  embed(): Promise<number[][]> {
    return new Promise<number[][]>(() => undefined);
  }
}

interface ReviewPrOut {
  pr: string;
  completed: boolean;
  runs: { run_id: string; agent_name: string; status: string; error: string | null }[];
  summary: { critical: number; warning: number; suggestion: number; total: number; blockers: number };
  findings: { file: string; start_line: number; severity: string; rationale?: string }[];
  message: string | null;
}

d('devdigest_review_pr (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('blocks until the review completes and returns a findings summary', async () => {
    const deps = buildDeps(pg.handle.db, {
      embedder: new MockEmbedder(),
      git: new MockGitClient({ diff: DIFF }),
      secrets: new MockSecretsProvider({}),
      llm: {
        openrouter: new MockLLMProvider('openrouter', {
          structuredBySchema: { Review: REVIEW_FIXTURE },
        }),
      },
    });
    const tool = makeReviewPrTool(deps);

    const res = await tool.handler({
      pr: 'acme/payments-api#482',
      agent: 'Security Reviewer',
      response_format: 'detailed',
      timeout_seconds: 60,
    });
    expect(res.isError).toBeUndefined();
    const out = structured<ReviewPrOut>(res);

    expect(out.pr).toBe('acme/payments-api#482');
    expect(out.completed).toBe(true);
    expect(out.runs).toHaveLength(1);
    expect(out.runs[0]!.status).toBe('done');
    // Grounding keeps the line-11 CRITICAL, drops the line-999 WARNING.
    expect(out.summary).toMatchObject({ critical: 1, warning: 0, total: 1, blockers: 1 });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ file: 'src/config.ts', start_line: 11, severity: 'CRITICAL' });
    // detailed format includes the rationale.
    expect(out.findings[0]!.rationale).toBeTruthy();
  });

  it('returns completed:false with running status on timeout (no hang, no cancel)', async () => {
    const deps = buildDeps(pg.handle.db, {
      embedder: new MockEmbedder(),
      git: new MockGitClient({ diff: DIFF }),
      secrets: new MockSecretsProvider({}),
      llm: { openrouter: new HangingLLMProvider() },
    });
    const tool = makeReviewPrTool(deps);

    const res = await tool.handler({
      pr: 'acme/payments-api#482',
      agent: 'General Reviewer',
      timeout_seconds: 10, // schema min; the hanging LLM guarantees no completion
    });
    expect(res.isError).toBeUndefined();
    const out = structured<ReviewPrOut>(res);
    expect(out.completed).toBe(false);
    expect(out.runs).toHaveLength(1);
    expect(out.runs[0]!.status).toBe('running');
    expect(out.findings).toEqual([]);
    expect(out.message).toContain('devdigest_get_findings');

    // The run is genuinely still 'running' (the tool never cancels it) — verify
    // through the service rather than raw DB access.
    const workspaceId = await getWorkspaceId(deps.container);
    const { pull } = await resolvePull(deps, workspaceId, parsePrRef('acme/payments-api#482'));
    const runs = await deps.services.reviews.listRuns(workspaceId, pull.id);
    const run = runs.find((r) => r.run_id === out.runs[0]!.run_id);
    expect(run?.status).toBe('running');
  });

  it('returns an actionable isError for a missing PR (not a protocol throw)', async () => {
    const deps = buildDeps(pg.handle.db, {
      git: new MockGitClient({ diff: DIFF }),
      secrets: new MockSecretsProvider({}),
      llm: { openrouter: new MockLLMProvider('openrouter', { structuredBySchema: { Review: REVIEW_FIXTURE } }) },
    });
    const tool = makeReviewPrTool(deps);
    const res = await tool.handler({ pr: 'acme/nope#999', agent: 'Security Reviewer' });
    expect(res.isError).toBe(true);
    const text = (res.content as { text: string }[])[0]!.text;
    expect(text).toMatch(/not imported|not found/i);
  });
});
