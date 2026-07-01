import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildDeps, structured } from './helpers/harness.js';
import { seed } from '@devdigest/api/db/seed.js';
import * as t from '@devdigest/api/db/schema.js';
import { makeGetConventionsTool } from '../src/tools/get-conventions.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

interface ConventionsOut {
  repo: string;
  conventions: {
    rule: string;
    category: string | null;
    evidence_snippet?: string;
  }[];
  total: number;
  returned: number;
  has_more: boolean;
  next_cursor: string | null;
}

const REPO = 'acme/conv-fixture';

d('devdigest_get_conventions (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    const db = pg.handle.db;
    const { workspaceId } = await seed(db);

    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'conv-fixture', fullName: REPO })
      .returning();

    await db.insert(t.conventions).values([
      {
        workspaceId,
        repoId: repo!.id,
        category: 'Data access',
        rule: 'Always await db calls',
        evidencePath: 'src/db.ts',
        evidenceSnippet: 'await db.users.find(id)',
        evidenceStartLine: 2,
        evidenceEndLine: 2,
        confidence: 0.9,
        status: 'accepted',
        accepted: true,
      },
      {
        workspaceId,
        repoId: repo!.id,
        category: 'Naming',
        rule: 'Use camelCase for functions',
        evidencePath: 'src/util.ts',
        evidenceSnippet: 'function getUser() {}',
        confidence: 0.8,
        status: 'accepted',
        accepted: true,
      },
      {
        workspaceId,
        repoId: repo!.id,
        category: 'Data access',
        rule: 'Pending — should never appear',
        status: 'pending',
        accepted: false,
      },
      {
        workspaceId,
        repoId: repo!.id,
        category: 'Style',
        rule: 'Rejected — should never appear',
        status: 'rejected',
        accepted: false,
      },
    ]);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const tool = () => makeGetConventionsTool(buildDeps(pg.handle.db));

  it('returns ONLY accepted conventions (no pending/rejected)', async () => {
    const out = structured<ConventionsOut>(await tool().handler({ repo: REPO }));
    expect(out.repo).toBe(REPO);
    expect(out.total).toBe(2);
    const rules = out.conventions.map((c) => c.rule);
    expect(rules).toEqual(['Always await db calls', 'Use camelCase for functions']);
    expect(rules.some((r) => r.includes('Pending'))).toBe(false);
    expect(rules.some((r) => r.includes('Rejected'))).toBe(false);
  });

  it('summary omits the evidence snippet; detailed includes it', async () => {
    const summary = structured<ConventionsOut>(await tool().handler({ repo: REPO }));
    expect(summary.conventions[0]!.evidence_snippet).toBeUndefined();

    const detailed = structured<ConventionsOut>(
      await tool().handler({ repo: REPO, response_format: 'detailed' }),
    );
    expect(detailed.conventions[0]!.evidence_snippet).toBe('await db.users.find(id)');
  });

  it('filters by category', async () => {
    const out = structured<ConventionsOut>(await tool().handler({ repo: REPO, category: 'Data access' }));
    expect(out.total).toBe(1);
    expect(out.conventions[0]!.rule).toBe('Always await db calls');
  });

  it('returns an actionable isError for a repo that is not imported', async () => {
    const res = await tool().handler({ repo: 'acme/not-imported' });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0]!.text).toMatch(/not imported/i);
  });
});
