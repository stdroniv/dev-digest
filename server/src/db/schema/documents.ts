import { pgTable, uuid, text, integer, primaryKey } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { skills } from './skills';

export const agentDocuments = pgTable(
  'agent_documents',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.agentId, t.path] }) }),
);

export const skillDocuments = pgTable(
  'skill_documents',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.path] }) }),
);
