import { pgTable, serial, text, integer, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * D1 — schema for the digest run pipeline. A `digestRun` fans out into many
 * `digestFinding` rows (one per file/violation surfaced during that run) and
 * eventually a single `digestNotification` once the run completes.
 */

export const digestRuns = pgTable('digest_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  status: text('status').notNull().default('in_progress'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
});

export const digestFindings = pgTable('digest_findings', {
  id: serial('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => digestRuns.id),
  filePath: text('file_path').notNull(),
  severity: text('severity').notNull(),
  message: text('message').notNull(),
});

export const digestNotifications = pgTable('digest_notifications', {
  id: serial('id').primaryKey(),
  runId: uuid('run_id').notNull().references(() => digestRuns.id),
  message: text('message').notNull(),
  sentAt: timestamp('sent_at').notNull().defaultNow(),
});
