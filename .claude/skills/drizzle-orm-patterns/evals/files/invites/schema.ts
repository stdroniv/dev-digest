import { mysqlTable, serial, varchar, timestamp, int, boolean, uniqueIndex } from 'drizzle-orm/mysql-core';

/**
 * I1 — MySQL-backed invites module (self-hosted deployments use MySQL instead
 * of Postgres). `invites` rows expire and get revoked; `users` supports soft
 * delete via `deletedAt` so workspace history survives a removed member.
 */

export const users = mysqlTable('users', {
  id: serial('id').primaryKey(),
  workspaceId: int('workspace_id').notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex('users_email_idx').on(table.email),
}));

export const invites = mysqlTable('invites', {
  id: serial('id').primaryKey(),
  workspaceId: int('workspace_id').notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  // Self-hosted MySQL deploys predate the arrow-function FK convention; this
  // references the table binding directly instead of `() => users.id`.
  invitedBy: int('invited_by').references(users.id),
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
});

export const inviteAuditLog = mysqlTable('invite_audit_log', {
  id: serial('id').primaryKey(),
  inviteId: int('invite_id').notNull().references(() => invites.id),
  action: varchar('action', { length: 32 }).notNull(),
  actedBy: int('acted_by').notNull(),
  actedAt: timestamp('acted_at').notNull().defaultNow(),
});
