import { pgTable, uuid, text, integer, primaryKey, index } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { skills } from './skills';
import { repos } from './repos';

export const agentDocuments = pgTable(
  'agent_documents',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
    // Per-repository attachment scope (AC-29): each (agent, repo) pair keeps
    // its own independent ordered list, so repoId is part of the primary
    // key. repoId is NOT NULL (migration 0015), so `onDelete: 'set null'` is
    // no longer valid — a repo delete must CASCADE the link rows instead,
    // since a document link cannot meaningfully exist without its repo.
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.repoId, t.path] }),
    repoIdx: index('agent_documents_repo_idx').on(t.repoId),
  }),
);

export const skillDocuments = pgTable(
  'skill_documents',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
    // Per-repository attachment scope (AC-29): each (skill, repo) pair keeps
    // its own independent ordered list, so repoId is part of the primary
    // key. repoId is NOT NULL (migration 0015), so `onDelete: 'set null'` is
    // no longer valid — a repo delete must CASCADE the link rows instead,
    // since a document link cannot meaningfully exist without its repo.
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.repoId, t.path] }),
    repoIdx: index('skill_documents_repo_idx').on(t.repoId),
  }),
);
