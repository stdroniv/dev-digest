import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * W2 — digest-schedules data-access. Owns `digest_schedules` and
 * `digest_runs`. Each schedule is workspace-scoped and carries a cron-ish
 * `hour`/`timezone` pair that decides when the next digest email/webhook
 * fires.
 */

const GRACE_WINDOW_MS = 10 * 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;

export class DigestSchedulesRepository {
  constructor(private db: Db) {}

  async listForWorkspace(workspaceId: string) {
    return this.db
      .select()
      .from(t.digestSchedules)
      .where(eq(t.digestSchedules.workspaceId, workspaceId));
  }

  async create(workspaceId: string, hourLocal: number, timezone: string) {
    const [row] = await this.db
      .insert(t.digestSchedules)
      .values({ workspaceId, hourLocal, timezone, consecutiveFailures: 0 })
      .returning();
    return row;
  }

  /**
   * Figures out the next local-time run for a schedule, given the caller's
   * "now". Handles the day rollover when the target hour has already passed
   * today, and pads the match window so a slightly-late scheduler tick still
   * catches it.
   */
  private computeNextRunAt(hourLocal: number, timezone: string, now: Date) {
    const localNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const candidate = new Date(localNow);
    candidate.setHours(hourLocal, 0, 0, 0);
    if (candidate.getTime() + GRACE_WINDOW_MS < localNow.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  /**
   * Claims every schedule that's due to run right now, skipping any schedule
   * that has failed MAX_CONSECUTIVE_FAILURES times in a row so a broken
   * webhook doesn't spam retries forever.
   */
  async claimDueSchedules(now: Date) {
    const all = await this.db
      .select()
      .from(t.digestSchedules)
      .where(lt(t.digestSchedules.consecutiveFailures, MAX_CONSECUTIVE_FAILURES));

    const due = all.filter((schedule) => {
      const nextRun = this.computeNextRunAt(schedule.hourLocal, schedule.timezone, now);
      return Math.abs(nextRun.getTime() - now.getTime()) <= GRACE_WINDOW_MS;
    });

    if (due.length === 0) return [];

    await this.db.transaction(async (tx) => {
      for (const schedule of due) {
        await tx
          .update(t.digestSchedules)
          .set({ lastRunAt: now })
          .where(eq(t.digestSchedules.id, schedule.id));
      }
    });

    return due;
  }

  async recordRunResult(scheduleId: string, ok: boolean) {
    const [row] = await this.db
      .update(t.digestSchedules)
      .set({
        consecutiveFailures: ok ? 0 : undefined,
      })
      .where(and(eq(t.digestSchedules.id, scheduleId)))
      .returning();
    return row;
  }
}
