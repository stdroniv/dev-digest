import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

/**
 * Documents module routes (SPEC-01 T6) over a real Postgres:
 *   GET /repos/:id/documents          → discovered docs + ready|not_cloned|empty state
 *   GET /repos/:id/documents/content  → preview one file's fresh content
 *
 * Three repo fixtures cover the three `state` outcomes; content route is
 * exercised against the cloned-with-docs fixture, including a path-traversal
 * attempt that must be rejected (422) before it ever reaches the filesystem.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[documents-routes] Docker not available — skipping integration tests.');
}

d('documents routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonedClonePath: string;
  let emptyClonePath: string;
  let clonedRepoId: string;
  let emptyRepoId: string;
  let notClonedRepoId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));

    // Cloned repo with a real `.md` file under the default `specs` root.
    clonedClonePath = await mkdtemp(join(tmpdir(), 'documents-routes-cloned-'));
    await mkdir(join(clonedClonePath, 'specs'), { recursive: true });
    await writeFile(join(clonedClonePath, 'specs/SPEC-01.md'), '# Project Context\nSome spec body.', 'utf8');

    // Cloned repo with no `.md` files under any configured root.
    emptyClonePath = await mkdtemp(join(tmpdir(), 'documents-routes-empty-'));
    await mkdir(join(emptyClonePath, 'specs'), { recursive: true });
    await writeFile(join(emptyClonePath, 'specs/notes.txt'), 'not markdown', 'utf8');

    const [clonedRepo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'docs-fixture-cloned',
        fullName: 'acme/docs-fixture-cloned',
        clonePath: clonedClonePath,
      })
      .returning();
    clonedRepoId = clonedRepo!.id;

    const [emptyRepo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'docs-fixture-empty',
        fullName: 'acme/docs-fixture-empty',
        clonePath: emptyClonePath,
      })
      .returning();
    emptyRepoId = emptyRepo!.id;

    const [notClonedRepo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'docs-fixture-not-cloned',
        fullName: 'acme/docs-fixture-not-cloned',
        clonePath: null,
      })
      .returning();
    notClonedRepoId = notClonedRepo!.id;
  });

  afterAll(async () => {
    await pg?.stop();
    if (clonedClonePath) await rm(clonedClonePath, { recursive: true, force: true });
    if (emptyClonePath) await rm(emptyClonePath, { recursive: true, force: true });
  });

  const makeApp = () =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

  it('returns discovered docs with token estimates and state:"ready" for a cloned repo with docs', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${clonedRepoId}/documents` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { state: string; documents: { path: string; root: string; tokens: number }[] };
    expect(body.state).toBe('ready');
    expect(body.documents).toEqual([
      { path: 'specs/SPEC-01.md', root: 'specs', tokens: expect.any(Number) },
    ]);
    expect(body.documents[0]!.tokens).toBeGreaterThan(0);
    await app.close();
  });

  it('returns state:"not_cloned" when the repo has no clone_path', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${notClonedRepoId}/documents` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ documents: [], state: 'not_cloned' });
    await app.close();
  });

  it('returns state:"empty" when the configured roots have no .md files', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${emptyRepoId}/documents` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ documents: [], state: 'empty' });
    await app.close();
  });

  it('404s for an unknown repo id', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/repos/00000000-0000-0000-0000-000000000000/documents',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns file content for a valid path', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: `/repos/${clonedRepoId}/documents/content?path=specs/SPEC-01.md`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      path: 'specs/SPEC-01.md',
      content: '# Project Context\nSome spec body.',
    });
    await app.close();
  });

  it('404s for a valid-looking but missing path', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: `/repos/${clonedRepoId}/documents/content?path=specs/does-not-exist.md`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('rejects a path-traversal attempt with 422, not file contents', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: `/repos/${clonedRepoId}/documents/content?${new URLSearchParams({ path: '../../etc/passwd' }).toString()}`,
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
