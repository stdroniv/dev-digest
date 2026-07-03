import { WhyRiskBrief } from '@devdigest/shared';

/**
 * Why+Risk Brief grounding gate (SPEC-03).
 *
 * The model returns `refs`/`review_focus` by GUESS — this filter is the mandatory
 * mechanical gate that keeps only references that actually exist in the PR:
 *   - a `kind:'file'` ref is grounded only if its `value` is a real changed file.
 *   - a `kind:'endpoint'` ref is grounded only if its `value` is a real
 *     blast-impacted endpoint.
 *   - a `review_focus` item is grounded only if its `path` is a real changed file.
 *
 * REMOVAL ONLY — this never reorders `risks`/`review_focus`. Reviewer-priority
 * ordering (core-group + higher blast-impact first) is decided by the generator's
 * prompt; grounding must preserve whatever order it returned.
 */

export interface WhyRiskOracle {
  changedFiles: Set<string>;
  impactedEndpoints: Set<string>;
}

/**
 * Drop ungrounded refs from every risk, drop risks left with zero refs, and drop
 * review-focus items whose path isn't a real changed file. Order-preserving.
 */
export function groundBriefRefs(brief: WhyRiskBrief, oracle: WhyRiskOracle): WhyRiskBrief {
  const risks = brief.risks
    .map((risk) => ({
      ...risk,
      refs: risk.refs.filter((ref) =>
        ref.kind === 'file'
          ? oracle.changedFiles.has(ref.value)
          : oracle.impactedEndpoints.has(ref.value)
      ),
    }))
    .filter((risk) => risk.refs.length > 0);

  const review_focus = brief.review_focus.filter((item) => oracle.changedFiles.has(item.path));

  return {
    ...brief,
    risks,
    review_focus,
  };
}
