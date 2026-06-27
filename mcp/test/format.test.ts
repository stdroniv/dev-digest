import { describe, it, expect } from 'vitest';
import type { ReviewDto, ReviewDtoFinding } from '@devdigest/api/modules/reviews/helpers.js';
import {
  projectFinding,
  summarize,
  sortFindings,
  selectFindings,
  encodeCursor,
  decodeCursor,
  paginate,
} from '../src/format.js';
import { McpToolError } from '../src/errors.js';

function finding(over: Partial<ReviewDtoFinding> = {}): ReviewDtoFinding {
  return {
    id: over.id ?? 'f1',
    severity: over.severity ?? 'CRITICAL',
    category: over.category ?? 'security',
    title: over.title ?? 'A finding',
    file: over.file ?? 'src/a.ts',
    start_line: over.start_line ?? 10,
    end_line: over.end_line ?? 10,
    rationale: over.rationale ?? 'because',
    suggestion: over.suggestion !== undefined ? over.suggestion : 'fix it',
    confidence: over.confidence ?? 0.9,
    kind: over.kind ?? 'finding',
    trifecta_components: over.trifecta_components ?? null,
    evidence: over.evidence ?? null,
    review_id: over.review_id ?? 'r1',
    accepted_at: over.accepted_at ?? null,
    dismissed_at: over.dismissed_at ?? null,
  };
}

function review(over: Partial<ReviewDto> = {}): ReviewDto {
  return {
    id: over.id ?? 'r1',
    pr_id: over.pr_id ?? 'pr1',
    agent_id: over.agent_id ?? 'a1',
    run_id: over.run_id ?? 'run1',
    agent_name: over.agent_name ?? 'Agent',
    kind: over.kind ?? 'review',
    verdict: over.verdict ?? 'request_changes',
    summary: over.summary ?? null,
    score: over.score ?? 50,
    model: over.model ?? 'm',
    created_at: over.created_at ?? '2026-06-01T00:00:00Z',
    findings: over.findings ?? [],
  };
}

describe('projectFinding', () => {
  it('concise omits rationale/suggestion/confidence', () => {
    const out = projectFinding(finding(), false);
    expect(out).toEqual({
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'A finding',
      file: 'src/a.ts',
      start_line: 10,
      end_line: 10,
    });
    expect('rationale' in out).toBe(false);
  });

  it('detailed adds rationale/suggestion/confidence', () => {
    const out = projectFinding(finding({ suggestion: null }), true);
    expect(out.rationale).toBe('because');
    expect(out.suggestion).toBeNull();
    expect(out.confidence).toBe(0.9);
  });
});

describe('summarize', () => {
  it('counts per-severity, total, and blockers (= critical)', () => {
    const s = summarize([
      { severity: 'CRITICAL' },
      { severity: 'CRITICAL' },
      { severity: 'WARNING' },
      { severity: 'SUGGESTION' },
    ]);
    expect(s).toEqual({ critical: 2, warning: 1, suggestion: 1, total: 4, blockers: 2 });
  });
});

describe('sortFindings', () => {
  it('orders by severity, then file, then start line', () => {
    const sorted = sortFindings([
      finding({ id: 's', severity: 'SUGGESTION', file: 'a', start_line: 1 }),
      finding({ id: 'c2', severity: 'CRITICAL', file: 'b', start_line: 5 }),
      finding({ id: 'c1', severity: 'CRITICAL', file: 'a', start_line: 9 }),
      finding({ id: 'w', severity: 'WARNING', file: 'a', start_line: 1 }),
    ]);
    expect(sorted.map((f) => f.id)).toEqual(['c1', 'c2', 'w', 's']);
  });
});

describe('selectFindings', () => {
  it('drops dismissed findings unless include_dismissed', () => {
    const reviews = [
      review({
        findings: [finding({ id: 'keep' }), finding({ id: 'gone', dismissed_at: '2026-06-01T00:00:00Z' })],
      }),
    ];
    expect(selectFindings(reviews, {}).map((f) => f.id)).toEqual(['keep']);
    expect(
      selectFindings(reviews, { includeDismissed: true }).map((f) => f.id).sort(),
    ).toEqual(['gone', 'keep']);
  });

  it('keeps only the newest review per agent by default; all_runs keeps history', () => {
    const reviews = [
      review({ id: 'new', agent_id: 'a1', findings: [finding({ id: 'newF' })] }),
      review({ id: 'old', agent_id: 'a1', findings: [finding({ id: 'oldF' })] }),
    ];
    expect(selectFindings(reviews, {}).map((f) => f.id)).toEqual(['newF']);
    expect(selectFindings(reviews, { allRuns: true }).map((f) => f.id).sort()).toEqual([
      'newF',
      'oldF',
    ]);
  });

  it('filters by agent, severity, category, and file', () => {
    const reviews = [
      review({
        id: 'r-a',
        agent_id: 'a1',
        findings: [
          finding({ id: 'c', severity: 'CRITICAL', category: 'security', file: 'x.ts' }),
          finding({ id: 'w', severity: 'WARNING', category: 'perf', file: 'y.ts' }),
        ],
      }),
      review({ id: 'r-b', agent_id: 'a2', findings: [finding({ id: 'other' })] }),
    ];
    expect(selectFindings(reviews, { agentId: 'a1' }).map((f) => f.id).sort()).toEqual(['c', 'w']);
    expect(selectFindings(reviews, { severity: 'WARNING' }).map((f) => f.id)).toEqual(['w']);
    expect(selectFindings(reviews, { category: 'perf' }).map((f) => f.id)).toEqual(['w']);
    expect(selectFindings(reviews, { file: 'x.ts' }).map((f) => f.id)).toEqual(['c']);
  });

  it('ignores non-review kinds', () => {
    const reviews = [review({ kind: 'summary', findings: [finding({ id: 'nope' })] })];
    expect(selectFindings(reviews, {})).toEqual([]);
  });
});

describe('pagination', () => {
  it('round-trips a cursor', () => {
    expect(decodeCursor(encodeCursor(40))).toBe(40);
    expect(decodeCursor(undefined)).toBe(0);
  });

  it('rejects a malformed cursor with an actionable error', () => {
    expect(() => decodeCursor('not-base64-json')).toThrow(McpToolError);
  });

  it('paginates with has_more / next_cursor', () => {
    const items = Array.from({ length: 5 }, (_, i) => i);
    const p1 = paginate(items, 2, undefined);
    expect(p1.items).toEqual([0, 1]);
    expect(p1.total).toBe(5);
    expect(p1.returned).toBe(2);
    expect(p1.hasMore).toBe(true);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = paginate(items, 2, p1.nextCursor!);
    expect(p2.items).toEqual([2, 3]);
    expect(p2.hasMore).toBe(true);

    const p3 = paginate(items, 2, p2.nextCursor!);
    expect(p3.items).toEqual([4]);
    expect(p3.hasMore).toBe(false);
    expect(p3.nextCursor).toBeNull();
  });
});
