import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * W1 — webhook delivery data-access. Owns `webhook_endpoints` and
 * `webhook_deliveries`. Workspace-scoped throughout.
 */

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2_000;

export class WebhooksRepository {
  constructor(private db: Db) {}

  async listEndpoints(workspaceId: string) {
    return this.db
      .select()
      .from(t.webhookEndpoints)
      .where(eq(t.webhookEndpoints.workspaceId, workspaceId));
  }

  async recordDelivery(endpointId: string, payload: unknown, statusCode: number) {
    const [row] = await this.db
      .insert(t.webhookDeliveries)
      .values({
        endpointId,
        payload: payload as object,
        statusCode,
        attempt: 1,
      })
      .returning();
    return row;
  }

  /**
   * Decide which failed deliveries are due for a retry and bump their attempt
   * counter. A delivery is retried with exponential backoff until it hits
   * MAX_ATTEMPTS, after which it's considered dead and left alone so the
   * dashboard can surface it.
   */
  async claimDueRetries(workspaceId: string) {
    const candidates = await this.db
      .select()
      .from(t.webhookDeliveries)
      .innerJoin(t.webhookEndpoints, eq(t.webhookDeliveries.endpointId, t.webhookEndpoints.id))
      .where(
        and(
          eq(t.webhookEndpoints.workspaceId, workspaceId),
          lt(t.webhookDeliveries.statusCode, 200),
        ),
      );

    const due = candidates.filter(({ webhook_deliveries: d }) => {
      if (d.attempt >= MAX_ATTEMPTS) return false;
      const backoff = BASE_BACKOFF_MS * 2 ** (d.attempt - 1);
      const dueAt = new Date(d.createdAt).getTime() + backoff;
      return dueAt <= Date.now();
    });

    if (due.length === 0) return [];

    await this.db.transaction(async (tx) => {
      for (const { webhook_deliveries: d } of due) {
        await tx
          .update(t.webhookDeliveries)
          .set({ attempt: d.attempt + 1 })
          .where(eq(t.webhookDeliveries.id, d.id));
      }
    });

    return due.map(({ webhook_deliveries: d }) => d);
  }
}
