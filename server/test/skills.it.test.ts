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
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * Skills module — CRUD, body versioning (skill_versions), the derived token
 * count, and the import → preview flow (which must NOT persist). The agent side
 * of the link table is covered by the agents tests.
 */
d('skills CRUD + versions + import', () => {
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

  const createBody = {
    name: 'unit-rule',
    description: 'A test rule.',
    type: 'custom' as const,
    body: '# Rule\nDo the thing.',
  };

  it('creates a skill at v1 (with a v1 snapshot) + a derived token count, and lists it', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { ...createBody, name: 'unit-rule-create' },
    });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    // The client defers the POST until Save, so creation earns v1 directly.
    expect(skill).toMatchObject({ name: 'unit-rule-create', type: 'custom', version: 1, enabled: true });
    expect(typeof skill.tokens).toBe('number');
    expect(skill.tokens).toBeGreaterThan(0);
    const versions = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([1]);
    expect(versions[0].body).toBe('# Rule\nDo the thing.');

    const list = await app.inject({ method: 'GET', url: '/skills' });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { id: string }[]).some((s) => s.id === skill.id)).toBe(true);
    await app.close();
  });

  it('body edits bump the version + snapshot; metadata-only edits do not', async () => {
    const app = await makeApp();
    const id = (
      await app.inject({ method: 'POST', url: '/skills', payload: { ...createBody, name: 'unit-rule-version' } })
    ).json().id as string;

    // enabled-only toggle → no body change, so the version stays at v1
    const toggled = await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { enabled: false } });
    expect(toggled.statusCode).toBe(200);
    expect(toggled.json().version).toBe(1);
    expect(toggled.json().enabled).toBe(false);

    // first body change bumps to v2
    const first = await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: '# Rule\nSecond content.' } });
    expect(first.statusCode).toBe(200);
    expect(first.json().version).toBe(2);

    // a later body change bumps to v3
    const edited = await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: '# Rule\nDo it better.' } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().version).toBe(3);

    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]); // newest first
    expect(versions[2].body).toBe('# Rule\nDo the thing.'); // v1 = the body at create
    expect(versions[0].body).toBe('# Rule\nDo it better.');
    await app.close();
  });

  it('rejects a duplicate skill name (case-insensitive) with 409, on create and rename', async () => {
    const app = await makeApp();
    const first = await app.inject({ method: 'POST', url: '/skills', payload: { ...createBody, name: 'dupe-rule' } });
    expect(first.statusCode).toBe(201);

    // Same name (different case) → 409 conflict, nothing created.
    const dup = await app.inject({ method: 'POST', url: '/skills', payload: { ...createBody, name: 'DUPE-RULE' } });
    expect(dup.statusCode).toBe(409);

    // Renaming a different skill onto the taken name → 409.
    const otherId = (
      await app.inject({ method: 'POST', url: '/skills', payload: { ...createBody, name: 'other-rule' } })
    ).json().id as string;
    const renamed = await app.inject({ method: 'PUT', url: `/skills/${otherId}`, payload: { name: 'dupe-rule' } });
    expect(renamed.statusCode).toBe(409);

    // Renaming a skill to its OWN name (no real change) is fine.
    const noop = await app.inject({ method: 'PUT', url: `/skills/${otherId}`, payload: { name: 'other-rule' } });
    expect(noop.statusCode).toBe(200);
    await app.close();
  });

  it('imports a markdown file into a PREVIEW without persisting', async () => {
    const app = await makeApp();
    const before = ((await app.inject({ method: 'GET', url: '/skills' })).json() as unknown[]).length;

    const content_base64 = Buffer.from('# Imported Rule\nuntrusted body', 'utf8').toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import',
      payload: { filename: 'rule.md', content_base64 },
    });
    expect(res.statusCode).toBe(200);
    const preview = res.json();
    expect(preview).toMatchObject({ source: 'imported_url', type: 'custom' });
    expect(preview.body).toContain('untrusted body');
    expect(preview.name).toBe('imported-rule'); // derived from the heading
    expect(preview.ignored_files).toEqual([]);

    // preview did NOT create a skill
    const after = ((await app.inject({ method: 'GET', url: '/skills' })).json() as unknown[]).length;
    expect(after).toBe(before);
    await app.close();
  });

  it('deletes a skill and 404s afterwards', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: createBody })).json().id as string;

    expect((await app.inject({ method: 'DELETE', url: `/skills/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/skills/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/skills/${id}` })).statusCode).toBe(404);
    await app.close();
  });

  it('setting an agent\'s skills is atomic + idempotent (no duplicate-key on re-set or duplicate ids)', async () => {
    const app = await makeApp();
    const agentId = ((await app.inject({ method: 'GET', url: '/agents' })).json() as { id: string }[])[0]!.id;
    const skills = (await app.inject({ method: 'GET', url: '/skills' })).json() as { id: string }[];
    const [a, b] = [skills[0]!.id, skills[1]!.id];

    const set = (skill_ids: string[]) =>
      app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_ids } });

    // Re-setting the same set must not collide on the (agent_id, skill_id) PK.
    expect((await set([a, b])).statusCode).toBe(200);
    const second = await set([a, b]);
    expect(second.statusCode).toBe(200);
    expect((second.json() as unknown[]).length).toBe(2);

    // CONCURRENT identical sets (the Agent editor's checkbox double-fires onChange,
    // landing two requests at once) must all succeed — no duplicate-key race.
    const burst = await Promise.all(Array.from({ length: 6 }, () => set([a])));
    expect(burst.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200, 200]);
    const afterBurst = await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` });
    expect((afterBurst.json() as { skill_id: string }[]).map((l) => l.skill_id)).toEqual([a]);

    // A duplicated id in one request must be deduped, not throw duplicate-key.
    const dup = await set([a, a]);
    expect(dup.statusCode).toBe(200);
    expect((dup.json() as { skill_id: string }[]).map((l) => l.skill_id)).toEqual([a]);

    // Clearing the set works too.
    const cleared = await set([]);
    expect(cleared.statusCode).toBe(200);
    expect((cleared.json() as unknown[]).length).toBe(0);
    await app.close();
  });

  it('seeds the demo skills, with phantom-api-gate imported + disabled (untrusted)', async () => {
    const app = await makeApp();
    const skills = (await app.inject({ method: 'GET', url: '/skills' })).json() as {
      name: string;
      source: string;
      enabled: boolean;
    }[];
    const phantom = skills.find((s) => s.name === 'phantom-api-gate');
    expect(phantom).toBeDefined();
    expect(phantom!.source).toBe('imported_url');
    expect(phantom!.enabled).toBe(false);
    await app.close();
  });
});
