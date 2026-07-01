import { rollupSeverities } from '@devdigest/api/modules/pulls/status.js';
import type { ReviewDto, ReviewDtoFinding } from '@devdigest/api/modules/reviews/helpers.js';
import type { BlastResponse } from '@devdigest/api/modules/blast/types.js';
import type { Severity } from '@devdigest/shared';
import { McpToolError } from './errors.js';
import type { FindingOut, SeveritySummary, BlastRadiusOut } from './schemas.js';

/** Cap on findings inlined by devdigest_review_pr (token efficiency). */
export const REVIEW_PR_FINDINGS_CAP = 50;

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/** Project a stored finding into the wire shape (concise vs detailed). */
export function projectFinding(f: ReviewDtoFinding, detailed: boolean): FindingOut {
  const base: FindingOut = {
    id: f.id,
    severity: f.severity,
    category: f.category,
    title: f.title,
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
  };
  if (!detailed) return base;
  return {
    ...base,
    rationale: f.rationale,
    suggestion: f.suggestion ?? null,
    confidence: f.confidence,
  };
}

/**
 * Project a server `BlastResponse` into the MCP wire shape (snake_cased,
 * `undefined`→`null`).
 *
 * When `symbolFilter` is set, keep only the changed symbol whose name matches
 * exactly and recompute `totals` + the impacted unions over the surviving groups
 * so the numbers stay internally consistent. A non-matching filter yields an
 * empty `symbols` list with zeroed totals — graceful, not an error ("no such
 * changed symbol / no callers" is a valid answer). When unfiltered, the server's
 * own faithful counts pass through verbatim (`totals.callers` is the pre-cap
 * facade count, not the sum of the capped per-symbol caller lists). `index`,
 * `degraded`, and `resolution` always reflect the real index state.
 */
export function projectBlast(
  prRef: string,
  response: BlastResponse,
  symbolFilter?: string,
): BlastRadiusOut {
  const groups = symbolFilter
    ? response.symbols.filter((s) => s.name === symbolFilter)
    : response.symbols;

  const symbols = groups.map((s) => ({
    file: s.file,
    name: s.name,
    kind: s.kind,
    callers: s.callers.map((c) => ({
      file: c.file,
      symbol: c.symbol,
      line: c.line,
      rank: c.rank,
    })),
    endpoints: s.endpoints,
    crons: s.crons,
  }));

  let totals: BlastRadiusOut['totals'];
  let impactedEndpoints: string[];
  let impactedCrons: string[];
  if (symbolFilter) {
    impactedEndpoints = [...new Set(groups.flatMap((s) => s.endpoints))];
    impactedCrons = [...new Set(groups.flatMap((s) => s.crons))];
    totals = {
      symbols: groups.length,
      callers: groups.reduce((n, s) => n + s.callers.length, 0),
      endpoints: impactedEndpoints.length,
      crons: impactedCrons.length,
    };
  } else {
    impactedEndpoints = response.impactedEndpoints;
    impactedCrons = response.impactedCrons;
    totals = response.totals;
  }

  return {
    pr: prRef,
    symbol: symbolFilter ?? null,
    symbols,
    totals,
    impacted_endpoints: impactedEndpoints,
    impacted_crons: impactedCrons,
    index: {
      status: response.index.status,
      degraded: response.index.degraded,
      reason: response.index.reason ?? null,
      last_indexed_sha: response.index.lastIndexedSha,
    },
    degraded: response.degraded,
    reason: response.reason ?? null,
    resolution: {
      limited: response.resolution.limited,
      reason: response.resolution.reason ?? null,
    },
  };
}

/** Severity rollup + blockers (= CRITICAL count, matching the run gate). */
export function summarize(findings: { severity: string }[]): SeveritySummary {
  const c = rollupSeverities(findings);
  return {
    critical: c.critical,
    warning: c.warning,
    suggestion: c.suggestion,
    total: c.critical + c.warning + c.suggestion,
    blockers: c.critical,
  };
}

/** Stable ordering for pagination: severity, then file, then start line. */
export function sortFindings(findings: ReviewDtoFinding[]): ReviewDtoFinding[] {
  return [...findings].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] ?? 99;
    const sb = SEVERITY_RANK[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.start_line - b.start_line;
  });
}

export interface FindingFilter {
  agentId?: string | null;
  severity?: Severity;
  category?: string;
  file?: string;
  includeDismissed?: boolean;
  allRuns?: boolean;
}

/**
 * Select findings from a PR's reviews, applying all filters server-side.
 *
 * `reviewsForPull` returns EVERY review (newest first) WITH dismissed findings
 * included, so we must: (a) keep only `kind === 'review'` rows; (b) optionally
 * restrict to one agent (findings have no agent column — attribution is the
 * review's `agent_id`); (c) by default keep only the newest review PER agent so a
 * re-run doesn't surface stale duplicates; (d) drop dismissed findings unless
 * asked; (e) apply severity/category/file filters. Returns a stable-sorted list.
 */
export function selectFindings(reviews: ReviewDto[], filter: FindingFilter): ReviewDtoFinding[] {
  const seenAgents = new Set<string>();
  const out: ReviewDtoFinding[] = [];

  for (const review of reviews) {
    if (review.kind !== 'review') continue;
    if (filter.agentId != null && review.agent_id !== filter.agentId) continue;

    // Newest-per-agent dedupe (reviews are newest-first) unless all_runs.
    if (!filter.allRuns) {
      const key = review.agent_id ?? 'null';
      if (seenAgents.has(key)) continue;
      seenAgents.add(key);
    }

    for (const f of review.findings) {
      if (!filter.includeDismissed && f.dismissed_at != null) continue;
      if (filter.severity && f.severity !== filter.severity) continue;
      if (filter.category && f.category !== filter.category) continue;
      if (filter.file && f.file !== filter.file) continue;
      out.push(f);
    }
  }
  return sortFindings(out);
}

// ---- pagination (stateless base64 cursor over an offset) -------------------

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64');
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    const offset = (parsed as { offset?: unknown }).offset;
    if (typeof offset === 'number' && Number.isInteger(offset) && offset >= 0) return offset;
  } catch {
    /* fall through to the actionable error */
  }
  throw new McpToolError('Invalid pagination cursor. Omit `cursor` to start from the first page.');
}

export interface Page<T> {
  items: T[];
  total: number;
  returned: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/** Slice `items` from a cursor offset by `limit`, computing page metadata. */
export function paginate<T>(items: T[], limit: number, cursor: string | undefined): Page<T> {
  const offset = decodeCursor(cursor);
  const slice = items.slice(offset, offset + limit);
  const hasMore = offset + limit < items.length;
  return {
    items: slice,
    total: items.length,
    returned: slice.length,
    hasMore,
    nextCursor: hasMore ? encodeCursor(offset + limit) : null,
  };
}
