# next-best-practices eval results (2026-07-05)

5 trials/eval, 3 eval cases, 14 expectations total. Overall pass rate: **13/14 = 0.93** initially; **14/14 = 1.0** after the F7 fixture fix + 2-trial spot-check (2026-07-06, see below).

## Eval 0 — insights-page-clear-violations (sync params, client hook w/o directive, client-side secret)

| Exp | Check | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | sync `params` not `Promise<...>`/awaited | 5/5 | PASS |
| F2 | `useSearchParams()` w/o `'use client'` | 5/5 | PASS |
| F3 | `GITHUB_TOKEN` read in `'use client'` module | 5/5 | PASS |
| F4 | fixes are correct/concrete | 5/5 | PASS |

## Eval 1 — finding-detail-precision-trap (5 subtle bugs + 2 clean pieces)

| Exp | Check | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | `generateMetadata` casts instead of awaiting `params` | 5/5 | PASS |
| F2 | sequential fetch waterfall vs `Promise.all` | 5/5 | PASS |
| F3 | `Date` prop passed to client component | 5/5 | PASS |
| F4 | plain function prop crosses RSC boundary | 5/5 | PASS |
| F5 | async `'use client'` component | 5/5 | PASS |
| F6 | precision: `cache()` wrapper not flagged | 5/5 | PASS |
| F7 | precision: `<Image>` usage not flagged | ~~0/5~~ **(fixed) 2/2** | ~~FIXTURE_ISSUE~~ **PASS** |

## Eval 2 — finding-actions-missing-revalidation (Server Action skips revalidation)

| Exp | Check | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | missing `revalidatePath` in `acknowledgeFinding` | 5/5 | PASS |
| F2 | fix mirrors `dismissFinding`'s revalidation | 5/5 | PASS |
| F3 | precision: `dismissFinding` not falsely flagged | 5/5 | PASS |

## Findings

- **SKILL_GAP: none found.** Every genuine violation across all 3 cases (async params in both pages and `generateMetadata`, client-hook/RSC boundary breaks, non-serializable props, async client components, secrets-in-client-code, missing Server Action revalidation) was caught 5/5 by independent trials, each grounded in the correct reference doc (async-patterns.md, rsc-boundaries.md, data-patterns.md, bundling.md).
- **FIXTURE_ISSUE (1): Eval 1 / F7 — FIXED 2026-07-06.** The fixture's "correct, don't churn" `<Image>` usage included `priority` on a 48x48 avatar. Every trial reasonably flagged `priority` as a probable LCP-hint misuse (per the skill's own image.md guidance), which is defensible reviewer behavior, not a false positive from a skill defect. Fix applied: dropped `priority` from the avatar `<Image>` in `evals/files/finding-detail/page.tsx` (this fixture had no genuine hero/LCP image to relocate it to). `evals.json`'s F7 expectation text updated to match. Spot-checked with 2 independent trials (not a full 5-trial rerun): both trials left the `<Image>` usage unflagged and both still caught all 5 real violations (F1-F5) plus the other precision check (F6). No further skill change needed — this confirms the skill's guidance was correct all along and the fixture was the only defect.
- No FLAKY diagnoses were needed — all misses were consistent across all 5 trials (deterministic, not noise), pointing to the fixture design rather than model variance.

## Note on run reliability

Several sub-agent calls (~7 of 20 total dispatch attempts) hit transient "model temporarily unavailable" errors during dispatch and were retried until each eval case had a full 5 completed trials; this did not affect grading, only wall-clock time.
