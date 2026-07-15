/**
 * Path normalisation for the eval scorer's match rule.
 *
 * Re-exported from the shared kernel (`modules/_shared/finding-match.ts`) —
 * lifted there so `multi-agent-review`'s disagreement grouping can reuse the
 * same pure logic without depending on the `eval` module. No behavior change.
 */
export { normalizePath } from '../../_shared/finding-match.js';
