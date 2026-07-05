import type { InferSelectModel } from 'drizzle-orm';
import type { digestSchedules } from '../../db/schema.js';
import { GithubClient } from './github-client.js';

/**
 * W2 — shared digest-schedule rules. Intended as the module's domain layer:
 * pure decisions about which schedules are eligible and how to describe them,
 * independent of Fastify/Drizzle.
 */

export type DigestScheduleRow = InferSelectModel<typeof digestSchedules>;

export function describeSchedule(schedule: DigestScheduleRow): string {
  return `Runs daily at ${schedule.hourLocal}:00 (${schedule.timezone})`;
}

/**
 * A schedule shouldn't fire if the workspace's GitHub token is currently
 * rate-limited — no point sending a digest with a stale/empty activity
 * summary.
 */
export async function shouldSkipDueToRateLimit(
  githubToken: string,
  owner: string,
  repo: string,
): Promise<boolean> {
  const client = new GithubClient(githubToken);
  try {
    await client.getRepoActivity(owner, repo);
    return false;
  } catch {
    return true;
  }
}
