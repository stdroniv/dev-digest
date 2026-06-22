import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

/**
 * End-to-end Conventions Extractor over a real Postgres:
 *   extract (sample clone → mock LLM → mechanical verify → persist)
 *   → list → accept/reject → skill-preview (only accepted survive).
 *
 * The clone is a temp dir holding one real source file so the grounding gate has
 * something to verify against; the LLM is mocked (one grounded + one hallucinated
 * candidate). repo-intel is stubbed to return that file as the ranked sample.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions.it] Docker not available — skipping.');
}

const SOURCE = [
  'export async function getUser(id: string) {',
  '  const user = await db.users.find(id);',
  '  return user;',
  '}',
].join('\n');

const fixture = {
  conventions: [
    {
      category: 'Data access',
      rule: 'Always await db calls',
      // grounded: this snippet really exists in SOURCE
      evidence: { file: 'src/users.ts', start_line: 1, end_line: 1, snippet: 'const user = await db.users.find(id);' },
      confidence: 0.9,
    },
    {
      category: 'Imaginary',
      rule: 'This rule has no real evidence',
      // hallucinated: snippet not present → must be dropped by verification
      evidence: { file: 'src/users.ts', start_line: 1, end_line: 1, snippet: 'const z = totallyMadeUp();' },
      confidence: 0.4,
    },
  ],
};

d('Conventions Extractor (Testcontainers pg)', () => {
  let pg: PgFixture;
  let clonePath: string;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));

    clonePath = await mkdtemp(join(tmpdir(), 'conv-clone-'));
    await mkdir(join(clonePath, 'src'), { recursive: true });
    await writeFile(join(clonePath, 'src/users.ts'), SOURCE, 'utf8');

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'conv-fixture', fullName: 'acme/conv-fixture', clonePath })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
    if (clonePath) await rm(clonePath, { recursive: true, force: true });
  });

  const app = async () =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        llm: { openai: new MockLLMProvider('openai', { structured: fixture }) },
        repoIntel: { getConventionSamples: async () => ['src/users.ts'] } as unknown as RepoIntel,
      },
    });

  it('extract persists ONLY the verified candidate (drops hallucinated evidence)', async () => {
    const a = await app();
    const res = await a.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    const candidates = res.json() as Array<{ rule: string; status: string; evidence_path: string }>;
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.rule).toBe('Always await db calls');
    expect(candidates[0]!.status).toBe('pending');
    expect(candidates[0]!.evidence_path).toBe('src/users.ts');
  });

  it('rejects an invalid repo id with 422 (schema-first)', async () => {
    const a = await app();
    const res = await a.inject({ method: 'POST', url: '/repos/not-a-uuid/conventions/extract' });
    expect(res.statusCode).toBe(422);
  });

  it('skill-preview includes accepted rules and excludes rejected/pending', async () => {
    const a = await app();
    const list = (await a.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json() as Array<{
      id: string;
      rule: string;
    }>;
    expect(list.length).toBeGreaterThanOrEqual(1);

    // Seed a second candidate directly so we have one to reject.
    const [rejectable] = await pg.handle.db
      .insert(t.conventions)
      .values({
        workspaceId,
        repoId,
        rule: 'Rejected rule that must not appear',
        category: 'Bad',
        evidencePath: 'src/users.ts',
        evidenceSnippet: 'return user;',
        evidenceStartLine: 3,
        evidenceEndLine: 3,
        status: 'pending',
      })
      .returning();

    // Accept the extracted one, reject the seeded one.
    const accept = await a.inject({
      method: 'PATCH',
      url: `/conventions/${list[0]!.id}`,
      payload: { status: 'accepted' },
    });
    expect(accept.statusCode).toBe(200);
    expect((accept.json() as { status: string }).status).toBe('accepted');

    await a.inject({ method: 'PATCH', url: `/conventions/${rejectable!.id}`, payload: { status: 'rejected' } });

    const preview = await a.inject({ method: 'POST', url: `/repos/${repoId}/conventions/skill-preview` });
    expect(preview.statusCode).toBe(200);
    const body = (preview.json() as { body: string; name: string }).body;
    expect(body).toContain('Always await db calls');
    expect(body).not.toContain('Rejected rule that must not appear');
    expect(body).not.toContain('## Bad');
  });

  it('PATCH with an empty body is rejected with 422', async () => {
    const a = await app();
    const list = (await a.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json() as Array<{
      id: string;
    }>;
    const res = await a.inject({ method: 'PATCH', url: `/conventions/${list[0]!.id}`, payload: {} });
    expect(res.statusCode).toBe(422);
  });

  it('rejecting a candidate drops it from the list', async () => {
    const a = await app();
    const [seeded] = await pg.handle.db
      .insert(t.conventions)
      .values({
        workspaceId,
        repoId,
        rule: 'Candidate to be rejected',
        category: 'Temp',
        evidencePath: 'src/users.ts',
        evidenceSnippet: 'return user;',
        evidenceStartLine: 3,
        evidenceEndLine: 3,
        status: 'pending',
      })
      .returning();

    const before = (await a.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json() as Array<{
      id: string;
    }>;
    expect(before.some((c) => c.id === seeded!.id)).toBe(true);

    await a.inject({ method: 'PATCH', url: `/conventions/${seeded!.id}`, payload: { status: 'rejected' } });

    const after = (await a.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json() as Array<{
      id: string;
    }>;
    expect(after.some((c) => c.id === seeded!.id)).toBe(false);
  });
});
