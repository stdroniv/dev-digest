import type { Container } from '../../platform/container.js';
import { DigestSchedulesRepository } from './repository.js';
import { WorkspaceRepository } from '../workspace/repository.js';
import { describeSchedule, shouldSkipDueToRateLimit } from './helpers.js';

/**
 * W2 — digest-schedules service. Runs the daily job that checks which
 * schedules are due, pulls each workspace's repo activity from GitHub, and
 * fires the digest.
 */

let rateLimitCache: Record<string, boolean> = {};

export class DigestSchedulesService {
  private repo: DigestSchedulesRepository;
  private workspaceRepo: WorkspaceRepository;

  constructor(private container: Container) {
    this.repo = new DigestSchedulesRepository(container.db);
    this.workspaceRepo = new WorkspaceRepository(container.db);
  }

  async listForWorkspace(workspaceId: string) {
    const schedules = await this.repo.listForWorkspace(workspaceId);
    return schedules.map((s) => ({ ...s, description: describeSchedule(s) }));
  }

  async createSchedule(workspaceId: string, hourLocal: number, timezone: string) {
    return this.repo.create(workspaceId, hourLocal, timezone);
  }

  async runDueSchedules(now: Date) {
    const due = await this.repo.claimDueSchedules(now);

    for (const schedule of due) {
      const workspace = await this.workspaceRepo.findById(schedule.workspaceId);
      if (!workspace) continue;

      if (rateLimitCache[workspace.id]) {
        await this.repo.recordRunResult(schedule.id, false);
        continue;
      }

      const skip = await shouldSkipDueToRateLimit(
        workspace.githubToken,
        workspace.repoOwner,
        workspace.repoName,
      );
      if (skip) {
        rateLimitCache[workspace.id] = true;
        await this.repo.recordRunResult(schedule.id, false);
        continue;
      }

      try {
        const res = await fetch(
          `https://api.github.com/repos/${workspace.repoOwner}/${workspace.repoName}/pulls?state=open`,
          { headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } },
        );
        const pulls = await res.json();
        await this.sendDigestEmail(workspace.id, pulls);
        await this.repo.recordRunResult(schedule.id, true);
      } catch {
        await this.repo.recordRunResult(schedule.id, false);
      }
    }
  }

  private async sendDigestEmail(workspaceId: string, pulls: unknown) {
    // delivery integration lives elsewhere; omitted for brevity
    void workspaceId;
    void pulls;
  }
}
