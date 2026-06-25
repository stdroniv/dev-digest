/**
 * SmartDiffService — hermetic unit tests.
 *
 * SmartDiffService embeds ReviewRepository construction (no DI seam), so
 * the tests spy on ReviewRepository.prototype methods to control inputs and
 * assert on the returned SmartDiff shape. No DB or network is involved.
 *
 * The DB-backed end-to-end behaviour (full Postgres round-trip) is covered
 * by smart-diff-routes.it.test.ts. These tests target the service-layer
 * mapping logic that is hard to isolate in an integration test.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SmartDiffService } from '../src/modules/reviews/smart-diff.service.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { Container } from '../src/platform/container.js';
import type { PullRow, FindingRow } from '../src/db/rows.js';
import type { ReviewRow } from '../src/modules/reviews/repository.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-svc-unit-001';
const PR_ID = 'pr-svc-unit-001';

// Only db is accessed by SmartDiffService (to create ReviewRepository).
// Since we spy on the prototype, the actual db value is irrelevant.
const FAKE_CONTAINER = { db: null } as unknown as Container;

function stubPull(): PullRow {
  return {
    id: PR_ID,
    workspaceId: WORKSPACE_ID,
    repoId: 'repo-svc-unit-001',
    number: 1,
    title: 'Test PR',
    author: 'dev',
    branch: 'feat/test',
    base: 'main',
    headSha: 'abc123',
    lastReviewedSha: null,
    additions: 5,
    deletions: 2,
    filesCount: 1,
    status: 'needs_review',
    body: null,
    openedAt: null,
    updatedAt: null,
  } as unknown as PullRow;
}

function stubPrFile(path = 'src/service.ts') {
  return { id: 'pf-001', prId: PR_ID, path, additions: 5, deletions: 2, patch: null } as any;
}

function stubFinding(
  overrides: {
    id?: string;
    file?: string;
    startLine?: number;
    endLine?: number;
    severity?: string;
    dismissedAt?: Date | null;
  } = {},
): FindingRow {
  return {
    id: overrides.id ?? 'finding-svc-001',
    reviewId: 'review-svc-001',
    file: overrides.file ?? 'src/service.ts',
    startLine: overrides.startLine ?? 10,
    endLine: overrides.endLine ?? 10,
    severity: overrides.severity ?? 'WARNING',
    category: 'quality',
    title: 'Test finding',
    rationale: 'For unit test.',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: overrides.dismissedAt ?? null,
  } as unknown as FindingRow;
}

function stubReview(
  overrides: {
    id?: string;
    agentId?: string | null;
    kind?: 'review' | 'summary';
  } = {},
): ReviewRow {
  return {
    id: overrides.id ?? 'review-svc-001',
    workspaceId: WORKSPACE_ID,
    prId: PR_ID,
    agentId: overrides.agentId ?? null,
    runId: null,
    kind: overrides.kind ?? 'review',
    verdict: null,
    summary: null,
    score: null,
    model: null,
    createdAt: new Date('2024-01-01'),
  } as unknown as ReviewRow;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// end_line mapping
// ---------------------------------------------------------------------------

describe('SmartDiffService.get — end_line mapping', () => {
  it('sets end_line from finding.endLine for a single-line finding (endLine === startLine)', async () => {
    vi.spyOn(ReviewRepository.prototype, 'getPull').mockResolvedValue(stubPull());
    vi.spyOn(ReviewRepository.prototype, 'getPrFiles').mockResolvedValue([stubPrFile()]);
    vi.spyOn(ReviewRepository.prototype, 'reviewsForPull').mockResolvedValue([
      { review: stubReview(), findings: [stubFinding({ startLine: 10, endLine: 10 })] },
    ]);

    const service = new SmartDiffService(FAKE_CONTAINER);
    const result = await service.get(WORKSPACE_ID, PR_ID);

    const annotation = result.groups[0]!.files[0]!.finding_annotations[0]!;
    expect(annotation.line).toBe(10);
    expect(annotation.end_line).toBe(10);
  });

  it('sets end_line from finding.endLine for a multi-line finding (endLine > startLine)', async () => {
    vi.spyOn(ReviewRepository.prototype, 'getPull').mockResolvedValue(stubPull());
    vi.spyOn(ReviewRepository.prototype, 'getPrFiles').mockResolvedValue([stubPrFile()]);
    vi.spyOn(ReviewRepository.prototype, 'reviewsForPull').mockResolvedValue([
      { review: stubReview(), findings: [stubFinding({ startLine: 5, endLine: 15 })] },
    ]);

    const service = new SmartDiffService(FAKE_CONTAINER);
    const result = await service.get(WORKSPACE_ID, PR_ID);

    const annotation = result.groups[0]!.files[0]!.finding_annotations[0]!;
    expect(annotation.line).toBe(5);
    expect(annotation.end_line).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('SmartDiffService.get — error paths', () => {
  it('throws NotFoundError when the PR does not exist in the workspace', async () => {
    vi.spyOn(ReviewRepository.prototype, 'getPull').mockResolvedValue(undefined);

    const service = new SmartDiffService(FAKE_CONTAINER);
    await expect(service.get(WORKSPACE_ID, 'nonexistent-pr')).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Finding filters
// ---------------------------------------------------------------------------

describe('SmartDiffService.get — dismissed findings', () => {
  it('excludes dismissed findings from the returned annotations', async () => {
    vi.spyOn(ReviewRepository.prototype, 'getPull').mockResolvedValue(stubPull());
    vi.spyOn(ReviewRepository.prototype, 'getPrFiles').mockResolvedValue([stubPrFile()]);
    vi.spyOn(ReviewRepository.prototype, 'reviewsForPull').mockResolvedValue([
      {
        review: stubReview(),
        findings: [stubFinding({ dismissedAt: new Date('2024-06-01') })],
      },
    ]);

    const service = new SmartDiffService(FAKE_CONTAINER);
    const result = await service.get(WORKSPACE_ID, PR_ID);

    expect(result.groups[0]!.files[0]!.finding_annotations).toHaveLength(0);
  });

  it('includes a finding when dismissedAt is null', async () => {
    vi.spyOn(ReviewRepository.prototype, 'getPull').mockResolvedValue(stubPull());
    vi.spyOn(ReviewRepository.prototype, 'getPrFiles').mockResolvedValue([stubPrFile()]);
    vi.spyOn(ReviewRepository.prototype, 'reviewsForPull').mockResolvedValue([
      {
        review: stubReview(),
        findings: [stubFinding({ dismissedAt: null })],
      },
    ]);

    const service = new SmartDiffService(FAKE_CONTAINER);
    const result = await service.get(WORKSPACE_ID, PR_ID);

    expect(result.groups[0]!.files[0]!.finding_annotations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

describe('SmartDiffService.get — severity mapping', () => {
  it.each([
    ['CRITICAL', 'critical'],
    ['WARNING', 'warning'],
    ['SUGGESTION', 'suggestion'],
  ] as const)(
    'maps DB severity %s to annotation severity %s',
    async (dbSeverity, expectedSeverity) => {
      vi.spyOn(ReviewRepository.prototype, 'getPull').mockResolvedValue(stubPull());
      vi.spyOn(ReviewRepository.prototype, 'getPrFiles').mockResolvedValue([stubPrFile()]);
      vi.spyOn(ReviewRepository.prototype, 'reviewsForPull').mockResolvedValue([
        {
          review: stubReview(),
          findings: [stubFinding({ severity: dbSeverity })],
        },
      ]);

      const service = new SmartDiffService(FAKE_CONTAINER);
      const result = await service.get(WORKSPACE_ID, PR_ID);

      expect(result.groups[0]!.files[0]!.finding_annotations[0]!.severity).toBe(expectedSeverity);
    },
  );

  it('falls back to "suggestion" for an unrecognised DB severity', async () => {
    vi.spyOn(ReviewRepository.prototype, 'getPull').mockResolvedValue(stubPull());
    vi.spyOn(ReviewRepository.prototype, 'getPrFiles').mockResolvedValue([stubPrFile()]);
    vi.spyOn(ReviewRepository.prototype, 'reviewsForPull').mockResolvedValue([
      { review: stubReview(), findings: [stubFinding({ severity: 'UNKNOWN' })] },
    ]);

    const service = new SmartDiffService(FAKE_CONTAINER);
    const result = await service.get(WORKSPACE_ID, PR_ID);

    expect(result.groups[0]!.files[0]!.finding_annotations[0]!.severity).toBe('suggestion');
  });
});

// ---------------------------------------------------------------------------
// Review kind filter
// ---------------------------------------------------------------------------

describe('SmartDiffService.get — kind filter', () => {
  it('skips reviews of kind="summary" (only "review" kind is aggregated)', async () => {
    vi.spyOn(ReviewRepository.prototype, 'getPull').mockResolvedValue(stubPull());
    vi.spyOn(ReviewRepository.prototype, 'getPrFiles').mockResolvedValue([stubPrFile()]);
    vi.spyOn(ReviewRepository.prototype, 'reviewsForPull').mockResolvedValue([
      { review: stubReview({ kind: 'summary' }), findings: [stubFinding()] },
    ]);

    const service = new SmartDiffService(FAKE_CONTAINER);
    const result = await service.get(WORKSPACE_ID, PR_ID);

    expect(result.groups[0]!.files[0]!.finding_annotations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-agent dedup
// ---------------------------------------------------------------------------

describe('SmartDiffService.get — multi-agent dedup', () => {
  it('only takes findings from the first (newest) review per agentId', async () => {
    const agentId = 'agent-uuid-multi-001';
    const newerReview = stubReview({ id: 'review-newer', agentId });
    const olderReview = stubReview({ id: 'review-older', agentId });

    vi.spyOn(ReviewRepository.prototype, 'getPull').mockResolvedValue(stubPull());
    vi.spyOn(ReviewRepository.prototype, 'getPrFiles').mockResolvedValue([stubPrFile()]);
    // reviewsForPull returns newest-first — newerReview is processed first
    vi.spyOn(ReviewRepository.prototype, 'reviewsForPull').mockResolvedValue([
      { review: newerReview, findings: [stubFinding({ id: 'finding-newer', startLine: 5, endLine: 5 })] },
      { review: olderReview, findings: [stubFinding({ id: 'finding-older', startLine: 99, endLine: 99 })] },
    ]);

    const service = new SmartDiffService(FAKE_CONTAINER);
    const result = await service.get(WORKSPACE_ID, PR_ID);

    const annotations = result.groups[0]!.files[0]!.finding_annotations;
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.finding_id).toBe('finding-newer');
    expect(annotations[0]!.line).toBe(5);
  });

  it('aggregates findings from two different agentIds (both newest reviews included)', async () => {
    const agentA = 'agent-a';
    const agentB = 'agent-b';

    vi.spyOn(ReviewRepository.prototype, 'getPull').mockResolvedValue(stubPull());
    vi.spyOn(ReviewRepository.prototype, 'getPrFiles').mockResolvedValue([stubPrFile()]);
    vi.spyOn(ReviewRepository.prototype, 'reviewsForPull').mockResolvedValue([
      { review: stubReview({ id: 'rv-a', agentId: agentA }), findings: [stubFinding({ id: 'fa', startLine: 10, endLine: 10 })] },
      { review: stubReview({ id: 'rv-b', agentId: agentB }), findings: [stubFinding({ id: 'fb', startLine: 20, endLine: 20 })] },
    ]);

    const service = new SmartDiffService(FAKE_CONTAINER);
    const result = await service.get(WORKSPACE_ID, PR_ID);

    const annotations = result.groups[0]!.files[0]!.finding_annotations;
    expect(annotations).toHaveLength(2);
    const ids = annotations.map((a) => a.finding_id).sort();
    expect(ids).toEqual(['fa', 'fb']);
  });

  it('handles legacy reviews with null agentId — collapses to a single bucket', async () => {
    vi.spyOn(ReviewRepository.prototype, 'getPull').mockResolvedValue(stubPull());
    vi.spyOn(ReviewRepository.prototype, 'getPrFiles').mockResolvedValue([stubPrFile()]);
    vi.spyOn(ReviewRepository.prototype, 'reviewsForPull').mockResolvedValue([
      { review: stubReview({ id: 'rv-1', agentId: null }), findings: [stubFinding({ id: 'f1', startLine: 10, endLine: 10 })] },
      { review: stubReview({ id: 'rv-2', agentId: null }), findings: [stubFinding({ id: 'f2', startLine: 20, endLine: 20 })] },
    ]);

    const service = new SmartDiffService(FAKE_CONTAINER);
    const result = await service.get(WORKSPACE_ID, PR_ID);

    // Both reviews share agentKey='null', so only the first (rv-1) is used.
    const annotations = result.groups[0]!.files[0]!.finding_annotations;
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.finding_id).toBe('f1');
  });
});
