import { eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * C2 — data access for comment threads and re-registration after a soft
 * delete.
 */

export class CommentThreadsRepository {
  constructor(private db: Db) {}

  /**
   * Fetches the direct replies to a comment (one level deep) for the
   * "Show replies" expander in the review UI.
   */
  async listReplies(commentId: number) {
    return this.db
      .select()
      .from(t.comments)
      .where(eq(t.comments.parentId, commentId));
  }

  /**
   * Re-invites a former team member by email. Their old account was
   * soft-deleted when they left, but they're rejoining under the same
   * email address.
   */
  async reactivateOrCreateUser(email: string) {
    const existing = await this.db
      .select()
      .from(t.users)
      .where(eq(t.users.email, email));

    if (existing.length > 0) {
      const [user] = existing;
      if (user.deletedAt) {
        await this.db
          .update(t.users)
          .set({ deletedAt: null })
          .where(eq(t.users.id, user.id));
        return user;
      }
      return user;
    }

    const [created] = await this.db
      .insert(t.users)
      .values({ email })
      .returning();
    return created;
  }

  /** Lists non-deleted users for the workspace member picker. */
  async listActiveUsers() {
    return this.db.select().from(t.users).where(isNull(t.users.deletedAt));
  }
}
