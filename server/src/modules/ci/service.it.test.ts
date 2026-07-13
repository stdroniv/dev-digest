/**
 * CiService.install — DB-backed integration tests (SPEC-05 T6).
 *
 * Acceptance:
 *  - fresh export        ⇒ 1 installation + commitFiles to `devdigest/ci` + 1 PR
 *  - re-export           ⇒ reuses installation/branch/PR, bumps workflow_version, no duplicate (AC-17/41)
 *  - failed openPullRequest ⇒ typed error (ExternalServiceError), no installation row (AC-11)
 *  - changed agent config ⇒ flips update_available (AC-40)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { loadConfig } from '../../platform/config.js';
import { Container } from '../../platform/container.js';
import { MockGitHubClient } from '../../adapters/mocks.js';
import { ExternalServiceError } from '../../platform/errors.js';
import * as t from '../../db/schema.js';
import { CiService } from './service.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Simulates "no write access, or the CI token cannot create a PR" (AC-11). */
class FailingPrGitHubClient extends MockGitHubClient {
  override async openPullRequest(): Promise<{ url: string }> {
    throw new Error('mock: cannot open PR (no write access)');
  }
}

let seq = 0;

d('CiService.install — commit+PR idempotency, failure path, drift (T6)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const [ws] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'ci-install-test' })
      .returning();
    workspaceId = ws!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  async function makeAgent(name = `CI Install Agent ${seq++}`) {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name,
        provider: 'openrouter',
        model: 'anthropic/claude-3.5-sonnet',
        systemPrompt: 'Review this PR for security issues.',
        ciFailOn: 'critical',
      })
      .returning();
    return agent!;
  }

  function makeService(github: MockGitHubClient) {
    const container = new Container(config(), pg.handle.db, { github });
    return { container, service: new CiService(container) };
  }

  it('fresh export creates exactly 1 installation + 1 atomic commit to devdigest/ci + 1 PR', async () => {
    const agent = await makeAgent();
    const github = new MockGitHubClient();
    const { service } = makeService(github);

    const result = await service.install({ workspaceId, agentId: agent.id, repo: 'acme/widgets-1' });

    expect(result.pr_url).toBe('https://github.com/mock/mock/pull/1');
    expect(github.committed).toHaveLength(1);
    expect(github.committed[0]!.branch).toBe('devdigest/ci');
    expect(github.openedPrs).toHaveLength(1);
    expect(github.openedPrs[0]!.title).toBe('Add DevDigest CI review');

    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agent.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workflowVersion).toBe(1);
    expect(rows[0]!.repo).toBe('acme/widgets-1');
    expect(rows[0]!.installedConfigHash).toBeTruthy();
  });

  it('re-export reuses the installation + branch + PR, bumps workflow_version, no duplicate (AC-17/41)', async () => {
    const agent = await makeAgent();
    const github = new MockGitHubClient();
    const { service } = makeService(github);
    const repo = 'acme/widgets-2';

    const first = await service.install({ workspaceId, agentId: agent.id, repo });
    const second = await service.install({ workspaceId, agentId: agent.id, repo });

    expect(second.installation.id).toBe(first.installation.id);
    expect(first.installation.workflow_version).toBe(1);
    expect(second.installation.workflow_version).toBe(2);
    expect(second.pr_url).toBe(first.pr_url);
    // Reused the SAME open PR — only one openPullRequest call across both installs.
    expect(github.openedPrs).toHaveLength(1);
    // Each install still re-publishes the file set (a real commit each time).
    expect(github.committed).toHaveLength(2);
    expect(github.committed.every((c) => c.branch === 'devdigest/ci')).toBe(true);

    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agent.id));
    expect(rows).toHaveLength(1); // never a duplicate row
    expect(rows[0]!.workflowVersion).toBe(2);
  });

  it('a failed openPullRequest throws a typed error and leaves no installation row (AC-11)', async () => {
    const agent = await makeAgent();
    const github = new FailingPrGitHubClient();
    const { service } = makeService(github);

    await expect(
      service.install({ workspaceId, agentId: agent.id, repo: 'acme/widgets-3' }),
    ).rejects.toBeInstanceOf(ExternalServiceError);

    // commitFiles is atomic — the branch commit still happened (a complete
    // tree, not a partial one) — but no DB row was ever written (AC-11).
    expect(github.committed).toHaveLength(1);
    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agent.id));
    expect(rows).toHaveLength(0);
  });

  it('a changed agent config flips update_available (AC-40)', async () => {
    const agent = await makeAgent();
    const github = new MockGitHubClient();
    const { container, service } = makeService(github);

    await service.install({ workspaceId, agentId: agent.id, repo: 'acme/widgets-4' });
    const before = await service.listInstallations(workspaceId, agent.id);
    expect(before).toHaveLength(1);
    expect(before[0]!.update_available).toBe(false);

    await container.agentsRepo.update(workspaceId, agent.id, {
      systemPrompt: 'A completely different prompt now — drift should surface.',
    });

    const after = await service.listInstallations(workspaceId, agent.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.update_available).toBe(true);
  });

  it('two agents exported to the same repo get distinct installations (AC-16), and re-exporting the LATER one keeps its own slug stable (AC-17)', async () => {
    const agentA = await makeAgent('Security Reviewer');
    const agentB = await makeAgent('security reviewer'); // slugifies identically to A
    const github = new MockGitHubClient();
    const { service } = makeService(github);
    const repo = 'acme/widgets-5';

    // A installs first (establishing the base slug), then B (a genuinely
    // different agent whose name collides) — B's competitor set (just A)
    // never changes across B's own two installs, so B's slug stays stable.
    const resultA = await service.install({ workspaceId, agentId: agentA.id, repo });
    const resultB1 = await service.install({ workspaceId, agentId: agentB.id, repo });
    const resultB2 = await service.install({ workspaceId, agentId: agentB.id, repo });

    expect(resultA.installation.id).not.toBe(resultB1.installation.id);
    const manifestPathOf = (files: typeof resultA.files) =>
      files.find((f) => f.path.startsWith('.devdigest/agents/'))!.path;
    expect(manifestPathOf(resultB1.files)).not.toBe(manifestPathOf(resultA.files));
    expect(manifestPathOf(resultB2.files)).toBe(manifestPathOf(resultB1.files)); // stable across B's own re-export

    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.repo, repo));
    expect(rows).toHaveLength(2); // one per agent, never merged/overwritten
  });
});
