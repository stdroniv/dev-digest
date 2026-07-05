import { pgTable, serial, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * C1 — nested review-comment threads (a reviewer can reply to another
 * reviewer's comment, arbitrarily deep) plus the `users` table that owns
 * them. Soft delete keeps a departed user's historical comments attributed.
 */

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('users_email_idx').on(table.email),
]);

export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  // Adjacency-list self-reference: a reply points back at its parent comment.
  parentId: integer('parent_id').references(() => comments.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const commentsRelations = relations(comments, ({ one }) => ({
  author: one(users, {
    fields: [comments.authorId],
    references: [users.id],
  }),
}));
