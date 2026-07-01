import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { loadConfig } from '../src/platform/config.js';
import { Container } from '../src/platform/container.js';
import { ConventionsService } from '../src/modules/conventions/service.js';
import * as t from '../src/db/schema.js';

/**
 * Server-level coverage for the accepted-only passthrough added for the MCP
 * server (`ConventionsService.listAccepted` → `ConventionsRepository.listAccepted`).
 * Unlike `list()`, it must surface ONLY `status='accepted'` rows — never the
 * pending/rejected candidates the web UI still acts on.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions-list-accepted.it] Docker not available — skipping.');
}

d('ConventionsService.listAccepted (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'conv-accepted', fullName: 'acme/conv-accepted' })
      .returning();
    repoId = repo!.id;

    await pg.handle.db.insert(t.conventions).values([
      {
        workspaceId,
        repoId,
        rule: 'Always await db calls',
        category: 'Data access',
        evidencePath: 'src/users.ts',
        evidenceSnippet: 'const user = await db.users.find(id);',
        evidenceStartLine: 1,
        evidenceEndLine: 1,
        confidence: 0.9,
        status: 'accepted',
        accepted: true,
      },
      {
        workspaceId,
        repoId,
        rule: 'This one is still pending',
        category: 'Naming',
        evidencePath: 'src/users.ts',
        evidenceSnippet: 'return user;',
        evidenceStartLine: 3,
        evidenceEndLine: 3,
        confidence: 0.8,
        status: 'pending',
      },
    ]);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('returns ONLY the accepted convention (excludes pending)', async () => {
    const service = new ConventionsService(new Container(config(), pg.handle.db));
    const accepted = await service.listAccepted(workspaceId, repoId);

    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.rule).toBe('Always await db calls');
    expect(accepted[0]!.status).toBe('accepted');
    expect(accepted.some((c) => c.rule === 'This one is still pending')).toBe(false);
  });
});
