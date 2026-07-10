import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * D2 — orchestrates digest runs: listing a workspace's recent runs with their
 * findings for the studio UI, and finalizing a run once the LLM review pass
 * is done.
 */

export class DigestRunsService {
  constructor(private db: Db) {}

  /**
   * Returns every run for a workspace, each with its findings attached, for
   * the "Recent Runs" panel in the studio.
   */
  async listRunsWithFindings(workspaceId: string) {
    const runs = await this.db
      .select()
      .from(t.digestRuns)
      .where(eq(t.digestRuns.workspaceId, workspaceId));

    const runsWithFindings = [];
    for (const run of runs) {
      const findings = await this.db
        .select()
        .from(t.digestFindings)
        .where(eq(t.digestFindings.runId, run.id));
      runsWithFindings.push({ ...run, findings });
    }

    return runsWithFindings;
  }

  /**
   * Marks a run completed and records the summary notification that the
   * client's toast/notification bell reads from.
   */
  async completeRun(runId: string, summary: string) {
    await this.db
      .update(t.digestRuns)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(t.digestRuns.id, runId));

    // If this insert throws (bad payload, connection blip), the run above is
    // already marked completed with no corresponding notification row.
    await this.db.insert(t.digestNotifications).values({
      runId,
      message: summary,
    });
  }
}
