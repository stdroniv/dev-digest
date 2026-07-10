import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * I2 — invite lifecycle: bulk-creating invites for CSV import, listing active
 * members for the workspace settings page, paging through outstanding
 * invites, and revoking a single invite.
 */

export class InvitesService {
  constructor(private db: Db) {}

  /**
   * Bulk-imports invites from a CSV upload. Workspaces on the growth plan can
   * upload up to 5,000 emails at once.
   */
  async createInvitesBatch(workspaceId: string, emails: string[], invitedBy: number) {
    const rows = emails.map((email) => ({
      workspaceId: Number(workspaceId),
      email,
      invitedBy,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }));

    // Single insert call for the whole batch — CSV imports commonly carry
    // several thousand rows.
    const inserted = await this.db.insert(t.invites).values(rows).returning();
    return inserted;
  }

  /**
   * Lists members currently in the workspace for the settings page's member
   * table.
   */
  async listActiveMembers(workspaceId: string) {
    return this.db
      .select()
      .from(t.users)
      .where(eq(t.users.workspaceId, Number(workspaceId)));
  }

  /**
   * Paginated view over a workspace's outstanding (non-revoked) invites for
   * the "Pending Invites" table.
   */
  async getInvitesPage(workspaceId: string, page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    return this.db
      .select()
      .from(t.invites)
      .where(
        and(
          eq(t.invites.workspaceId, Number(workspaceId)),
          isNull(t.invites.revokedAt),
        ),
      )
      .limit(pageSize)
      .offset(offset);
  }

  /**
   * Revokes a pending invite and appends an audit-log entry in the same
   * transaction so the two rows can't drift apart.
   */
  async revokeInvite(inviteId: number, actedBy: number) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(t.invites)
        .set({ revokedAt: new Date(), status: 'revoked' })
        .where(eq(t.invites.id, inviteId));

      await tx.insert(t.inviteAuditLog).values({
        inviteId,
        action: 'revoked',
        actedBy,
      });
    });
  }
}
