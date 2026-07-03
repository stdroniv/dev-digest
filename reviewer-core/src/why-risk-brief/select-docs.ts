import { ProjectDocument } from '@devdigest/shared';

/**
 * Deterministic Context-doc budget selector for the Why+Risk Brief (SPEC-03).
 *
 * Context docs can exceed what's worth spending on a single advisory pass, so
 * this greedily fills a fixed token budget under a DOCUMENTED, TOTAL ordering —
 * same PR + repo state (same doc set) always yields the same selection,
 * regardless of the input array's order (AC-23):
 *
 *   1. root priority: 'specs' > 'docs' > 'insights' (any other root sorts last,
 *      ties among unknown roots broken by the later keys below).
 *   2. `tokens` ascending (cheapest docs first — fits more docs per budget).
 *   3. `path` ascending (final tie-break so identical inputs always produce an
 *      identical order, even when root + tokens both tie).
 *
 * The selector only decides WHICH docs to read — it never reads file content
 * itself (the caller reads content for the selected subset only).
 */

/** Default per-generation Context-doc token budget for the Why+Risk Brief. */
export const WHY_RISK_BRIEF_DOC_BUDGET_TOKENS = 4000;

const ROOT_PRIORITY: Record<string, number> = {
  specs: 0,
  docs: 1,
  insights: 2,
};

/** Lower sorts first. Unknown roots sort after every known root. */
function rootRank(root: string): number {
  return ROOT_PRIORITY[root] ?? Object.keys(ROOT_PRIORITY).length;
}

function compareDocs(a: ProjectDocument, b: ProjectDocument): number {
  const rootDelta = rootRank(a.root) - rootRank(b.root);
  if (rootDelta !== 0) return rootDelta;

  const tokensDelta = a.tokens - b.tokens;
  if (tokensDelta !== 0) return tokensDelta;

  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

export interface SelectContextDocsResult {
  selected: ProjectDocument[];
  truncated: boolean;
}

/**
 * Sort docs by the total ordering above, then greedily fill `budgetTokens`.
 * `truncated` is true iff at least one doc was excluded to stay in budget.
 */
export function selectContextDocs(
  docs: ProjectDocument[],
  budgetTokens: number
): SelectContextDocsResult {
  const ordered = [...docs].sort(compareDocs);

  const selected: ProjectDocument[] = [];
  let used = 0;
  let truncated = false;

  for (const doc of ordered) {
    if (used + doc.tokens > budgetTokens) {
      truncated = true;
      continue;
    }
    selected.push(doc);
    used += doc.tokens;
  }

  return { selected, truncated };
}
