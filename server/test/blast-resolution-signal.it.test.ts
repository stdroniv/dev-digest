/**
 * blast resolution signal — DB-backed integration test (testcontainers Postgres).
 *
 * Validates the Tier-4 honest "limited cross-file resolution" signal:
 *
 *   - `getReferenceResolutionStats` counts total references vs. those with a
 *     non-NULL decl_file using a SQL query against the live DB.
 *   - When total ≥ 50 AND resolved/total < 0.3, `BlastResult.resolution.limited`
 *     is `true` (sparse cross-file resolution).
 *   - When the resolved ratio is healthy (≥ 0.3) OR total < 50, the signal is
 *     `false`.
 *
 * Each scenario seeds its own distinct repo to avoid cross-test interference.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { loadConfig } from '../src/platform/config.js';
import { Container } from '../src/platform/container.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import * as t from '../src/db/schema.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () =>
  loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('blast resolution signal — DB-backed (testcontainers pg)', () => {
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

  /** Create a repo with a guaranteed-unique fullName. */
  async function setupRepo() {
    const name = `resolution-it-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'test-resolution',
        name,
        fullName: `test-resolution/${name}`,
      })
      .returning();
    return repo!;
  }

  /** Seed a 'full' index state so tryPersistentBlast proceeds. */
  async function seedIndexState(repoId: string) {
    await pg.handle.db.insert(t.repoIndexState).values({
      repoId,
      lastIndexedSha: 'cafebabe',
      indexerVersion: INDEXER_VERSION,
      status: 'full',
      filesIndexed: 10,
      filesSkipped: 0,
      stats: {},
      updatedAt: new Date(),
    });
  }

  /**
   * Seed N reference rows for the given repo.
   * `resolvedCount` of them get decl_file set; the rest are NULL (unresolved).
   *
   * Seeded with a distinct `to_symbol` that is NOT the changed symbol, so the
   * fallback path finds no references for the changed symbol and produces 0
   * fallback callers — keeping the test focused on the resolution-ratio stat.
   */
  async function seedReferences(
    repoId: string,
    totalCount: number,
    resolvedCount: number,
  ) {
    const rows = Array.from({ length: totalCount }, (_, i) => ({
      repoId,
      fromPath: `src/caller-${i}.ts`,
      toSymbol: 'dummySymbol',
      line: i + 1,
      // First `resolvedCount` rows get a decl_file; the rest stay NULL.
      declFile: i < resolvedCount ? 'src/resolved-decl.ts' : null,
    }));
    // Insert in chunks to stay within Drizzle's parameterised-query limits.
    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await pg.handle.db.insert(t.references).values(rows.slice(i, i + CHUNK));
    }
  }

  /** Build a RepoIntelService wired to the testcontainers DB. */
  function makeService() {
    const container = new Container(config(), pg.handle.db, {
      secrets: new MockSecretsProvider({}),
    });
    return new RepoIntelService(container);
  }

  // ---------------------------------------------------------------------------
  // Scenario A — sparse ratio (5/55 ≈ 0.09 < 0.3) → limited = true
  // ---------------------------------------------------------------------------

  it('sparse resolved ratio (5/55) returns resolution.limited = true', async () => {
    const repo = await setupRepo();
    const repoId = repo.id;
    await seedIndexState(repoId);

    // One changed symbol so tryPersistentBlast doesn't return early.
    await pg.handle.db.insert(t.symbols).values([
      {
        repoId,
        path: 'src/changed.ts',
        name: 'doSomething',
        kind: 'function',
        line: 1,
        exported: true,
      },
    ]);

    // 55 references total: only 5 have decl_file set → ratio ≈ 0.09.
    await seedReferences(repoId, 55, 5);

    const service = makeService();
    const result = await service.getBlastRadius(repoId, ['src/changed.ts']);

    expect(result.degraded).toBe(false);
    expect(result.resolution).toBeDefined();
    expect(result.resolution?.limited).toBe(true);
    expect(result.resolution?.reason).toBe('sparse_cross_file');
  });

  // ---------------------------------------------------------------------------
  // Scenario B — healthy ratio (40/55 ≈ 0.73 ≥ 0.3) → limited = false
  // ---------------------------------------------------------------------------

  it('healthy resolved ratio (40/55) returns resolution.limited = false', async () => {
    const repo = await setupRepo();
    const repoId = repo.id;
    await seedIndexState(repoId);

    await pg.handle.db.insert(t.symbols).values([
      {
        repoId,
        path: 'src/changed.ts',
        name: 'doSomething',
        kind: 'function',
        line: 1,
        exported: true,
      },
    ]);

    // 55 references: 40 resolved → ratio ≈ 0.73.
    await seedReferences(repoId, 55, 40);

    const service = makeService();
    const result = await service.getBlastRadius(repoId, ['src/changed.ts']);

    expect(result.degraded).toBe(false);
    expect(result.resolution?.limited).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Scenario C — below floor (10 total) → limited = false regardless of ratio
  // ---------------------------------------------------------------------------

  it('total below 50-ref floor returns resolution.limited = false even at zero resolved', async () => {
    const repo = await setupRepo();
    const repoId = repo.id;
    await seedIndexState(repoId);

    await pg.handle.db.insert(t.symbols).values([
      {
        repoId,
        path: 'src/changed.ts',
        name: 'doSomething',
        kind: 'function',
        line: 1,
        exported: true,
      },
    ]);

    // Only 10 references, none resolved → total < 50 → floor prevents signal.
    await seedReferences(repoId, 10, 0);

    const service = makeService();
    const result = await service.getBlastRadius(repoId, ['src/changed.ts']);

    expect(result.degraded).toBe(false);
    expect(result.resolution?.limited).toBe(false);
  });
});
