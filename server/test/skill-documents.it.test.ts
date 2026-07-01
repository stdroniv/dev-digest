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
  console.warn('[skill-documents] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * Skill document attachments (`skill_documents`, T8) — ordered attach/detach of
 * project-context Markdown paths (path-only, never inline content). Mirrors the
 * agent-side `agent_skills`/`agent_documents` concurrency precedent: same
 * transaction-scoped advisory lock, verified with a truly concurrent burst.
 *
 * `/skills/*` routes resolve the DEFAULT workspace (no ws param), so a skill
 * created via `POST /skills` lands there and the route-level assertions below
 * see it directly — no need to go around the route for this suite.
 */
d('skill document attachments', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  async function createSkill(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name,
        description: 'd',
        type: 'custom' as const,
        body: '# Rule\nDo the thing.',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; version: number };
  }

  const setDocs = (
    app: Awaited<ReturnType<typeof makeApp>>,
    skillId: string,
    paths: string[],
  ) => app.inject({ method: 'POST', url: `/skills/${skillId}/documents`, payload: { paths } });

  const getDocs = (app: Awaited<ReturnType<typeof makeApp>>, skillId: string) =>
    app.inject({ method: 'GET', url: `/skills/${skillId}/documents` });

  it('set → get round-trips in persisted order, and reorder persists', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'doc-attach-rule');

    const first = await setDocs(app, skill.id, ['docs/a.md', 'specs/b.md']);
    expect(first.statusCode).toBe(200);
    expect((first.json() as { path: string; order: number }[]).map((l) => l.path)).toEqual([
      'docs/a.md',
      'specs/b.md',
    ]);

    const got = await getDocs(app, skill.id);
    expect(got.statusCode).toBe(200);
    expect((got.json() as { path: string; order: number }[]).map((l) => l.path)).toEqual([
      'docs/a.md',
      'specs/b.md',
    ]);

    // Reorder (wholesale replace with a new order).
    const reordered = await setDocs(app, skill.id, ['specs/b.md', 'docs/a.md']);
    expect(reordered.statusCode).toBe(200);
    const gotReordered = await getDocs(app, skill.id);
    expect((gotReordered.json() as { path: string; order: number }[]).map((l) => l.path)).toEqual([
      'specs/b.md',
      'docs/a.md',
    ]);
    expect((gotReordered.json() as { path: string; order: number }[]).map((l) => l.order)).toEqual([
      0, 1,
    ]);

    // Clearing the set works too.
    const cleared = await setDocs(app, skill.id, []);
    expect(cleared.statusCode).toBe(200);
    expect((cleared.json() as unknown[]).length).toBe(0);
    await app.close();
  });

  it('rejects a path-traversal / absolute path in `paths` with 422, and does not persist it', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'doc-attach-traversal-reject');

    // Establish a known baseline so we can prove the rejected calls below
    // don't change it.
    const baseline = await setDocs(app, skill.id, ['docs/a.md']);
    expect(baseline.statusCode).toBe(200);

    const traversal = await setDocs(app, skill.id, ['../../../../.devdigest/secrets.json']);
    expect(traversal.statusCode).toBe(422);

    const absolute = await setDocs(app, skill.id, ['/etc/passwd']);
    expect(absolute.statusCode).toBe(422);

    const after = await getDocs(app, skill.id);
    expect((after.json() as { path: string; order: number }[])).toEqual([
      { path: 'docs/a.md', order: 0 },
    ]);
    await app.close();
  });

  it('404s for an unknown skill on both GET and POST', async () => {
    const app = await makeApp();
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await getDocs(app, missing)).statusCode).toBe(404);
    expect((await setDocs(app, missing, ['docs/a.md'])).statusCode).toBe(404);
    await app.close();
  });

  it('a concurrent Promise.all burst of identical setDocuments is deadlock-free', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'doc-attach-concurrent');

    // A duplicated path in one request must be deduped, not throw duplicate-key.
    const dup = await setDocs(app, skill.id, ['docs/a.md', 'docs/a.md']);
    expect(dup.statusCode).toBe(200);
    expect((dup.json() as { path: string }[]).map((l) => l.path)).toEqual(['docs/a.md']);

    // TRULY CONCURRENT identical sets (mirrors the vendored Checkbox double-fire
    // that motivated the advisory lock for agent_skills) — must all succeed with
    // no `deadlock`/`duplicate key`, and land on a single consistent final set.
    const burst = await Promise.all(
      Array.from({ length: 8 }, () => setDocs(app, skill.id, ['docs/a.md', 'specs/b.md'])),
    );
    expect(burst.map((r) => r.statusCode)).toEqual(Array(8).fill(200));

    const final = await getDocs(app, skill.id);
    expect((final.json() as { path: string }[]).map((l) => l.path)).toEqual([
      'docs/a.md',
      'specs/b.md',
    ]);
    await app.close();
  });

  it('attaching a document does NOT bump the skill body version', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'doc-attach-version-check');
    expect(skill.version).toBe(1);

    const before = (await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json() as {
      version: number;
    };
    expect(before.version).toBe(1);

    const attached = await setDocs(app, skill.id, ['docs/a.md']);
    expect(attached.statusCode).toBe(200);

    const after = (await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json() as {
      version: number;
    };
    expect(after.version).toBe(1); // metadata-only change — no body bump

    // Detaching (clearing the set) must not bump it either.
    await setDocs(app, skill.id, []);
    const afterClear = (await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json() as {
      version: number;
    };
    expect(afterClear.version).toBe(1);
    await app.close();
  });
});
