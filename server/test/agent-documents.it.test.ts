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
  console.warn('[agent-documents] Docker not available — skipping integration tests.');
}

/**
 * Agent document attachments (`agent_documents`) — ordered, path-only
 * attach/reorder, scoped by the composite primary key
 * `(agent_id, repo_id, path)` (migration 0015). `repo_id` is now NOT NULL on
 * every row and REQUIRED on both the GET query string and the POST body
 * (including a clearing `paths: []`): each repository the agent is used
 * against keeps its own fully independent ordered document list (AC-29/AC-30).
 * There is no more cross-repo "anchor" — the previous same-repository-invariant
 * `ConflictError` (409 on a second repo) has been removed; the same path can be
 * attached under any number of different repos simultaneously.
 */
d('agent document attachments', () => {
  let pg: PgFixture;
  let repoAId: string;
  let repoBId: string;
  let repoOtherWorkspaceId: string;
  let defaultWorkspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId } = await seed(pg.handle.db);
    defaultWorkspaceId = workspaceId;

    // repo A = the seeded demo repo.
    const [seededRepo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    repoAId = seededRepo!.id;

    // repo B — a second, distinct repo (server/INSIGHTS: must not collide
    // with the seed's `acme/payments-api` unique (workspace_id, full_name)).
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

  /** `repo_id` intentionally optional here so 422-on-missing tests can omit it. */
  function set(
    app: Awaited<ReturnType<typeof makeApp>>,
    agentId: string,
    paths: string[],
    repo_id?: string,
  ) {
    return app.inject({
      method: 'POST',
      url: `/agents/${agentId}/documents`,
      payload: { paths, ...(repo_id !== undefined ? { repo_id } : {}) },
    });
  }

  function get(app: Awaited<ReturnType<typeof makeApp>>, agentId: string, repo_id?: string) {
    const qs = repo_id !== undefined ? `?repo_id=${repo_id}` : '';
    return app.inject({ method: 'GET', url: `/agents/${agentId}/documents${qs}` });
  }

  it('set → get returns paths in persisted order, and reordering persists the new order', async () => {
    const app = await makeApp();
    const agentId = await firstAgentId(app);

    const first = await set(app, agentId, ['specs/a.md', 'docs/b.md'], repoAId);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual([
      { path: 'specs/a.md', order: 0, repo_id: repoAId },
      { path: 'docs/b.md', order: 1, repo_id: repoAId },
    ]);

    const afterSet = await get(app, agentId, repoAId);
    expect(afterSet.statusCode).toBe(200);
    expect(afterSet.json()).toEqual([
      { path: 'specs/a.md', order: 0, repo_id: repoAId },
      { path: 'docs/b.md', order: 1, repo_id: repoAId },
    ]);

    // Reorder: calling setDocuments again with a different order (same repo) persists it.
    const reordered = await set(app, agentId, ['docs/b.md', 'specs/a.md'], repoAId);
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json()).toEqual([
      { path: 'docs/b.md', order: 0, repo_id: repoAId },
      { path: 'specs/a.md', order: 1, repo_id: repoAId },
    ]);

    const afterReorder = await get(app, agentId, repoAId);
    expect(afterReorder.json()).toEqual([
      { path: 'docs/b.md', order: 0, repo_id: repoAId },
      { path: 'specs/a.md', order: 1, repo_id: repoAId },
    ]);

    await set(app, agentId, [], repoAId); // clean up
    await app.close();
  });

  it('a duplicated path in one request is deduped, not a duplicate-key error', async () => {
    const app = await makeApp();
    const agentId = await firstAgentId(app);

    const res = await set(app, agentId, ['specs/a.md', 'specs/a.md'], repoAId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ path: 'specs/a.md', order: 0, repo_id: repoAId }]);

    const cleared = await set(app, agentId, [], repoAId);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual([]);
    await app.close();
  });

  it('rejects a path-traversal / absolute path in `paths` with 422, and does not persist it', async () => {
    const app = await makeApp();
    const agentId = await firstAgentId(app);

    // Establish a known baseline so we can prove the rejected calls below
    // don't change it (regardless of what earlier tests left persisted).
    const baseline = await set(app, agentId, ['specs/a.md'], repoAId);
    expect(baseline.statusCode).toBe(200);

    const traversal = await set(app, agentId, ['../../../../.devdigest/secrets.json'], repoAId);
    expect(traversal.statusCode).toBe(422);

    const absolute = await set(app, agentId, ['/etc/passwd'], repoAId);
    expect(absolute.statusCode).toBe(422);

    // A rejected request must not partially persist — confirmed via a follow-up GET
    // showing the baseline is unchanged.
    const after = await get(app, agentId, repoAId);
    expect(after.json()).toEqual([{ path: 'specs/a.md', order: 0, repo_id: repoAId }]);

    await set(app, agentId, [], repoAId); // clean up
    await app.close();
  });

  it('rejects a POST with paths but no repo_id with 422 (repo_id required when attaching)', async () => {
    const app = await makeApp();
    const agentId = await firstAgentId(app);

    const res = await set(app, agentId, ['specs/a.md']);
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('rejects a POST that CLEARS (paths: []) but has no repo_id with 422 — clearing is repo-scoped too, never global', async () => {
    const app = await makeApp();
    const agentId = await firstAgentId(app);

    const res = await set(app, agentId, []);
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('rejects a GET with no repo_id with 422', async () => {
    const app = await makeApp();
    const agentId = await firstAgentId(app);

    const res = await get(app, agentId);
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('404s for an unknown agent on both GET and POST', async () => {
    const app = await makeApp();
    const unknownId = '00000000-0000-0000-0000-000000000000';
    expect((await get(app, unknownId, repoAId)).statusCode).toBe(404);
    expect((await set(app, unknownId, [], repoAId)).statusCode).toBe(404);
    await app.close();
  });

  it('rejects a repo_id belonging to a different workspace with 404, and does not persist it', async () => {
    const app = await makeApp();
    const agentId = await firstAgentId(app);

    // Establish a known baseline so we can prove the rejected call below
    // doesn't change it (regardless of what earlier tests left persisted).
    const baseline = await set(app, agentId, ['specs/a.md'], repoAId);
    expect(baseline.statusCode).toBe(200);

    const res = await set(app, agentId, ['docs/other.md'], repoOtherWorkspaceId);
    expect(res.statusCode).toBe(404);

    const after = await get(app, agentId, repoAId);
    expect(after.json()).toEqual([{ path: 'specs/a.md', order: 0, repo_id: repoAId }]);

    await set(app, agentId, [], repoAId); // clean up
    await app.close();
  });

  // ---- Per-repository independence (AC-29/AC-30/AC-32) --------------------
  // The anchor `ConflictError` is gone — attaching to a second repo no longer
  // conflicts with a first; both repos' lists simply coexist independently.

  describe('per-repository independence', () => {
    it('(1) the same path attached under repo A and repo B coexists — both persist independently, no 409', async () => {
      const app = await makeApp();
      const agentId = await firstAgentId(app);
      // Clean slate for both repos (this describe block shares the seeded agent).
      await set(app, agentId, [], repoAId);
      await set(app, agentId, [], repoBId);

      const onA = await set(app, agentId, ['specs/shared.md'], repoAId);
      expect(onA.statusCode).toBe(200);
      expect(onA.json()).toEqual([{ path: 'specs/shared.md', order: 0, repo_id: repoAId }]);

      // Attaching the SAME path under a SECOND repo must succeed (200, not
      // 409) — the old anchor/conflict model no longer exists.
      const onB = await set(app, agentId, ['specs/shared.md'], repoBId);
      expect(onB.statusCode).toBe(200);
      expect(onB.json()).toEqual([{ path: 'specs/shared.md', order: 0, repo_id: repoBId }]);

      // Both persist independently: repo A's row is untouched by attaching
      // the same path under repo B.
      const getA = await get(app, agentId, repoAId);
      expect(getA.json()).toEqual([{ path: 'specs/shared.md', order: 0, repo_id: repoAId }]);
      const getB = await get(app, agentId, repoBId);
      expect(getB.json()).toEqual([{ path: 'specs/shared.md', order: 0, repo_id: repoBId }]);

      await set(app, agentId, [], repoAId);
      await set(app, agentId, [], repoBId);
      await app.close();
    });

    it("(2) GET scoped to repo A returns ONLY repo A's list; GET scoped to repo B returns ONLY repo B's list", async () => {
      const app = await makeApp();
      const agentId = await firstAgentId(app);
      await set(app, agentId, [], repoAId);
      await set(app, agentId, [], repoBId);

      await set(app, agentId, ['specs/a-only.md'], repoAId);
      await set(app, agentId, ['docs/b-only.md'], repoBId);

      const getA = await get(app, agentId, repoAId);
      expect(getA.json()).toEqual([{ path: 'specs/a-only.md', order: 0, repo_id: repoAId }]);
      const getB = await get(app, agentId, repoBId);
      expect(getB.json()).toEqual([{ path: 'docs/b-only.md', order: 0, repo_id: repoBId }]);

      await set(app, agentId, [], repoAId);
      await set(app, agentId, [], repoBId);
      await app.close();
    });

    it("(3) clearing repo A's list (paths: []) leaves repo B's list FULLY INTACT — a scoped clear must never touch another repo's rows", async () => {
      const app = await makeApp();
      const agentId = await firstAgentId(app);
      await set(app, agentId, [], repoAId);
      await set(app, agentId, [], repoBId);

      await set(app, agentId, ['specs/a1.md', 'specs/a2.md'], repoAId);
      await set(app, agentId, ['docs/b1.md', 'docs/b2.md'], repoBId);

      const clearedA = await set(app, agentId, [], repoAId);
      expect(clearedA.statusCode).toBe(200);
      expect(clearedA.json()).toEqual([]);

      const getA = await get(app, agentId, repoAId);
      expect(getA.json()).toEqual([]);

      // This is the most important regression to prevent: a scoped clear
      // (`paths: []` for repo A) must NEVER delete/alter repo B's rows.
      const getB = await get(app, agentId, repoBId);
      expect(getB.json()).toEqual([
        { path: 'docs/b1.md', order: 0, repo_id: repoBId },
        { path: 'docs/b2.md', order: 1, repo_id: repoBId },
      ]);

      await set(app, agentId, [], repoBId);
      await app.close();
    });

    it('(4) a genuinely concurrent Promise.all burst writing to two different repos never conflicts and both persist', async () => {
      const app = await makeApp();
      const agentId = await firstAgentId(app);
      await set(app, agentId, [], repoAId);
      await set(app, agentId, [], repoBId);

      // A TRUE concurrent burst (Promise.all, not sequential awaits) against
      // two DIFFERENT repos: neither call can conflict with the other any
      // more (no shared anchor to contend over), so both must succeed.
      const [onA, onB] = await Promise.all([
        set(app, agentId, ['specs/concurrent-a.md'], repoAId),
        set(app, agentId, ['docs/concurrent-b.md'], repoBId),
      ]);

      expect(onA.statusCode).toBe(200);
      expect(onB.statusCode).toBe(200);

      const getA = await get(app, agentId, repoAId);
      expect(getA.json()).toEqual([{ path: 'specs/concurrent-a.md', order: 0, repo_id: repoAId }]);
      const getB = await get(app, agentId, repoBId);
      expect(getB.json()).toEqual([{ path: 'docs/concurrent-b.md', order: 0, repo_id: repoBId }]);

      await set(app, agentId, [], repoAId);
      await set(app, agentId, [], repoBId);
      await app.close();
    });
  });

  // ---- Repo delete cascade (FK onDelete: 'cascade', migration 0016) -------
  // repo_id became NOT NULL in migration 0015 but the FK's onDelete was left
  // at the stale 'set null' from 0014, so deleting a repo with attached
  // agent/skill documents would fail with a NOT-NULL constraint violation
  // instead of cleanly cascading. Migration 0016 fixes the FK to CASCADE.

  it('deleting a repo with attached agent documents cascades the link rows instead of violating the NOT NULL constraint', async () => {
    const app = await makeApp();
    const agentId = await firstAgentId(app);

    // A dedicated, disposable repo (not repoA/repoB, which other tests in
    // this suite share) so this delete can't disturb their fixtures.
    const [cascadeRepo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: defaultWorkspaceId,
        owner: 'acme',
        name: 'cascade-fixture',
        fullName: 'acme/cascade-fixture',
      })
      .returning();
    const cascadeRepoId = cascadeRepo!.id;

    const attach = await set(app, agentId, ['specs/cascade.md'], cascadeRepoId);
    expect(attach.statusCode).toBe(200);
    expect(attach.json()).toEqual([{ path: 'specs/cascade.md', order: 0, repo_id: cascadeRepoId }]);

    // Sanity: the link row really exists before the delete.
    const before = await pg.handle.db
      .select()
      .from(t.agentDocuments)
      .where(eq(t.agentDocuments.repoId, cascadeRepoId));
    expect(before).toHaveLength(1);

    // The delete must succeed cleanly — no constraint-violation error/500.
    const del = await app.inject({ method: 'DELETE', url: `/repos/${cascadeRepoId}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: cascadeRepoId });

    // The agent_documents row must be gone (cascaded), not left dangling
    // with a null repo_id (which the NOT NULL constraint forbids anyway).
    const after = await pg.handle.db
      .select()
      .from(t.agentDocuments)
      .where(eq(t.agentDocuments.repoId, cascadeRepoId));
    expect(after).toEqual([]);

    // And the repo row itself is really gone.
    const repoRow = await pg.handle.db.select().from(t.repos).where(eq(t.repos.id, cascadeRepoId));
    expect(repoRow).toEqual([]);

    await app.close();
  });
});
