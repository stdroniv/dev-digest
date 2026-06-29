/**
 * blast name-unique fallback — DB-backed integration test (testcontainers Postgres).
 *
 * Validates the Tier-1 read-time fallback added to tryPersistentBlast:
 *
 *   (a) A globally-unique exported symbol with NULL decl_file has its cross-file
 *       caller surfaced by the fallback path (no reindex required).
 *   (b) An ambiguous exported symbol (≥ 2 export files repo-wide) stays at 0
 *       callers — the fallback does NOT apply to ambiguous names.
 *   (c) A caller file that locally declares a symbol of the same name is excluded
 *       by the precision guard (false-positive vector blocked).
 *
 * Pattern follows blast-routes.it.test.ts: seeds workspace via seed(), inserts
 * distinct repos by name (avoids repos_ws_fullname_uq collision), drives the
 * service facade directly, asserts on BlastResult.
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

d('blast name-unique fallback — DB-backed (testcontainers pg)', () => {
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

  /** Create a fresh repo with a guaranteed-unique fullName. */
  async function setupRepo() {
    const name = `fallback-it-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'test-fallback',
        name,
        fullName: `test-fallback/${name}`,
      })
      .returning();
    return repo!;
  }

  /** Seed a 'full' index-state row so tryPersistentBlast proceeds. */
  async function seedIndexState(repoId: string) {
    await pg.handle.db.insert(t.repoIndexState).values({
      repoId,
      lastIndexedSha: 'deadbeef',
      indexerVersion: INDEXER_VERSION,
      status: 'full',
      filesIndexed: 5,
      filesSkipped: 0,
      stats: {},
      updatedAt: new Date(),
    });
  }

  /** Build a RepoIntelService connected to the testcontainers DB. */
  function makeService() {
    const container = new Container(config(), pg.handle.db, {
      secrets: new MockSecretsProvider({}),
    });
    return new RepoIntelService(container);
  }

  // ---------------------------------------------------------------------------
  // (a) globally-unique export → caller surfaces via fallback
  // ---------------------------------------------------------------------------

  it('globally-unique exported symbol with NULL decl_file shows its cross-file caller', async () => {
    const repo = await setupRepo();
    const repoId = repo.id;
    await seedIndexState(repoId);

    // Changed file exports `getAppCategories` — the only file repo-wide.
    await pg.handle.db.insert(t.symbols).values([
      {
        repoId,
        path: 'src/categories.ts',
        name: 'getAppCategories',
        kind: 'function',
        line: 1,
        exported: true,
      },
    ]);

    // A reference from another file; decl_file is NULL (no edge resolved it).
    await pg.handle.db.insert(t.references).values([
      {
        repoId,
        fromPath: 'src/page.tsx',
        toSymbol: 'getAppCategories',
        line: 10,
        // declFile intentionally omitted → NULL
      },
    ]);

    // file_rank for the caller file (getReferencesByNames inner-joins file_rank).
    await pg.handle.db.insert(t.fileRank).values([
      {
        repoId,
        filePath: 'src/page.tsx',
        pagerank: 0.8,
        hotness: 0,
        rank: 0.8,
        percentile: 80,
      },
    ]);

    const service = makeService();
    const result = await service.getBlastRadius(repoId, ['src/categories.ts']);

    expect(result.degraded).toBe(false);
    // Changed symbol must appear.
    expect(result.changedSymbols.some((s) => s.name === 'getAppCategories')).toBe(true);
    // Fallback caller from src/page.tsx must be attributed.
    const caller = result.callers.find(
      (c) => c.file === 'src/page.tsx' && c.viaSymbol === 'getAppCategories',
    );
    expect(caller).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // (b) ambiguous export (≥ 2 files) → stays 0 callers
  // ---------------------------------------------------------------------------

  it('ambiguous symbol exported by 2 files stays at 0 callers', async () => {
    const repo = await setupRepo();
    const repoId = repo.id;
    await seedIndexState(repoId);

    // `getHref` exported by TWO files → not globally unique.
    await pg.handle.db.insert(t.symbols).values([
      {
        repoId,
        path: 'src/categories.ts',
        name: 'getHref',
        kind: 'function',
        line: 1,
        exported: true,
      },
      {
        repoId,
        path: 'src/nav.ts',
        name: 'getHref',
        kind: 'function',
        line: 1,
        exported: true,
      },
    ]);

    // Reference from another file; decl_file is NULL.
    await pg.handle.db.insert(t.references).values([
      {
        repoId,
        fromPath: 'src/page.tsx',
        toSymbol: 'getHref',
        line: 20,
      },
    ]);

    await pg.handle.db.insert(t.fileRank).values([
      {
        repoId,
        filePath: 'src/page.tsx',
        pagerank: 0.8,
        hotness: 0,
        rank: 0.8,
        percentile: 80,
      },
    ]);

    const service = makeService();
    // Changed file is src/categories.ts which exports getHref (ambiguous).
    const result = await service.getBlastRadius(repoId, ['src/categories.ts']);

    expect(result.degraded).toBe(false);
    // getHref appears as a changed symbol (it IS declared in the changed file).
    expect(result.changedSymbols.some((s) => s.name === 'getHref')).toBe(true);
    // But no callers: ambiguous export → fallback not applied.
    const hrefCallers = result.callers.filter((c) => c.viaSymbol === 'getHref');
    expect(hrefCallers).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // (c) caller file with a local same-named declaration → excluded by guard
  // ---------------------------------------------------------------------------

  it('caller file that locally declares the same symbol name is excluded (precision guard)', async () => {
    const repo = await setupRepo();
    const repoId = repo.id;
    await seedIndexState(repoId);

    // `getAppCategories` exported only by `src/categories.ts` — globally unique.
    // `src/shadowed.tsx` also declares a LOCAL (non-exported) `getAppCategories`.
    await pg.handle.db.insert(t.symbols).values([
      {
        repoId,
        path: 'src/categories.ts',
        name: 'getAppCategories',
        kind: 'function',
        line: 1,
        exported: true,
      },
      {
        repoId,
        path: 'src/shadowed.tsx',
        name: 'getAppCategories',
        kind: 'function',
        line: 5,
        exported: false, // local decl — triggers the precision guard
      },
    ]);

    // Reference from src/shadowed.tsx to getAppCategories; decl_file is NULL.
    await pg.handle.db.insert(t.references).values([
      {
        repoId,
        fromPath: 'src/shadowed.tsx',
        toSymbol: 'getAppCategories',
        line: 20,
      },
    ]);

    // file_rank required for getReferencesByNames to return the row.
    await pg.handle.db.insert(t.fileRank).values([
      {
        repoId,
        filePath: 'src/shadowed.tsx',
        pagerank: 0.7,
        hotness: 0,
        rank: 0.7,
        percentile: 70,
      },
    ]);

    const service = makeService();
    const result = await service.getBlastRadius(repoId, ['src/categories.ts']);

    expect(result.degraded).toBe(false);
    // The shadowed file must NOT appear as a caller.
    const shadowedCaller = result.callers.find((c) => c.file === 'src/shadowed.tsx');
    expect(shadowedCaller).toBeUndefined();
  });
});
