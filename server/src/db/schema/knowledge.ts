import { pgTable, uuid, text, jsonb, timestamp, doublePrecision, boolean, vector, integer, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

// Conventions Extractor (L0x): one row per detected codestyle convention CANDIDATE.
// The LLM proposes candidates from sampled repo files; code-side verification drops
// any whose cited evidence doesn't exist before persistence. The user then
// accepts/rejects/edits each, and the ACCEPTED ones are merged into a single
// `repo-conventions` skill. `status` is the source of truth (pending → accepted /
// rejected); the legacy `accepted` boolean is kept in sync for back-compat.
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    // Groups all candidates produced by one extraction run (a "scan").
    runId: uuid('run_id'),
    // Convention grouping, e.g. "Error handling", "Naming" — used as the skill's
    // markdown section heading.
    category: text('category'),
    rule: text('rule').notNull(),
    evidencePath: text('evidence_path'),
    evidenceSnippet: text('evidence_snippet'),
    // 1-based line range in `evidencePath` that proves the rule (for the clickable
    // GitHub link). Nullable for full-file evidence.
    evidenceStartLine: integer('evidence_start_line'),
    evidenceEndLine: integer('evidence_end_line'),
    confidence: doublePrecision('confidence'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    accepted: boolean('accepted').notNull().default(false),
    createdAt: now(),
  },
  (t) => ({ repoIdx: index('conventions_repo_idx').on(t.repoId) }),
);
