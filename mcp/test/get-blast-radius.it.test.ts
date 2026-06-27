import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildDeps, structured } from './helpers/harness.js';
import { seed } from '@devdigest/api/db/seed.js';
import { makeGetBlastRadiusTool } from '../src/tools/get-blast-radius.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

interface BlastOut {
  status: string;
  message: string;
  pr: string | null;
  symbol: string | null;
  impacted: unknown[];
}

d('devdigest_get_blast_radius (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const tool = () => makeGetBlastRadiusTool(buildDeps(pg.handle.db));

  it('returns a not_implemented status for a valid PR (isError:false)', async () => {
    const res = await tool().handler({ pr: 'acme/payments-api#482', symbol: 'rateLimit' });
    expect(res.isError).toBeUndefined();
    const out = structured<BlastOut>(res);
    expect(out.status).toBe('not_implemented');
    expect(out.pr).toBe('acme/payments-api#482');
    expect(out.symbol).toBe('rateLimit');
    expect(out.impacted).toEqual([]);
    expect(out.message).toBeTruthy();
  });

  it('validates the PR exists first (isError for a missing PR)', async () => {
    const res = await tool().handler({ pr: 'acme/payments-api#999999' });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0]!.text).toMatch(/not found/i);
  });
});
