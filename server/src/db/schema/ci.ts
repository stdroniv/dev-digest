import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  doublePrecision,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const ciInstallations = pgTable('ci_installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
  /** Bumped on every (re-)export so an older-config installation is distinguishable (AC-41). */
  workflowVersion: integer('workflow_version').notNull().default(1),
  /** Hash of the normalized manifest at the time of the last install — drift source (AC-40). */
  installedConfigHash: text('installed_config_hash'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
    /** The GitHub Actions run id this row was reconciled from — idempotency key (AC-30/34). */
    actionsRunId: text('actions_run_id'),
    /** Per-severity breakdown from the CiResultArtifact — fills the CI Runs page Findings column (AC-35). */
    critical: integer('critical'),
    warning: integer('warning'),
    suggestion: integer('suggestion'),
    /** Run duration from the artifact — fills the CI Runs page Duration column (AC-35). */
    durationMs: integer('duration_ms'),
    /** The reviewed PR's title, best-effort via GitHub — fills the Pull request column (AC-35). */
    prTitle: text('pr_title'),
  },
  // Repeated reconcile of the same Actions run must not double-insert (AC-30/34).
  (t) => ({
    installationActionsRunUnique: uniqueIndex('ci_runs_installation_actions_run_uq').on(
      t.ciInstallationId,
      t.actionsRunId,
    ),
  }),
);
