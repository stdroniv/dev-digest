import * as t from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { PgFixture } from './pg.js';
import { getBrief } from '../../src/modules/reviews/repository/pull.repo.js';
import type { PrBrief } from '@devdigest/shared';

/**
 * `runReview` is fire-and-forget: the POST returns runIds immediately and each
 * agent's review is persisted in the background (the client subscribes to SSE).
 * Tests that assert on persisted reviews/findings/traces must first wait for the
 * background runs to finish. This polls `agent_runs` until every row for the PR
 * reaches a terminal status (done / failed / cancelled).
 */
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export async function waitForPrRuns(
  db: PgFixture['handle']['db'],
  prId: string,
  opts: { expected?: number; timeoutMs?: number } = {},
): Promise<Array<typeof t.agentRuns.$inferSelect>> {
  const { expected, timeoutMs = 10_000 } = opts;
  const start = Date.now();
  for (;;) {
    const runs = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    const terminal = runs.filter((r) => TERMINAL.has(r.status ?? ''));
    // With an explicit `expected`, wait until that many runs finish (ignores any
    // extra rows, e.g. a trifecta scan). Otherwise wait for all rows to settle.
    const done =
      expected != null
        ? terminal.length >= expected
        : runs.length > 0 && terminal.length === runs.length;
    if (done) return runs;
    if (Date.now() - start > timeoutMs) return runs;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * The risk brief is persisted AFTER each agent's `agent_runs` row flips to a
 * terminal status (run-executor writes the run record inside the agent loop, then
 * computes + upserts the brief once, after the loop). So `waitForPrRuns` returning
 * 'done' does NOT guarantee the brief has landed — reading `getBrief` immediately
 * after races that upsert. Poll for it instead.
 */
export async function waitForBrief(
  db: PgFixture['handle']['db'],
  prId: string,
  opts: { timeoutMs?: number } = {},
): Promise<PrBrief | undefined> {
  const { timeoutMs = 10_000 } = opts;
  const start = Date.now();
  for (;;) {
    const brief = await getBrief(db, prId);
    if (brief !== undefined) return brief;
    if (Date.now() - start > timeoutMs) return brief;
    await new Promise((r) => setTimeout(r, 25));
  }
}
