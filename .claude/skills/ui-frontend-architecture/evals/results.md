# ui-frontend-architecture eval results

Run date: 2026-07-05 · 5 trials/eval · 3 evals, 11 expectations total.

## Summary

| Eval | Expectations | Pass rate |
|---|---|---|
| 0 cross-route-deep-import (clear-cut) | F1, F2 | 5/5 each |
| 1 notifications-panel (hard / precision) | F1–F6 | 5/5 each |
| 2 barrel-cycle (uncommon scenario) | F1–F3 | 5/5 each |

**Overall: 11/11 expectations, 55/55 trial-checks passed (100%).**
**SKILL_GAP findings: 0. FIXTURE_ISSUE findings: 0.**

## Detail

### Eval 0 — cross-route-deep-import
| Exp | Pass | Notes |
|---|---|---|
| F1 (deep import of SkillBadge across routes) | 5/5 | All named promotion to `src/components/` or page-level composition |
| F2 (shared `lib/` importing feature hook) | 5/5 | All caught the inversion; several also flagged the hook-in-a-helpers-file mixing |

### Eval 1 — notifications-panel
| Exp | Pass | Notes |
|---|---|---|
| F1 (fetch() bypasses lib/hooks -> lib/api.ts) | 5/5 | |
| F2 (inline filter/sort as business logic) | 5/5 | |
| F3 (`useFormatTimestamp` misnamed) | 5/5 | |
| F4 (duplicated `Notification` type) | 5/5 | |
| F5 (precision: page.tsx not flagged) | 5/5 | |
| F6 (precision: NotificationBadge.tsx not flagged) | 5/5 | |

### Eval 2 — barrel-cycle
| Exp | Pass | Notes |
|---|---|---|
| F1 (in-folder barrels violate repo convention) | 5/5 | |
| F2 (cross-route imports violate feature isolation) | 5/5 | |
| F3 (circular dependency across both barrels, invisible per-file) | 5/5 | All traced the full 4-hop cycle unprompted |

## Conclusion

No SKILL_GAP or FIXTURE_ISSUE diagnoses were needed — every expectation passed in every trial. The skill's core-principles table, dependency-rule wording, and `this-repo.md` adaptation are specific enough that Sonnet 5 consistently located the violation, named the correct target location, and avoided false-positiving the two intentionally-clean files in the precision-trap case. The fixtures (single/dual violation, 5-file precision trap, cross-file hidden-cycle) all discriminated cleanly at this model tier.
