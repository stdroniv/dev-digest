import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agent-documents] Docker not available — skipping integration tests.');
}

/**
 * Agent document attachments (SPEC-01 T7) — ordered, path-only attach/reorder
 * over `agent_documents`, mirroring the `agent_skills` precedent exactly
 * (dedupe, wholesale replace + reorder, transaction-scoped advisory lock).
 */
d('agent document attachments', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  async function firstAgentId(app: Awaited<ReturnType<typeof makeApp>>) {
    const agents = (await app.inject({ method: 'GET', url: '/agents' })).json() as { id: string }[];
    return agents[0]!.id;
  }

  it('set → get returns paths in persisted order, and reordering persists the new order', async () => {
    const app = await makeApp();
    const agentId = await firstAgentId(app);

    const set = (paths: string[]) =>
      app.inject({ method: 'POST', url: `/agents/${agentId}/documents`, payload: { paths } });
    const get = () => app.inject({ method: 'GET', url: `/agents/${agentId}/documents` });

    const first = await set(['specs/a.md', 'docs/b.md']);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual([
      { path: 'specs/a.md', order: 0 },
      { path: 'docs/b.md', order: 1 },
    ]);

    const afterSet = await get();
    expect(afterSet.statusCode).toBe(200);
    expect(afterSet.json()).toEqual([
      { path: 'specs/a.md', order: 0 },
      { path: 'docs/b.md', order: 1 },
    ]);

    // Reorder: calling setDocuments again with a different order persists it.
    const reordered = await set(['docs/b.md', 'specs/a.md']);
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json()).toEqual([
      { path: 'docs/b.md', order: 0 },
      { path: 'specs/a.md', order: 1 },
    ]);

    const afterReorder = await get();
    expect(afterReorder.json()).toEqual([
      { path: 'docs/b.md', order: 0 },
      { path: 'specs/a.md', order: 1 },
    ]);
    await app.close();
  });

  it('a duplicated path in one request is deduped, not a duplicate-key error', async () => {
    const app = await makeApp();
    const agentId = await firstAgentId(app);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/documents`,
      payload: { paths: ['specs/a.md', 'specs/a.md'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ path: 'specs/a.md', order: 0 }]);

    const cleared = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/documents`,
      payload: { paths: [] },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual([]);
    await app.close();
  });

  it('a TRULY concurrent burst of identical setDocuments calls does not deadlock/duplicate-key, and converges to a consistent set', async () => {
    const app = await makeApp();
    const agentId = await firstAgentId(app);

    const set = (paths: string[]) =>
      app.inject({ method: 'POST', url: `/agents/${agentId}/documents`, payload: { paths } });

    // A TRUE concurrent burst (Promise.all, not sequential awaits) — mirrors the
    // Agent editor checkbox double-fire that motivated the advisory lock on
    // setSkills. Sequential awaits never exercise the race.
    const burst = await Promise.all(
      Array.from({ length: 6 }, () => set(['specs/a.md', 'docs/b.md', 'insights/c.md'])),
    );
    expect(burst.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200, 200]);

    const after = await app.inject({ method: 'GET', url: `/agents/${agentId}/documents` });
    expect(after.json()).toEqual([
      { path: 'specs/a.md', order: 0 },
      { path: 'docs/b.md', order: 1 },
      { path: 'insights/c.md', order: 2 },
    ]);
    await app.close();
  });

  it('rejects a path-traversal / absolute path in `paths` with 422, and does not persist it', async () => {
    const app = await makeApp();
    const agentId = await firstAgentId(app);

    const set = (paths: string[]) =>
      app.inject({ method: 'POST', url: `/agents/${agentId}/documents`, payload: { paths } });
    const get = () => app.inject({ method: 'GET', url: `/agents/${agentId}/documents` });

    // Establish a known baseline so we can prove the rejected calls below
    // don't change it (regardless of what earlier tests left persisted).
    const baseline = await set(['specs/a.md']);
    expect(baseline.statusCode).toBe(200);

    const traversal = await set(['../../../../.devdigest/secrets.json']);
    expect(traversal.statusCode).toBe(422);

    const absolute = await set(['/etc/passwd']);
    expect(absolute.statusCode).toBe(422);

    // A rejected request must not partially persist — confirmed via a follow-up GET
    // showing the baseline is unchanged.
    const after = await get();
    expect(after.json()).toEqual([{ path: 'specs/a.md', order: 0 }]);
    await app.close();
  });

  it('404s for an unknown agent on both GET and POST', async () => {
    const app = await makeApp();
    const unknownId = '00000000-0000-0000-0000-000000000000';
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${unknownId}/documents` })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/agents/${unknownId}/documents`,
          payload: { paths: [] },
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });
});
