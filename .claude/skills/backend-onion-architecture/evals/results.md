# backend-onion-architecture skill — eval results

Run date: 2026-07-06 · 5 trials/eval · 2 evals · 14 expectations total · **overall pass rate: 100% (70/70 trial-checks)**

## Eval 0 — webhooks-clear-violations

| Exp | Check | Pass/5 | Diagnosis |
|---|---|---|---|
| F1 | `routes.ts` queries Drizzle directly in the route handler (presentation -> infra skip) | 5/5 | PASS |
| F2 | Endpoint-URL uniqueness check is business logic misplaced in the route handler | 5/5 | PASS |
| F3 | `claimDueRetries` backoff/`MAX_ATTEMPTS` logic is a domain rule embedded in the repository | 5/5 | PASS |
| F4 | Repository methods return raw Drizzle rows outward, no `toDomain()` mapping | 5/5 | PASS |
| F5 | `service.ts` constructs a concrete OpenAI client directly instead of via the LLMProvider port/container | 5/5 | PASS |

## Eval 1 — digest-schedules-hard

| Exp | Check | Pass/5 | Diagnosis |
|---|---|---|---|
| F1 | `/preview` handler queries Drizzle directly, bypassing service/repository | 5/5 | PASS |
| F2 | `assertValidCronOverride` (5-min-interval rule) is domain logic embedded in `routes.ts` | 5/5 | PASS |
| F3 | `helpers.ts` (domain layer) imports `InferSelectModel`/schema types, coupling domain to DB row shape | 5/5 | PASS |
| F4 | `helpers.ts`'s `shouldSkipDueToRateLimit` constructs `GithubClient` directly from the domain layer | 5/5 | PASS |
| F5 | `service.ts` instantiates `WorkspaceRepository` directly instead of via a port -- cross-module reach-in | 5/5 | PASS |
| F6 | `service.ts`'s `runDueSchedules` does a raw `fetch()` to GitHub with `process.env.GITHUB_TOKEN` instead of using `GithubClient` | 5/5 | PASS |
| F7 | Module-level mutable `rateLimitCache` in `service.ts` is ad-hoc shared state bypassing the DI container | 5/5 | PASS |
| F8 | `repository.ts`'s `computeNextRunAt`/`claimDueSchedules` embed scheduling business rules in infra, plus return raw rows with no mapping | 5/5 | PASS |
| F9 | (precision check) `github-client.ts` is NOT flagged -- it's a correctly scoped infra adapter | 5/5 | PASS |

## Summary

- **No SKILL_GAP findings.** SKILL.md's coverage of the inward-only dependency rule, DB access confined to infrastructure, repository row->domain mapping, business rules kept out of infra/presentation, and DI via the composition root was sufficient for every probed scenario, including the "hard" digest-schedules fixture's cross-module boundary violation (`WorkspaceRepository` reach-in) and the type-only `InferSelectModel` trap that `dependency-cruiser` itself can't catch at runtime.
- **No FIXTURE_ISSUE findings** that affected correctness. Every expectation was unambiguously checkable and every trial converged on the intended violation/non-violation, including the precision check (`github-client.ts` correctly left unflagged in all 5 trials of eval 1).
- **Caveat (not scored as a gap):** for F2 and F8, a handful of trials folded the expected finding into the writeup of an adjacent violation instead of numbering it separately (e.g. the uniqueness check discussed inline with the DB-access fix). The substance of the finding and its prescribed fix were present in every trial regardless of how it was organized on the page -- this is a formatting/grouping variance in how reviewers structure a PR comment, not a missed violation.
- This run was triggered by a same-day rewrite of the skill's `SKILL.md`, `examples.md`, `references/domain-layer.md`, `CHANGELOG.md`, and `tile.json` -- results confirm the updated skill content still drives fully correct, precise reviews on both the clear-cut and harder/precision-trap fixtures.
