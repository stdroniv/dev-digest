import { and, asc, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';
import {
  blockersFromCounts,
  computeConfigHash,
  resolveAgentSlug,
  toBundleAgent,
  type ArtifactSeverityCounts,
} from '../modules/ci/helpers.js';

/**
 * T8 — idempotent dev seed for the Export-to-CI feature (SPEC-05): populates
 * `ci_installations`, `ci_runs`, and matching `agent_runs(source='ci')` rows
 * so the CI Runs page, the CI tab's exported/drift states, and the agent
 * Stats tab's Source column all demo without a live GitHub round-trip
 * (AC-35/39/40/42). A fresh/unseeded DB still reaches the empty states
 * (AC-37) — this is only ever called from `db/seed.ts`, after the built-in
 * agents + their linked skills are seeded.
 *
 * Data is shaped from the design's `CI_RUNS` fixture (PRs #479/477/471/468,
 * "Security Reviewer") plus two extra rows (#465 running, #460
 * skipped_no_credentials) so every `CiRunStatus` value is represented. Kept
 * on its own PR numbers (never #482/#501/#512, which other seed fixtures /
 * tests already own — server INSIGHTS.md:16,67) and its own repos
 * (`acme/payments-api` for the current installation, `acme/billing-service`
 * for the drift-eligible one) so re-running `pnpm db:seed` twice, or running
 * this alongside the existing seed-dependent tests/e2e, never perturbs them.
 */

const CI_AGENT_NAME = 'Security Reviewer';
const CURRENT_REPO = 'acme/payments-api';
const DRIFT_REPO = 'acme/billing-service';

type SeedCiRunStatus = 'succeeded' | 'no_findings' | 'failed' | 'running' | 'skipped_no_credentials';

interface CiRunSeed {
  actionsRunId: string;
  prNumber: number;
  prTitle: string;
  ranAt: string;
  status: SeedCiRunStatus;
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
  durationMs: number | null;
  costUsd: number | null;
  /** Failure/skip note → `agent_runs.error` (mirrors `reconcile.ts`'s `RunOutcome.note`). */
  note: string | null;
}

// Shaped from the design's `CI_RUNS` fixture (PRs 479/477/471/468), plus two
// extra rows so every `CiRunStatus` value is represented (AC-27/32/33/35).
const CI_RUN_SEEDS: CiRunSeed[] = [
  {
    actionsRunId: '1000465',
    prNumber: 465,
    prTitle: 'Add webhook retry queue with backoff',
    ranAt: '2026-07-12T09:40:00Z',
    status: 'running',
    critical: null,
    warning: null,
    suggestion: null,
    durationMs: null,
    costUsd: null,
    note: null,
  },
  {
    actionsRunId: '1000479',
    prNumber: 479,
    prTitle: 'Migrate sessions table to UUID primary key',
    ranAt: '2026-07-12T08:15:00Z',
    status: 'succeeded',
    critical: 1,
    warning: 4,
    suggestion: 0,
    durationMs: 9100,
    costUsd: 0.09,
    note: null,
  },
  {
    actionsRunId: '1000477',
    prNumber: 477,
    prTitle: 'Fix flaky checkout integration test',
    ranAt: '2026-07-11T22:03:00Z',
    status: 'no_findings',
    critical: 0,
    warning: 0,
    suggestion: 0,
    durationMs: 5200,
    costUsd: 0.03,
    note: null,
  },
  {
    actionsRunId: '1000471',
    prNumber: 471,
    prTitle: 'Refactor invoice PDF renderer',
    ranAt: '2026-07-11T18:30:00Z',
    status: 'failed',
    critical: null,
    warning: null,
    suggestion: null,
    durationMs: null,
    costUsd: null,
    note: 'No result artifact was found for this run — the job likely failed or errored before upload.',
  },
  {
    actionsRunId: '1000468',
    prNumber: 468,
    prTitle: 'Add idempotency keys to charge endpoint',
    ranAt: '2026-07-11T14:12:00Z',
    status: 'succeeded',
    critical: 0,
    warning: 1,
    suggestion: 2,
    durationMs: 6800,
    costUsd: 0.05,
    note: null,
  },
  {
    actionsRunId: '1000460',
    prNumber: 460,
    prTitle: 'Bump reviewer runner to pinned checkout SHA',
    ranAt: '2026-07-10T09:00:00Z',
    status: 'skipped_no_credentials',
    critical: 0,
    warning: 0,
    suggestion: 0,
    durationMs: 800,
    costUsd: 0,
    note: null,
  },
];

/** `null` only when reconcile never recorded per-severity data (failed/running) — mirrors `toCiRunDto`. */
function findingsCountFor(seed: CiRunSeed): number | null {
  if (seed.critical == null && seed.warning == null && seed.suggestion == null) return null;
  return (seed.critical ?? 0) + (seed.warning ?? 0) + (seed.suggestion ?? 0);
}

interface InstallationSeedInput {
  agentId: string;
  repo: string;
  workflowVersion: number;
  installedConfigHash: string;
}

/** Select-then-insert/update by `(agent_id, repo)` — no unique DB constraint
 *  backs this pair (only `ci_runs` has one, on `(ci_installation_id,
 *  actions_run_id)`), so the seed enforces its own idempotency here. */
async function upsertInstallation(db: Db, input: InstallationSeedInput): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: t.ciInstallations.id })
    .from(t.ciInstallations)
    .where(and(eq(t.ciInstallations.agentId, input.agentId), eq(t.ciInstallations.repo, input.repo)));
  if (existing) {
    // Repair-on-reseed: keeps the hash/version in sync if the agent's config
    // (and therefore its real current hash) has changed since the last seed.
    await db
      .update(t.ciInstallations)
      .set({
        workflowVersion: input.workflowVersion,
        installedConfigHash: input.installedConfigHash,
        updatedAt: new Date(),
      })
      .where(eq(t.ciInstallations.id, existing.id));
    return existing;
  }
  const [row] = await db
    .insert(t.ciInstallations)
    .values({
      agentId: input.agentId,
      repo: input.repo,
      targetType: 'gha',
      workflowVersion: input.workflowVersion,
      installedConfigHash: input.installedConfigHash,
    })
    .returning({ id: t.ciInstallations.id });
  return row!;
}

