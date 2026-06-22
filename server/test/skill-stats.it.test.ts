/**
 * Skill statistics (Testcontainers pg) — proves the `GET /skills/:id/stats`
 * aggregation end-to-end against real Postgres:
 *  - the agent_skills ⋈ agents ⋈ reviews ⋈ findings join (used-by, pull
 *    frequency, accept rate, findings count + category breakdown);
 *  - the 30-day window EXCLUDES older reviews and reviews by agents that don't
 *    use the skill;
 *  - the HTTP route 404s for an unknown skill;
 *  - the demo SEED makes `pr-quality-rubric` show non-zero stats (regression for
 *    the "reviews seeded without an agent → all-zero stats" gotcha).
 *
 * No LLM/GitHub — data is inserted directly, so the numbers are deterministic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { and, eq } from 'drizzle-orm';
import type { SkillStats } from '@devdigest/shared';
import { SkillsRepository } from '../src/modules/skills/repository.js';
import { computeSkillStats } from '../src/modules/skills/helpers.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('skill stats aggregation', () => {
  let pg: PgFixture;
  let defaultWorkspaceId: string;

  // Hand-built, isolated workspace so its pull-frequency denominator is exactly
  // the reviews we insert (the seed lives in the *default* workspace).
  let handSkillId: string;
  let handWorkspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const db = pg.handle.db;
    const seeded = await seed(db);
    defaultWorkspaceId = seeded.workspaceId;

    // ---- isolated hand-built scenario ----
    const [ws] = await db.insert(t.workspaces).values({ name: 'skill-stats-ws' }).returning();
    handWorkspaceId = ws!.id;
    const [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId: handWorkspaceId,
        owner: 'acme',
        name: 'skill-stats-demo',
        fullName: 'acme/skill-stats-demo',
      })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: handWorkspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Skill stats demo',
        author: 'dev',
        branch: 'feat/x',
        base: 'main',
        headSha: 'sha1',
        additions: 5,
        deletions: 1,
        filesCount: 1,
        status: 'open',
        body: '',
      })
      .returning();
    const prId = pr!.id;

    const [skill] = await db
      .insert(t.skills)
      .values({
        workspaceId: handWorkspaceId,
        name: 'demo-skill',
        description: 'd',
        type: 'rubric',
        source: 'manual',
        body: '# demo',
        enabled: true,
        version: 1,
      })
      .returning();
    handSkillId = skill!.id;

    // A1 + A2 use the skill; A3 does not.
    const mkAgent = (name: string) =>
      db
        .insert(t.agents)
        .values({ workspaceId: handWorkspaceId, name, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'p' })
        .returning({ id: t.agents.id });
    const [a1] = await mkAgent('Agent One');
    const [a2] = await mkAgent('Agent Two');
    const [a3] = await mkAgent('Agent Three');
    await db.insert(t.agentSkills).values([
      { agentId: a1!.id, skillId: handSkillId, order: 0 },
      { agentId: a2!.id, skillId: handSkillId, order: 0 },
    ]);

    const now = new Date();
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago → outside the window

    // Helper: one review + its findings.
    async function addReview(opts: {
      agentId: string | null;
      createdAt: Date;
      findings?: { category: string; decision: 'accepted' | 'dismissed' | 'open' }[];
    }): Promise<void> {
      const [review] = await db
        .insert(t.reviews)
        .values({
          workspaceId: handWorkspaceId,
          prId,
          agentId: opts.agentId,
          kind: 'review',
          verdict: 'comment',
          model: 'm',
          createdAt: opts.createdAt,
        })
        .returning({ id: t.reviews.id });
      let i = 0;
      for (const f of opts.findings ?? []) {
        await db.insert(t.findings).values({
          reviewId: review!.id,
          file: 'src/x.ts',
          startLine: ++i,
          endLine: i,
          severity: 'WARNING',
          category: f.category,
          title: `f${i}`,
          rationale: 'r',
          confidence: 0.9,
          acceptedAt: f.decision === 'accepted' ? new Date() : null,
          dismissedAt: f.decision === 'dismissed' ? new Date() : null,
        });
      }
    }

    // In-window, skill agents (counted).
    await addReview({
      agentId: a1!.id,
      createdAt: now,
      findings: [
        { category: 'bug', decision: 'accepted' },
        { category: 'perf', decision: 'dismissed' },
        { category: 'bug', decision: 'accepted' },
      ],
    });
    await addReview({
      agentId: a2!.id,
      createdAt: now,
      findings: [
        { category: 'security', decision: 'accepted' },
        { category: 'style', decision: 'dismissed' },
      ],
    });
    // In-window, NON-skill agent (denominator only; its finding must be excluded).
    await addReview({
      agentId: a3!.id,
      createdAt: now,
      findings: [{ category: 'bug', decision: 'accepted' }],
    });
    // OUT-of-window, skill agent (excluded from pull numerator AND findings).
    await addReview({
      agentId: a1!.id,
      createdAt: old,
      findings: [{ category: 'bug', decision: 'accepted' }],
    });
    // In-window but no agent (excluded — agent_id is null).
    await addReview({ agentId: null, createdAt: now });
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('computes per-skill stats over the join, honoring the window + skill filter', async () => {
    const repo = new SkillsRepository(pg.handle.db);
    const raw = await repo.getStats(handWorkspaceId, handSkillId, 30);

    // pull frequency: in-window reviews with an agent = a1, a2, a3 (3); of those,
    // skill agents = a1, a2 (2). The old a1 review + the null-agent review drop out.
    expect(raw.reviewsInWindowTotal).toBe(3);
    expect(raw.reviewsInWindowForSkill).toBe(2);
    // findings: only the 5 from a1+a2's in-window reviews (a3's + the old one drop).
    expect(raw.findings).toHaveLength(5);

    const stats = computeSkillStats(handSkillId, 30, raw);
    expect(stats.used_by.count).toBe(2);
    expect(stats.used_by.agents.map((a) => a.name)).toEqual(['Agent One', 'Agent Two']);
    expect(stats.pull_frequency_pct).toBe(66.7); // 2/3
    expect(stats.accept_rate_pct).toBe(60); // 3 accepted of 5 decided
    expect(stats.findings_30d).toBe(5);
    expect(stats.findings_by_category).toEqual([
      { category: 'bug', count: 2 },
      { category: 'perf', count: 1 },
      { category: 'security', count: 1 },
      { category: 'style', count: 1 },
    ]);
  });

  it('404s for an unknown skill', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const missing = await app.inject({
      method: 'GET',
      url: '/skills/00000000-0000-0000-0000-000000000000/stats',
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('the demo seed makes pr-quality-rubric show non-zero stats', async () => {
    const db = pg.handle.db;
    const [skill] = await db
      .select()
      .from(t.skills)
      .where(
        and(eq(t.skills.workspaceId, defaultWorkspaceId), eq(t.skills.name, 'pr-quality-rubric')),
      );
    expect(skill).toBeDefined();

    const app = await buildApp({ config: config(), db });
    const res = await app.inject({ method: 'GET', url: `/skills/${skill!.id}/stats` });
    expect(res.statusCode).toBe(200);
    const stats = res.json() as SkillStats;
    expect(stats.skill_id).toBe(skill!.id);
    expect(stats.window_days).toBe(30);

    // Used by 3 agents (General + Performance + Test Quality reviewers).
    expect(stats.used_by.count).toBe(3);
    expect(stats.used_by.agents.map((a) => a.name)).toEqual([
      'General Reviewer',
      'Performance Reviewer',
      'Test Quality Reviewer',
    ]);
    // 15 categorized findings, 11 accepted → 73.3%.
    expect(stats.findings_30d).toBe(15);
    expect(stats.accept_rate_pct).toBe(73.3);
    expect(stats.findings_by_category).toEqual([
      { category: 'bug', count: 5 },
      { category: 'style', count: 4 },
      { category: 'perf', count: 3 },
      { category: 'security', count: 2 },
      { category: 'test', count: 1 },
    ]);
    // 3 of the 6 in-window agent reviews use the rubric → 50%.
    expect(stats.pull_frequency_pct).toBe(50);
    await app.close();
  });
});
