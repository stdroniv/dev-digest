import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildDeps, structured } from './helpers/harness.js';
import { seed } from '@devdigest/api/db/seed.js';
import * as t from '@devdigest/api/db/schema.js';
import { makeGetFindingsTool } from '../src/tools/get-findings.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

interface FindingsOut {
  pr: string;
  findings: { id: string; file: string; severity: string; rationale?: string }[];
  total_matched: number;
  returned: number;
  has_more: boolean;
  next_cursor: string | null;
  truncated_note: string | null;
}

const PR = 'acme/findings-fixture#700';

d('devdigest_get_findings (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    const db = pg.handle.db;
    const { workspaceId } = await seed(db);

    // Resolve the seeded agent through the service (no raw operator imports).
    const secAgent = (await buildDeps(db).services.agents.list(workspaceId)).find(
      (a) => a.name === 'Security Reviewer',
    )!;

    const [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'findings-fixture',
        fullName: 'acme/findings-fixture',
      })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 700,
        title: 'fixture',
        author: 'tester',
        branch: 'b',
        base: 'main',
        headSha: 'deadbeef',
      })
      .returning();

    // Newest review (Security Reviewer): 3 active findings + 1 dismissed.
    const [newReview] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId: secAgent!.id,
        kind: 'review',
        verdict: 'request_changes',
        model: 'm',
        createdAt: new Date(),
      })
      .returning();
    await db.insert(t.findings).values([
      { reviewId: newReview!.id, file: 'src/a.ts', startLine: 10, endLine: 10, severity: 'CRITICAL', category: 'security', title: 'A', rationale: 'ra', confidence: 0.9 },
      { reviewId: newReview!.id, file: 'src/b.ts', startLine: 20, endLine: 20, severity: 'WARNING', category: 'perf', title: 'B', rationale: 'rb', confidence: 0.8 },
      { reviewId: newReview!.id, file: 'src/c.ts', startLine: 30, endLine: 30, severity: 'SUGGESTION', category: 'style', title: 'C', rationale: 'rc', confidence: 0.7 },
      { reviewId: newReview!.id, file: 'src/d.ts', startLine: 40, endLine: 40, severity: 'CRITICAL', category: 'security', title: 'D (dismissed)', rationale: 'rd', confidence: 0.9, dismissedAt: new Date() },
    ]);

    // Older review (same agent) — only surfaces with all_runs.
    const [oldReview] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId: secAgent!.id,
        kind: 'review',
        verdict: 'comment',
        model: 'm',
        createdAt: new Date(Date.now() - 60_000),
      })
      .returning();
    await db.insert(t.findings).values({
      reviewId: oldReview!.id,
      file: 'src/old.ts',
      startLine: 5,
      endLine: 5,
      severity: 'CRITICAL',
      category: 'bug',
      title: 'OLD',
      rationale: 'ro',
      confidence: 0.6,
    });
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const tool = () => makeGetFindingsTool(buildDeps(pg.handle.db));

  it('excludes dismissed + keeps newest review per agent by default', async () => {
    const out = structured<FindingsOut>(await tool().handler({ pr: PR }));
    expect(out.pr).toBe(PR);
    expect(out.total_matched).toBe(3);
    // sorted: CRITICAL, WARNING, SUGGESTION
    expect(out.findings.map((f) => f.file)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('filters by severity', async () => {
    const out = structured<FindingsOut>(await tool().handler({ pr: PR, severity: 'CRITICAL' }));
    expect(out.total_matched).toBe(1);
    expect(out.findings[0]!.file).toBe('src/a.ts');
  });

  it('filters by file', async () => {
    const out = structured<FindingsOut>(await tool().handler({ pr: PR, file: 'src/b.ts' }));
    expect(out.findings.map((f) => f.file)).toEqual(['src/b.ts']);
  });

  it('filters by category', async () => {
    // Newest review per agent (default) seeds: security (a.ts), perf (b.ts),
    // style (c.ts), and a dismissed security (d.ts, excluded). `perf` matches
    // only b.ts, so a category filter must return exactly that finding.
    const out = structured<FindingsOut>(await tool().handler({ pr: PR, category: 'perf' }));
    expect(out.total_matched).toBe(1);
    expect(out.findings.map((f) => f.file)).toEqual(['src/b.ts']);
  });

  it('include_dismissed surfaces the dismissed finding', async () => {
    const out = structured<FindingsOut>(await tool().handler({ pr: PR, include_dismissed: true }));
    expect(out.total_matched).toBe(4);
    expect(out.findings.map((f) => f.file)).toContain('src/d.ts');
  });

  it('all_runs includes the older review', async () => {
    const out = structured<FindingsOut>(await tool().handler({ pr: PR, all_runs: true }));
    expect(out.total_matched).toBe(4);
    expect(out.findings.map((f) => f.file)).toContain('src/old.ts');
  });

  it('paginates with has_more / next_cursor', async () => {
    const page1 = structured<FindingsOut>(await tool().handler({ pr: PR, limit: 2 }));
    expect(page1.returned).toBe(2);
    expect(page1.has_more).toBe(true);
    expect(page1.next_cursor).not.toBeNull();
    expect(page1.truncated_note).toContain('next page');

    const page2 = structured<FindingsOut>(
      await tool().handler({ pr: PR, limit: 2, cursor: page1.next_cursor! }),
    );
    expect(page2.returned).toBe(1);
    expect(page2.has_more).toBe(false);
    expect(page2.next_cursor).toBeNull();
  });

  it('filters by agent name; an agent with no findings returns empty (not error)', async () => {
    const mine = structured<FindingsOut>(await tool().handler({ pr: PR, agent: 'Security Reviewer' }));
    expect(mine.total_matched).toBe(3);
    const none = structured<FindingsOut>(await tool().handler({ pr: PR, agent: 'General Reviewer' }));
    expect(none.total_matched).toBe(0);
  });

  it('detailed format includes the rationale', async () => {
    const out = structured<FindingsOut>(
      await tool().handler({ pr: PR, severity: 'CRITICAL', response_format: 'detailed' }),
    );
    expect(out.findings[0]!.rationale).toBe('ra');
  });
});