/**
 * Seed the CI demo data (AC-35/39/40/42), linked to the built-in "Security
 * Reviewer" agent (`db/seed.ts` must have already inserted it — a no-op
 * otherwise, mirroring `seedAgentEvalCases`'s `if (!agent) return;` guard).
 * Idempotent: `ci_installations` are select-then-insert/update by `(agent_id,
 * repo)`; `ci_runs` are upserted by the same `(ci_installation_id,
 * actions_run_id)` unique key reconcile relies on (migration `0021`); a
 * matching `agent_runs(source='ci')` row is written ONLY when its `ci_runs`
 * insert was actually NEW (mirrors `CiRepository.upsertCiRun`'s
 * `justBecameTerminal` signal — see reconcile.ts / server INSIGHTS.md:98), so
 * re-running `pnpm db:seed` never duplicates either table.
 */
export async function seedCi(db: Db, workspaceId: string): Promise<void> {
  const [agent] = await db
    .select({
      id: t.agents.id,
      workspaceId: t.agents.workspaceId,
      name: t.agents.name,
      provider: t.agents.provider,
      model: t.agents.model,
      systemPrompt: t.agents.systemPrompt,
      strategy: t.agents.strategy,
      ciFailOn: t.agents.ciFailOn,
    })
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, CI_AGENT_NAME)));
  if (!agent) return; // built-in agents seed first (db/seed.ts) — nothing to link to yet

  const skillRows = await db
    .select({ name: t.skills.name })
    .from(t.agentSkills)
    .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
    .where(eq(t.agentSkills.agentId, agent.id))
    .orderBy(asc(t.agentSkills.order));
  const skillNames = skillRows.map((s) => s.name);

  // No other agent has a CI installation in this seeded workspace (only this
  // one is exported here), so the slug/hash inputs below match exactly what
  // `CiService.listInstallations` recomputes at read time.
  const slug = resolveAgentSlug(agent.name, []);
  const currentHash = computeConfigHash(toBundleAgent(agent), skillNames, slug);

  const currentInstallation = await upsertInstallation(db, {
    agentId: agent.id,
    repo: CURRENT_REPO,
    workflowVersion: 3,
    installedConfigHash: currentHash, // matches the agent's live config → update_available: false
  });

  // Deliberately stale — never equals a real sha256 hex digest — so this
  // installation always reads `update_available: true` (AC-40).
  await upsertInstallation(db, {
    agentId: agent.id,
    repo: DRIFT_REPO,
    workflowVersion: 1,
    installedConfigHash: 'seed-stale-config-hash',
  });

  for (const seed of CI_RUN_SEEDS) {
    const findingsCount = findingsCountFor(seed);
    const [inserted] = await db
      .insert(t.ciRuns)
      .values({
        ciInstallationId: currentInstallation.id,
        actionsRunId: seed.actionsRunId,
        prNumber: seed.prNumber,
        prTitle: seed.prTitle,
        ranAt: new Date(seed.ranAt),
        status: seed.status,
        findingsCount,
        critical: seed.critical,
        warning: seed.warning,
        suggestion: seed.suggestion,
        durationMs: seed.durationMs,
        costUsd: seed.costUsd,
        githubUrl: `https://github.com/${CURRENT_REPO}/actions/runs/${seed.actionsRunId}`,
        source: 'ci',
      })
      .onConflictDoNothing({ target: [t.ciRuns.ciInstallationId, t.ciRuns.actionsRunId] })
      .returning({ id: t.ciRuns.id });

    // Only a NEWLY inserted, non-`running` row gets a matching agent_runs
    // row — a repeat seed's conflicting insert returns nothing here, so this
    // stays idempotent with no second lookup needed.
    if (inserted && seed.status !== 'running') {
      const counts: ArtifactSeverityCounts = {
        critical: seed.critical ?? 0,
        warning: seed.warning ?? 0,
        suggestion: seed.suggestion ?? 0,
      };
      // skipped_no_credentials never blocks a merge (AC-27), regardless of counts.
      const blockers =
        seed.status === 'skipped_no_credentials' ? 0 : blockersFromCounts(counts, agent.ciFailOn);
      await db.insert(t.agentRuns).values({
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        prId: null,
        ranAt: new Date(seed.ranAt),
        provider: agent.provider,
        model: agent.model,
        status: seed.status,
        error: seed.note,
        source: 'ci',
        findingsCount,
        grounding: null,
        score: null,
        blockers: findingsCount == null ? null : blockers,
        costUsd: seed.costUsd,
        durationMs: seed.durationMs,
      });
    }
  }
}
