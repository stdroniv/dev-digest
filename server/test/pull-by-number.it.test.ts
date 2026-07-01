import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import * as t from '../src/db/schema.js';

/**
 * Server-level coverage for the `(repo, number)` PR lookup added for the MCP
 * server (`ReviewRepository.getPullByNumber` → `pull.repo.getPullByNumber`).
 * Resolves a PR by its human-readable `owner/repo#number` instead of its UUID,
 * scoped to the workspace via the `pr_repo_number_uq` unique index.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[pull-by-number.it] Docker not available — skipping.');
}

const NUMBER = 482;

d('ReviewRepository.getPullByNumber (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'pull-by-number-fixture',
        fullName: 'acme/pull-by-number-fixture',
      })
      .returning();
    repoId = repo!.id;

    await pg.handle.db.insert(t.pullRequests).values({
      workspaceId,
      repoId,
      number: NUMBER,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
    });
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('returns the PR row for a known (workspaceId, repoId, number)', async () => {
    const repo = new ReviewRepository(pg.handle.db);
    const pull = await repo.getPullByNumber(workspaceId, repoId, NUMBER);
    expect(pull).toBeDefined();
    expect(pull!.number).toBe(NUMBER);
    expect(pull!.repoId).toBe(repoId);
    expect(pull!.workspaceId).toBe(workspaceId);
    expect(pull!.title).toBe('Add rate limiting');
  });

  it('returns undefined for a number that does not exist', async () => {
    const repo = new ReviewRepository(pg.handle.db);
    const pull = await repo.getPullByNumber(workspaceId, repoId, 999_999);
    expect(pull).toBeUndefined();
  });
});
