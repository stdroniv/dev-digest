# Zod skill — eval results

Run date: 2026-07-05 · 5 trials/eval · 3 evals · 12 expectations total · **overall pass rate: 100% (60/60 trial-checks)**

## Eval 0 — pr-findings-submit-clear-cut

| Exp | Check | Pass/5 | Diagnosis |
|---|---|---|---|
| F1 | `.parse()` in route handler flagged, `safeParse()`+400 recommended | 5/5 | PASS |
| F2 | Manual `ReviewFinding` interface flagged as z.infer duplicate, drift (missing `confidence`) caught | 5/5 | PASS |
| F3 | `mergedAt` `.optional()` vs `.nullable()` mismatch flagged | 5/5 | PASS |

## Eval 1 — repo-intel-schemas-precision-trap

| Exp | Check | Pass/5 | Diagnosis |
|---|---|---|---|
| F1 | `.refine()` throwing instead of returning false | 5/5 | PASS |
| F2 | `metadata: z.any()` → `z.unknown()` | 5/5 | PASS |
| F3 | `severity: z.string()` → `z.enum(...)` | 5/5 | PASS |
| F4 | `reviewRequestSchema` optional-abuse on `repoId`/`prNumber` | 5/5 | PASS |
| F5 | Manual `ReviewResult` interface drift (missing `confidence`) | 5/5 | PASS |
| F6 | Precision check: `digestPreferenceSchema` NOT flagged | 5/5 | PASS |

## Eval 2 — llm-provider-config-uncommon

| Exp | Check | Pass/5 | Diagnosis |
|---|---|---|---|
| F1 | Discriminated union missing `'openrouter'` variant | 5/5 | PASS |
| F2 | `.transform()` silently widens output type, undermines `.min(1)` | 5/5 | PASS |
| F3 | Concrete fix recommended (not just symptom-naming) | 5/5 | PASS |

## Summary

- **No SKILL_GAP findings.** SKILL.md's coverage of safeParse, z.infer, optional/nullable, discriminated unions, refine-vs-throw, z.any()/z.unknown(), optional-abuse, and transform/type-input-vs-output was sufficient for every probed scenario, including the two "uncommon scenario" traps (missing union variant, transform narrowing the output type).
- **No FIXTURE_ISSUE findings.** Every expectation was unambiguously checkable and every trial converged on the intended violation/non-violation.
- **Caveat (not scored as a gap):** all 12 expectations hit 5/5 across every eval, including the precision-trap's clean schema (F6). The fixtures lean on explanatory in-file comments (e.g. "accepts any string today", "keep in sync", the DB-column comment on `mergedAt`, the `@ts-expect-error` note on `openrouter`) that double as strong hints. This makes the fixtures a reliable regression check but a relatively easy one — a future harder pass could strip those comments to test whether the skill still catches the same violations from code shape alone, without narrative hints.
