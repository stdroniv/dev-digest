import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, boolean, numeric, primaryKey } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  createdAt: now(),
});

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull(),
  suggestion: text('suggestion'),
  confidence: doublePrecision('confidence').notNull(),
  kind: text('kind').notNull().default('finding'),
  trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
});

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});

/**
 * Why+Risk Brief (SPEC-03) — a NEW, standalone per-PR artifact. Distinct from
 * the composite `pr_brief` above (AC-26): (re)generation must never touch
 * `pr_brief`, and this table sidesteps the four-block `PrBrief.safeParse`
 * trap entirely. One row per PR (`prId` PK) — last-write-wins on conflict.
 */
export const whyRiskBrief = pgTable('why_risk_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  /** Grounded `WhyRiskBrief` payload (shared contract). */
  brief: jsonb('brief').notNull(),
  docsTruncated: boolean('docs_truncated').notNull().default(false),
  /** Which optional inputs were missing/degraded — for AC-19/22 display. */
  degradedInputs: jsonb('degraded_inputs'),
  /** Staleness fingerprint over intent/blast/smart-diff inputs (AC-15). */
  inputsFingerprint: text('inputs_fingerprint').notNull(),
  model: text('model'),
  costUsd: numeric('cost_usd'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Per-file "What this does" AI summary (Smart-Diff view, core-group files
 * only, on-demand). Keyed by `(pr_id, path)` — NOT a uuid id, and NOT a FK to
 * `pr_files.id` — because `pr_files` rows are deleted + reinserted on every
 * PR sync, so a stable identity has to be the pair the client already
 * addresses the file by. `patch_hash` (sha256 of the patch at generation
 * time) drives the staleness check on read, mirroring `why_risk_brief`'s
 * `inputs_fingerprint`.
 */
export const prFileSummary = pgTable(
  'pr_file_summary',
  {
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    summary: text('summary').notNull(),
    patchHash: text('patch_hash').notNull(),
    model: text('model'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.prId, t.path] }),
  }),
);
