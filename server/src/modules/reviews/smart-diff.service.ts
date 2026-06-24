import type { SmartDiff, FindingAnnotation } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from './repository.js';
import { assembleSmartDiff } from './smart-diff.classify.js';

/** Maps stored uppercase severity to the lowercase annotation enum. */
const SEVERITY_TO_ANNOTATION: Record<string, FindingAnnotation['severity']> = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  SUGGESTION: 'suggestion',
};

/**
 * SmartDiffService — reads persisted PR files and findings from the DB,
 * then assembles a SmartDiff contract value.
 *
 * No LLM or GitHub call is made. All data comes from rows already
 * persisted by earlier import/review flows.
 */
export class SmartDiffService {
  private repo: ReviewRepository;

  constructor(container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  /**
   * Return a SmartDiff for the given PR.
   *
   * - Verifies the PR exists in the workspace (throws NotFoundError if not).
   * - Maps pr_files rows to {path, additions, deletions}.
   * - Aggregates finding start_line values across the newest review per agent
   *   (multi-agent runs emit one review per agent). Empty map when no reviews exist.
   * - Returns the assembled SmartDiff contract value.
   */
  async get(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError(`PR ${prId} not found`);

    const prFileRows = await this.repo.getPrFiles(prId);
    const files = prFileRows.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    }));

    // Aggregate finding annotations across the NEWEST review PER agent. A multi-agent
    // run emits one 'review' row per agent (reviewsForPull is newest-first), so
    // dedupe by agentId and union every agent's latest review's findings —
    // mirrors the per-(pr,agent) tally in pulls/routes.ts. A null agentId
    // (legacy/seed review) collapses to a single bucket.
    const annotationsByPath = new Map<string, FindingAnnotation[]>();
    const reviewRows = await this.repo.reviewsForPull(prId);
    const seenAgents = new Set<string>();
    for (const { review, findings } of reviewRows) {
      if (review.kind !== 'review') continue;
      const agentKey = review.agentId ?? 'null';
      if (seenAgents.has(agentKey)) continue;
      seenAgents.add(agentKey);
      for (const finding of findings) {
        if (finding.dismissedAt != null) continue;
        const bucket = annotationsByPath.get(finding.file) ?? [];
        bucket.push({
          line: finding.startLine,
          severity: SEVERITY_TO_ANNOTATION[finding.severity] ?? 'suggestion',
          finding_id: finding.id,
        });
        annotationsByPath.set(finding.file, bucket);
      }
    }

    return assembleSmartDiff(files, annotationsByPath);
  }
}
