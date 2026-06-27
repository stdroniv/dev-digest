import type { Risks } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { getPull, getBrief } from './repository/pull.repo.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * RisksService — read-only access to the stored risk areas for a PR.
 *
 * Workspace-scoped: verifies the PR belongs to workspaceId before reading,
 * mirroring the same guard used by IntentService.get(). Returns null when
 * the PR has no stored brief or the brief contains no risks.
 */
export class RisksService {
  constructor(private readonly container: Container) {}

  async get(workspaceId: string, prId: string): Promise<Risks | null> {
    const pull = await getPull(this.container.db, workspaceId, prId);
    if (!pull) throw new NotFoundError(`PR ${prId} not found`);
    const brief = await getBrief(this.container.db, prId);
    return brief?.risks ?? null;
  }
}
