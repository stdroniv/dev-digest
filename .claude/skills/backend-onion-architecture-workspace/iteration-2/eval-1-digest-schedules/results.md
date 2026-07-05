# backend-onion-architecture — eval 1 (digest-schedules), 5-run variance check

Each run: fresh subagent, skill loaded via the Skill tool, same prompt, same 5 fixture files.
Graded against the 9 expectations in `evals/evals.json` (F1–F9).

## Per-run scoring

| Expectation | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 |
|---|---|---|---|---|---|
| F1 — routes.ts `/preview` direct DB query | ✅ | ✅ | ✅ | ✅ | ✅ |
| F2 — cron-override business rule in route handler | ✅ | ✅ | ✅ | ✅ | ✅ |
| F3 — helpers.ts `InferSelectModel`/Drizzle-coupled "domain" type | ✅ | ✅ | ✅ | ✅ | ❌ (not mentioned) |
| F4 — helpers.ts constructs/calls `GithubClient` from domain | ✅ | ✅ | ✅ | ✅ | ✅ |
| F5 — service.ts constructs `WorkspaceRepository` directly (cross-module) | ✅* | ✅* | ✅* | ✅* | ✅* |
| F6 — service.ts raw `fetch`/`process.env` bypassing `GithubClient` | ✅ | ✅ | ✅ | ✅ | ✅ |
| F7 — module-level mutable `rateLimitCache` | ✅ | ✅ | ✅ | ✅ | ✅ |
| F8 — repository.ts scheduling rules + unmapped raw rows | ✅ | ✅ | ✅ | ✅ | ✅ |
| F9 — precision: no false complaint about `github-client.ts` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Score** | **9/9** | **9/9** | **9/9** | **9/9** | **8/9** |

\* All 5 runs identified the exact line (`new WorkspaceRepository(container.db)` in `service.ts`)
and recommended the fix, but every run framed it as a DI/composition-root violation ("should come
from the container") rather than the cross-module-boundary framing the assertion text expected
("should go through WorkspaceService"). Graded as a pass — same defect, same fix location, and
arguably the more idiomatic answer given this codebase's container-binds-repositories convention
(see other modules resolving `container.workspaceRepo`).

## Variance analysis

- **9/9 in 4 of 5 runs, 8/9 in the fifth** — mean 8.8/9 (97.8%), low variance. The skill produces
  a consistent, near-complete finding set across independent runs; this is not a fixture that
  looks "lucky" on a single pass.
- **The one miss (Run 5, F3)** is the only expectation to fail anywhere. Run 5's helpers.ts
  finding (#6) covered the I/O/adapter-import violation (F4) but dropped the second, subtler half
  of the "domain layer isn't pure" finding — the `InferSelectModel`-derived type coupling domain
  to the Drizzle schema. All other runs caught both halves in the same finding. This suggests F3
  is the single lowest-margin expectation in the fixture: it's a quieter signal (one line, no I/O,
  easy to fold into F4's "not pure" framing and stop) compared to the other 8, which all have an
  obvious code smell (a `fetch` call, a `db.select()`, a bare `let`, etc.).
- **F1, F2, F6, F7, F9 were caught 5/5 with near-identical phrasing** — these are the "loud"
  violations (direct DB access, raw fetch, global mutable state, the precision check on the clean
  decoy file) and appear to be zero-variance for this skill.
- **F5's consistent reframing across all 5 runs** (DI/composition-root language instead of
  cross-module-boundary language) isn't run-to-run variance — it's a systematic pattern. If a
  future iteration of the skill wants reviews to explicitly name cross-module reaches (as opposed
  to folding them into general DI hygiene), the skill's guidance would need a dedicated line about
  respecting other modules' service boundaries, since right now the DI-hygiene framing consistently
  wins out.
- **No run flagged `github-client.ts` incorrectly** (F9) — precision held perfectly across all 5,
  meaning the skill isn't just pattern-matching "any adapter usage = bad."

## Bottom line

The skill is highly reliable on this harder, multi-file fixture: 8 of 9 expectations are
effectively deterministic (5/5), one (F3) is a soft spot worth watching if it recurs in future
evals, and one (F5) reveals a consistent stylistic choice (DI-framing over module-boundary framing)
rather than an inconsistency.
