# typescript-expert eval results

Run: 2026-07-05 | 3 eval cases x 5 trials = 15 executor runs | 15 expectations, 75 expectation-trials

**Overall pass rate: 65/75 = 86.7%**
**Skill gaps found: 0** | **Fixture issues found: 3** | **Flaky: 0**

## Eval 0 — any-laden-classifier (clear-cut: any, unchecked `as`, non-exhaustive switch)

| Exp | Text | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | Flags `classifyFinding(any): any` with a concrete fix | 5/5 | PASS |
| F2 | Flags unvalidated `as ReviewFinding[]` cast | 5/5 | PASS |
| F3 | Flags non-exhaustive `severityLabel` switch | 5/5 | PASS |
| F4 | (precision) Doesn't flag `sortByPriority` | 0/5 | **FIXTURE_ISSUE** |

F4: the "clean" distractor (`rank` built with `as const`) isn't actually inert — its keys only coincidentally match `FindingSeverity`, so every trial legitimately suggested locking it to `Record<FindingSeverity, number>`. Not a skill flaw; the fixture needed a truly untouchable clean example.

## Eval 1 — finding-normalizer-mixed-violations (hard precision trap)

| Exp | Text | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | Flags unvalidated `toFindingId` brand | 5/5 | PASS |
| F2 | Flags loose `pickIds<T extends {id: unknown}>` constraint | 5/5 | PASS |
| F3 | Flags unchecked `loadConfig` cast | 5/5 | PASS |
| F4 | Flags `any`-cast default instead of `never` check | 5/5 | PASS |
| F5 | (precision) Doesn't flag `toUserId` | 5/5 | PASS |
| F6 | (precision) Doesn't flag `firstOf<T>` | 5/5 | PASS |

Clean sweep — no gaps or fixture issues. This is the strongest signal that the skill's type-safety checklist (branded types, generic constraints, exhaustiveness, JSON boundary validation) works well in practice.

## Eval 2 — distributive-conditional-and-barrel-cycle (uncommon scenario)

| Exp | Text | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | Flags `EventHandler<T>` as an unintentionally distributive conditional | 5/5 | PASS |
| F2 | Explains dispatch silently type-checks while under-handling variants | 2/5 | **FIXTURE_ISSUE (fixed)** |
| F3 | Identifies/proposes the tuple-wrap non-distributive fix | 5/5 | PASS |
| F4 | Flags barrel-to-barrel circular re-export | 3/5 | **FIXTURE_ISSUE (fixed)** |
| F5 | (precision) Doesn't flag `NonDistributiveHandler`/`safeDispatch` | 5/5 | PASS |

F2 (fixed 2026-07-06): originally, 2 trials actually ran `tsc --strict` against the fixture and found the literal `dispatch` assignment failed with `TS7006` (implicit any) rather than silently type-checking — the distributive union of call signatures didn't get clean contextual typing under `noImplicitAny`. **Fix**: `dispatch`'s parameter now has an explicit narrow annotation (`{ kind: 'finding-added'; findingId: string }`) instead of relying on contextual inference, sidestepping the TS7006 failure while preserving the intended lesson. Verified with `tsc --strict --noEmit`: 0 errors. **Spot-check**: 2/2 fresh agents (given only the skill + fixture, not told about the fix) independently ran `tsc` and confirmed the assignment now compiles cleanly, and both correctly explained the union-of-single-arm-handlers mechanism. One trial additionally noted (independently confirmed) that calling `dispatch` with a broad `ReviewEvent` argument elsewhere still fails at the call site (TS2345) — a refinement, not a contradiction, of the expectation.

F4 (fixed 2026-07-06): originally, `reviewers/index.ts` re-exported from the concrete `findings/finding.ts` leaf file, not from `findings/index.ts`'s barrel, so there was no literal file-level back-edge (2 trials correctly caught this and called it a one-way dependency/DAG). **Fix**: `reviewers/index.ts` now re-exports `Finding` from `../findings/index.js` (the sibling barrel) instead of the leaf file, creating a genuine two-file cycle: `findings/index.ts -> reviewers/index.ts -> findings/index.ts`. Confirmed by tracing both files' import specifiers and by `tsc --strict --noEmit` over the full fixture set (0 errors). **Spot-check**: 2/2 fresh agents both correctly identified this as a true barrel-to-barrel cycle (explicitly distinguishing it from a one-way/DAG dependency) and explained the incremental-build/TDZ-risk consequences. One trial also surfaced a genuine bonus issue: the fixed re-export line is a real `tsc` error under `verbatimModuleSyntax: true` (needs `export type { Finding }`), not previously called out.

## Bottom line

No SKILL_GAP findings — `typescript-expert`'s checklist (any/unknown, assertion justification, generic constraints, exhaustive discriminated unions, branded-type validation, JSON-boundary validation) reliably triggers correct, well-reasoned findings across clear-cut and hard-mixed scenarios. Of the 3 original fixture issues, 2 (eval2/F2, eval2/F4) were fixed and spot-check verified on 2026-07-06 — the fixture's actual TS semantics now match the intended narrative in both cases (confirmed via direct `tsc --strict` runs, not just the spot-check agents' word). eval0/F4 (the imperfect "clean" `sortByPriority` distractor) remains unfixed. None of these say anything negative about the skill itself.
