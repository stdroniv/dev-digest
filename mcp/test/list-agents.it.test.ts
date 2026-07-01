import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildDeps, structured } from './helpers/harness.js';
import { seed } from '@devdigest/api/db/seed.js';
import { makeListAgentsTool } from '../src/tools/list-agents.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

interface AgentOut {
  name: string;
  enabled: boolean;
  provider: string;
  model: string;
}

d('devdigest_list_agents (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('returns seeded agents with name/provider/model and NO system_prompt', async () => {
    const tool = makeListAgentsTool(buildDeps(pg.handle.db));
    const res = await tool.handler({});
    expect(res.isError).toBeUndefined();
    const out = structured<{ agents: AgentOut[]; count: number }>(res);
    expect(out.count).toBeGreaterThan(0);
    expect(out.agents.length).toBe(out.count);
    const names = out.agents.map((a) => a.name);
    expect(names).toContain('Security Reviewer');
    const sec = out.agents.find((a) => a.name === 'Security Reviewer')!;
    expect(sec.provider).toBe('openrouter');
    expect(sec.model).toBeTruthy();
    expect('system_prompt' in sec).toBe(false);
    expect('id' in sec).toBe(false);
  });

  it('enabled_only filters out disabled agents', async () => {
    const deps = buildDeps(pg.handle.db);
    // Disable one seeded agent via the service (no raw DB access).
    const perf = (await deps.services.agents.list(workspaceId)).find(
      (a) => a.name === 'Performance Reviewer',
    )!;
    await deps.services.agents.update(workspaceId, perf.id, { enabled: false });

    const tool = makeListAgentsTool(deps);
    const all = structured<{ agents: AgentOut[] }>(await tool.handler({ enabled_only: false }));
    const enabledOnly = structured<{ agents: AgentOut[] }>(await tool.handler({ enabled_only: true }));

    expect(all.agents.map((a) => a.name)).toContain('Performance Reviewer');
    expect(enabledOnly.agents.map((a) => a.name)).not.toContain('Performance Reviewer');
    expect(enabledOnly.agents.every((a) => a.enabled)).toBe(true);
  });
});
