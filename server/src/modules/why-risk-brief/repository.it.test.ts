/**
 * Why+Risk Brief repository (SPEC-03 T4) over a real Postgres.
 *
 *   getWhyRiskBrief    → undefined when no row exists
 *   upsertWhyRiskBrief → round-trip preserves brief / docsTruncated / inputsFingerprint
 *   upsertWhyRiskBrief → two sequential upserts for one prId leave exactly ONE row,
 *                        with the LATEST payload (last-write-wins, AC-11)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { getWhyRiskBrief, upsertWhyRiskBrief } from './repository.js';
import type { WhyRiskBrief } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[why-risk-brief repository] Docker not available — skipping integration tests.');
}

function makeBrief(tag: string): WhyRiskBrief {
  return {
    what: `what ${tag}`,
    why: `why ${tag}`,
    risk_level: 'medium',
    risks: [{ description: `risk ${tag}`, refs: [{ kind: 'file', value: 'src/index.ts' }] }],
    review_focus: [{ path: 'src/index.ts' }],
  };
}

d('why-risk-brief repository (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'why-risk-brief-repo', fullName: 'acme/why-risk-brief-repo' })
      .returning();
    repoId = repo!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  async function insertPr(number: number): Promise<string> {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number,
        title: `PR ${number}`,
        author: 'octocat',
        branch: `feat/${number}`,
        base: 'main',
        headSha: `sha-${number}`,
      })
      .returning();
    return pr!.id;
  }

  it('getWhyRiskBrief returns undefined when no row exists', async () => {
    const prId = await insertPr(1);
    const result = await getWhyRiskBrief(pg.handle.db, prId);
    expect(result).toBeUndefined();
  });

  it('round-trips brief / docsTruncated / inputsFingerprint through upsert + get', async () => {
    const prId = await insertPr(2);
    const brief = makeBrief('v1');
    await upsertWhyRiskBrief(pg.handle.db, prId, {
      brief,
      docsTruncated: true,
      degradedInputs: { blast: 'missing' },
      inputsFingerprint: 'fingerprint-v1',
      model: 'openrouter/deepseek-v4-flash',
      costUsd: 0.0042,
      tokensIn: 100,
      tokensOut: 50,
    });

    const result = await getWhyRiskBrief(pg.handle.db, prId);
    expect(result).toBeDefined();
    expect(result!.brief).toEqual(brief);
    expect(result!.docsTruncated).toBe(true);
    expect(result!.inputsFingerprint).toBe('fingerprint-v1');
    expect(result!.degradedInputs).toEqual({ blast: 'missing' });
    expect(result!.model).toBe('openrouter/deepseek-v4-flash');
    expect(result!.tokensIn).toBe(100);
    expect(result!.tokensOut).toBe(50);
  });

  it('two sequential upserts for one prId leave exactly one row, with the latest payload (last-write-wins)', async () => {
    const prId = await insertPr(3);

    await upsertWhyRiskBrief(pg.handle.db, prId, {
      brief: makeBrief('first'),
      docsTruncated: false,
      degradedInputs: null,
      inputsFingerprint: 'fingerprint-first',
      model: 'openrouter/deepseek-v4-flash',
      costUsd: 0.001,
      tokensIn: 10,
      tokensOut: 5,
    });

    const secondBrief = makeBrief('second');
    await upsertWhyRiskBrief(pg.handle.db, prId, {
      brief: secondBrief,
      docsTruncated: true,
      degradedInputs: { issue: 'missing' },
      inputsFingerprint: 'fingerprint-second',
      model: 'openrouter/deepseek-v4-flash',
      costUsd: 0.002,
      tokensIn: 20,
      tokensOut: 10,
    });

    const rows = await pg.handle.db.select().from(t.whyRiskBrief).where(eq(t.whyRiskBrief.prId, prId));
    expect(rows).toHaveLength(1);

    const result = await getWhyRiskBrief(pg.handle.db, prId);
    expect(result!.brief).toEqual(secondBrief);
    expect(result!.docsTruncated).toBe(true);
    expect(result!.inputsFingerprint).toBe('fingerprint-second');
    expect(result!.degradedInputs).toEqual({ issue: 'missing' });
    expect(result!.tokensIn).toBe(20);
    expect(result!.tokensOut).toBe(10);
  });
});
