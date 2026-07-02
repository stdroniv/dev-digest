import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skill-documents] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * Skill document attachments (`skill_documents`) — ordered attach/detach of
 * project-context Markdown paths (path-only, never inline content), scoped by
 * the composite primary key `(skill_id, repo_id, path)` (migration 0015).
 * Mirrors the agent-side `agent_documents` concurrency precedent: same
 * transaction-scoped advisory lock, verified with a truly concurrent burst.
 *
 * `repo_id` is now NOT NULL on every row and REQUIRED on both the GET query
 * string and the POST body (including a clearing `paths: []`): each
 * repository the skill is used against keeps its own fully independent
 * ordered document list (AC-29/AC-30/AC-32). The previous same-repository-
 * invariant `ConflictError` (409 on a second repo) is gone — the same path
 * can be attached under any number of different repos simultaneously.
 *
 * `/skills/*` routes resolve the DEFAULT workspace (no ws param), so a skill
 * created via `POST /skills` lands there and the route-level assertions below
 * see it directly — no need to go around the route for this suite.
 */
d('skill document attachments', () => {
  let pg: PgFixture;
  let repoAId: string;
  let repoBId: string;
  let repoOtherWorkspaceId: string;
  let defaultWorkspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId } = await seed(pg.handle.db);
    defaultWorkspaceId = workspaceId;

    const [seededRepo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    repoAId = seededRepo!.id;

    const [repoB] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'other-repo', fullName: 'acme/other-repo' })
      .returning();
    repoBId = repoB!.id;

    // A repo in a DIFFERENT workspace — used to prove `repo_id` is validated
    // against the caller's workspace, not trusted as a bare uuid (security
    // finding: cross-workspace repo_id must 404, not silently anchor).
    const [otherWorkspace] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-workspace' })
      .returning();
    const [otherRepo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: otherWorkspace!.id,
        owner: 'other-org',
        name: 'other-workspace-repo',
        fullName: 'other-org/other-workspace-repo',
      })
      .returning();
    repoOtherWorkspaceId = otherRepo!.id;
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

  /** `repo_id` intentionally optional here so 422-on-missing tests can omit it. */
  const setDocs = (
    app: Awaited<ReturnType<typeof makeApp>>,
    skillId: string,
    paths: string[],
    repo_id?: string,
  ) =>
    app.inject({
      method: 'POST',
      url: `/skills/${skillId}/documents`,
      payload: { paths, ...(repo_id !== undefined ? { repo_id } : {}) },
    });

  const getDocs = (app: Awaited<ReturnType<typeof makeApp>>, skillId: string, repo_id?: string) => {
    const qs = repo_id !== undefined ? `?repo_id=${repo_id}` : '';
    return app.inject({ method: 'GET', url: `/skills/${skillId}/documents${qs}` });
  };

  it('set → get round-trips in persisted order, and reorder persists', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'doc-attach-rule');

    const first = await setDocs(app, skill.id, ['docs/a.md', 'specs/b.md'], repoAId);
    expect(first.statusCode).toBe(200);
    expect((first.json() as { path: string; order: number }[]).map((l) => l.path)).toEqual([
      'docs/a.md',
      'specs/b.md',
    ]);

    const got = await getDocs(app, skill.id, repoAId);
    expect(got.statusCode).toBe(200);
    expect((got.json() as { path: string; order: number }[]).map((l) => l.path)).toEqual([
      'docs/a.md',
      'specs/b.md',
    ]);

    // Reorder (wholesale replace with a new order, same repo).
    const reordered = await setDocs(app, skill.id, ['specs/b.md', 'docs/a.md'], repoAId);
    expect(reordered.statusCode).toBe(200);
    const gotReordered = await getDocs(app, skill.id, repoAId);
    expect((gotReordered.json() as { path: string; order: number }[]).map((l) => l.path)).toEqual([
      'specs/b.md',
      'docs/a.md',
    ]);
    expect((gotReordered.json() as { path: string; order: number }[]).map((l) => l.order)).toEqual([
      0, 1,
    ]);

    // Clearing the set works too.
    const cleared = await setDocs(app, skill.id, [], repoAId);
    expect(cleared.statusCode).toBe(200);
    expect((cleared.json() as unknown[]).length).toBe(0);
    await app.close();
  });

  it('rejects a path-traversal / absolute path in `paths` with 422, and does not persist it', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'doc-attach-traversal-reject');

    // Establish a known baseline so we can prove the rejected calls below
    // don't change it.
    const baseline = await setDocs(app, skill.id, ['docs/a.md'], repoAId);
    expect(baseline.statusCode).toBe(200);

    const traversal = await setDocs(app, skill.id, ['../../../../.devdigest/secrets.json'], repoAId);
    expect(traversal.statusCode).toBe(422);

    const absolute = await setDocs(app, skill.id, ['/etc/passwd'], repoAId);
    expect(absolute.statusCode).toBe(422);

    const after = await getDocs(app, skill.id, repoAId);
    expect(after.json() as { path: string; order: number }[]).toEqual([
      { path: 'docs/a.md', order: 0, repo_id: repoAId },
    ]);
    await app.close();
  });

  it('404s for an unknown skill on both GET and POST', async () => {
    const app = await makeApp();
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await getDocs(app, missing, repoAId)).statusCode).toBe(404);
    expect((await setDocs(app, missing, ['docs/a.md'], repoAId)).statusCode).toBe(404);
    await app.close();
  });

  it('rejects a POST with paths but no repo_id with 422 (repo_id required when attaching)', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'doc-attach-missing-repo-id');
    const res = await setDocs(app, skill.id, ['docs/a.md']);
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('rejects a POST that CLEARS (paths: []) but has no repo_id with 422 — clearing is repo-scoped too, never global', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'doc-attach-missing-repo-id-clear');
    const res = await setDocs(app, skill.id, []);
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('rejects a GET with no repo_id with 422', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'doc-attach-missing-repo-id-get');
    const res = await getDocs(app, skill.id);
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('rejects a repo_id belonging to a different workspace with 404, and does not persist it', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'doc-attach-cross-workspace-repo');

    // Establish a known baseline so we can prove the rejected call below
    // doesn't change it.
    const baseline = await setDocs(app, skill.id, ['docs/a.md'], repoAId);
    expect(baseline.statusCode).toBe(200);

    const res = await setDocs(app, skill.id, ['docs/other.md'], repoOtherWorkspaceId);
    expect(res.statusCode).toBe(404);

    const after = await getDocs(app, skill.id, repoAId);
    expect(after.json()).toEqual([{ path: 'docs/a.md', order: 0, repo_id: repoAId }]);
    await app.close();
  });

  it('a concurrent Promise.all burst of identical setDocuments is deadlock-free', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'doc-attach-concurrent');

    // A duplicated path in one request must be deduped, not throw duplicate-key.
    const dup = await setDocs(app, skill.id, ['docs/a.md', 'docs/a.md'], repoAId);
    expect(dup.statusCode).toBe(200);
    expect((dup.json() as { path: string }[]).map((l) => l.path)).toEqual(['docs/a.md']);

    // TRULY CONCURRENT identical sets (mirrors the vendored Checkbox double-fire
    // that motivated the advisory lock for agent_skills) — must all succeed with
    // no `deadlock`/`duplicate key`, and land on a single consistent final set.
    const burst = await Promise.all(
      Array.from({ length: 8 }, () => setDocs(app, skill.id, ['docs/a.md', 'specs/b.md'], repoAId)),
    );
    expect(burst.map((r) => r.statusCode)).toEqual(Array(8).fill(200));

    const final = await getDocs(app, skill.id, repoAId);
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

    const attached = await setDocs(app, skill.id, ['docs/a.md'], repoAId);
    expect(attached.statusCode).toBe(200);

    const after = (await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json() as {
      version: number;
    };
    expect(after.version).toBe(1); // metadata-only change — no body bump

    // Detaching (clearing the set) must not bump it either.
    await setDocs(app, skill.id, [], repoAId);
    const afterClear = (await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json() as {
      version: number;
    };
    expect(afterClear.version).toBe(1);
    await app.close();
  });

  // ---- Per-repository independence (AC-29/AC-30/AC-32) --------------------
  // The anchor `ConflictError` is gone — attaching to a second repo no longer
  // conflicts with a first; both repos' lists simply coexist independently.
  // Each test here creates its OWN skill, so there is no shared-fixture
  // interference between them.

  describe('per-repository independence', () => {
    it('(1) the same path attached under repo A and repo B coexists — both persist independently, no 409', async () => {
      const app = await makeApp();
      const skill = await createSkill(app, 'inv-1-coexist');

      const onA = await setDocs(app, skill.id, ['specs/shared.md'], repoAId);
      expect(onA.statusCode).toBe(200);
      expect(onA.json()).toEqual([{ path: 'specs/shared.md', order: 0, repo_id: repoAId }]);

      // Attaching the SAME path under a SECOND repo must succeed (200, not
      // 409) — the old anchor/conflict model no longer exists.
      const onB = await setDocs(app, skill.id, ['specs/shared.md'], repoBId);
      expect(onB.statusCode).toBe(200);
      expect(onB.json()).toEqual([{ path: 'specs/shared.md', order: 0, repo_id: repoBId }]);

      // Both persist independently: repo A's row is untouched by attaching
      // the same path under repo B.
      const getA = await getDocs(app, skill.id, repoAId);
      expect(getA.json()).toEqual([{ path: 'specs/shared.md', order: 0, repo_id: repoAId }]);
      const getB = await getDocs(app, skill.id, repoBId);
      expect(getB.json()).toEqual([{ path: 'specs/shared.md', order: 0, repo_id: repoBId }]);
      await app.close();
    });

    it("(2) GET scoped to repo A returns ONLY repo A's list; GET scoped to repo B returns ONLY repo B's list", async () => {
      const app = await makeApp();
      const skill = await createSkill(app, 'inv-2-scoped-get');

      await setDocs(app, skill.id, ['specs/a-only.md'], repoAId);
      await setDocs(app, skill.id, ['docs/b-only.md'], repoBId);

      const getA = await getDocs(app, skill.id, repoAId);
      expect(getA.json()).toEqual([{ path: 'specs/a-only.md', order: 0, repo_id: repoAId }]);
      const getB = await getDocs(app, skill.id, repoBId);
      expect(getB.json()).toEqual([{ path: 'docs/b-only.md', order: 0, repo_id: repoBId }]);
      await app.close();
    });

    it("(3) clearing repo A's list (paths: []) leaves repo B's list FULLY INTACT — a scoped clear must never touch another repo's rows", async () => {
      const app = await makeApp();
      const skill = await createSkill(app, 'inv-3-scoped-clear');

      await setDocs(app, skill.id, ['specs/a1.md', 'specs/a2.md'], repoAId);
      await setDocs(app, skill.id, ['docs/b1.md', 'docs/b2.md'], repoBId);

      const clearedA = await setDocs(app, skill.id, [], repoAId);
      expect(clearedA.statusCode).toBe(200);
      expect(clearedA.json()).toEqual([]);

      const getA = await getDocs(app, skill.id, repoAId);
      expect(getA.json()).toEqual([]);

      // This is the most important regression to prevent: a scoped clear
      // (`paths: []` for repo A) must NEVER delete/alter repo B's rows.
      const getB = await getDocs(app, skill.id, repoBId);
      expect(getB.json()).toEqual([
        { path: 'docs/b1.md', order: 0, repo_id: repoBId },
        { path: 'docs/b2.md', order: 1, repo_id: repoBId },
      ]);
      await app.close();
    });

    it('(4) a genuinely concurrent Promise.all burst writing to two different repos never conflicts and both persist', async () => {
      const app = await makeApp();
      const skill = await createSkill(app, 'inv-4-concurrent-cross-repo');

      // A TRUE concurrent burst (Promise.all, not sequential awaits) against
      // two DIFFERENT repos: neither call can conflict with the other any
      // more (no shared anchor to contend over), so both must succeed.
      const [onA, onB] = await Promise.all([
        setDocs(app, skill.id, ['specs/concurrent-a.md'], repoAId),
        setDocs(app, skill.id, ['docs/concurrent-b.md'], repoBId),
      ]);

      expect(onA.statusCode).toBe(200);
      expect(onB.statusCode).toBe(200);

      const getA = await getDocs(app, skill.id, repoAId);
      expect(getA.json()).toEqual([{ path: 'specs/concurrent-a.md', order: 0, repo_id: repoAId }]);
      const getB = await getDocs(app, skill.id, repoBId);
      expect(getB.json()).toEqual([{ path: 'docs/concurrent-b.md', order: 0, repo_id: repoBId }]);
      await app.close();
    });
  });

  // ---- Repo delete cascade (FK onDelete: 'cascade', migration 0016) -------
  // repo_id became NOT NULL in migration 0015 but the FK's onDelete was left
  // at the stale 'set null' from 0014, so deleting a repo with attached
  // agent/skill documents would fail with a NOT-NULL constraint violation
  // instead of cleanly cascading. Migration 0016 fixes the FK to CASCADE.

  it('deleting a repo with attached skill documents cascades the link rows instead of violating the NOT NULL constraint', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'cascade-fixture-skill');

    // A dedicated, disposable repo (not repoA/repoB, which other tests in
    // this suite share) so this delete can't disturb their fixtures.
    const [cascadeRepo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: defaultWorkspaceId,
        owner: 'acme',
        name: 'cascade-fixture-skill',
        fullName: 'acme/cascade-fixture-skill',
      })
      .returning();
    const cascadeRepoId = cascadeRepo!.id;

    const attach = await setDocs(app, skill.id, ['specs/cascade.md'], cascadeRepoId);
    expect(attach.statusCode).toBe(200);
    expect(attach.json()).toEqual([{ path: 'specs/cascade.md', order: 0, repo_id: cascadeRepoId }]);

    // Sanity: the link row really exists before the delete.
    const before = await pg.handle.db
      .select()
      .from(t.skillDocuments)
      .where(eq(t.skillDocuments.repoId, cascadeRepoId));
    expect(before).toHaveLength(1);

    // The delete must succeed cleanly — no constraint-violation error/500.
    const del = await app.inject({ method: 'DELETE', url: `/repos/${cascadeRepoId}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: cascadeRepoId });

    // The skill_documents row must be gone (cascaded), not left dangling
    // with a null repo_id (which the NOT NULL constraint forbids anyway).
    const after = await pg.handle.db
      .select()
      .from(t.skillDocuments)
      .where(eq(t.skillDocuments.repoId, cascadeRepoId));
    expect(after).toEqual([]);

    // And the repo row itself is really gone.
    const repoRow = await pg.handle.db.select().from(t.repos).where(eq(t.repos.id, cascadeRepoId));
    expect(repoRow).toEqual([]);

    await app.close();
  });
});
