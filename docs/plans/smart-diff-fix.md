# Plan: Smart Diff multi-agent finding aggregation fix

## Understanding
`SmartDiffService.get()` populates per-file finding badges (`finding_lines`) from
review findings, but it does so by reading only ONE review row —
`reviewRows.find((r) => r.review.kind === 'review')` — which stops at the first
(newest) matching review. A real review run is multi-agent (Security Reviewer,
General Reviewer, API Contract Reviewer, …), and each agent persists its own
`reviews` row of `kind='review'`. So `.find()` silently discards every agent but
one: files only that one agent flagged show badges, and if the newest agent found
nothing the SmartDiffViewer shows zero badges everywhere. The fix is to aggregate
finding lines across the NEWEST review per `agentId` (the same per-agent dedup the
PR list already uses), keeping the change localized to `smart-diff.service.ts` and
extending the existing integration test with a multi-agent case. No schema, no
migration, no contract change.

## Context loaded
- Root `INSIGHTS.md` — "Looks greenfield, isn't" + the vendored-contracts entry
  (do not touch `src/vendor/shared`; `SmartDiff` contract already exists and is
  correct, no contract change needed).
- `server/INSIGHTS.md` — three load-bearing entries:
  (1) the Smart Diff `.find()` bug itself is documented with the prescribed fix
  (per-`agentId` `Set` dedup loop over newest-first `reviewRows`);
  (2) the matching per-`(pr,agent)` tally precedent in `pulls/routes.ts`;
  (3) "an `.it.test.ts` that inserts its OWN fully-linked fixtures can stay green
  while broken for real users" + the Ryuk/`TESTCONTAINERS_RYUK_DISABLED=true` and
  `node_modules/.bin/vitest` invocation notes (pnpm wrappers hard-fail in this env).
- `server/CLAUDE.md` — schema-first routes, modules-as-plugins, DI container, test
  split by `.it.test.ts` suffix.
- Files read for grounding:
  - `server/src/modules/reviews/smart-diff.service.ts` — the broken `.find()`.
  - `server/src/modules/pulls/routes.ts:119-159` — the correct per-`(pr,agent)`
    `Set`-dedup-over-newest-first pattern to mirror.
  - `server/src/modules/reviews/repository/review.repo.ts:57-74` — `reviewsForPull`
    returns `{ review, findings }[]` newest-first; `review` carries `agentId`+`kind`.
  - `server/src/db/schema/reviews.ts:9-46` — `reviews.agentId` is `uuid('agent_id')`
    with NO `.references()`, so test fixtures can use arbitrary distinct UUIDs as
    agent ids without inserting `agents` rows; `findings.startLine` is the badge line.
  - `server/src/vendor/shared/contracts/brief.ts:80-113` — `SmartDiff` /
    `SmartDiffFile.finding_lines` contract (unchanged by this fix).
  - `server/src/modules/reviews/smart-diff.classify.ts` — `assembleSmartDiff`
    sorts+dedupes `finding_lines` per path; aggregation just needs to feed it the
    full multi-agent `findingLinesByPath` map (no change here).
  - `server/test/smart-diff-routes.it.test.ts` — existing DB-backed suite + its
    `setupRepoAndPr` helper (single `agentId: null` review) to extend.
  - `server/test/smart-diff-classify.test.ts` — confirms the assembler is already
    covered hermetically; no change needed there.
  - `docs/plans/smart-diff.md` — original plan; its Open Questions already flagged
    "latest-per-agent" as the alternative this fix now adopts.
- Skills matched: `backend-onion-architecture` (service-vs-pure-classifier split).
  Deliberately NOT re-read — the existing `smart-diff.service.ts` (DB orchestration)
  / `smart-diff.classify.ts` (pure) split already embodies it and this fix adds no
  new layer crossing. No frontend/drizzle/zod skill applies (no client, query, or
  schema change).

## Approach & tradeoffs
**Chosen direction** — replace the single `.find()` with a per-`agentId`
deduplication loop inside `SmartDiffService.get()`, mirroring the established
per-`(pr,agent)` tally in `pulls/routes.ts` (`seenPrAgent` `Set` over newest-first
rows). Because `reviewsForPull(prId)` already returns rows newest-first, the first
time we see a given `agentId` is that agent's latest review; we keep it, skip later
(older) reviews from the same agent, and push every kept review's findings into the
shared `findingLinesByPath` map. The pure `assembleSmartDiff` already
sorts+dedupes lines per path, so feeding it the union map "just works" — no change
to the classifier/assembler or the contract.

Why this is the right scope:
- **Localized.** The bug and its fix are entirely in-memory aggregation logic in
  one method; no query, schema, contract, route, or client change is required.
- **Consistent with the codebase.** It reuses the exact dedup idiom the PR-list
  findings counter already uses, so multi-agent SmartDiff badges now match the
  multi-agent counters elsewhere in the UI.
- **`agentId ?? 'null'` key.** Mirrors `pulls/routes.ts`; a legacy/seed review with
  a null `agentId` collapses to a single `'null'` bucket (correct — there is no
  agent to distinguish), while real multi-agent runs each carry a distinct UUID.

**Alternatives rejected:**
- *Aggregate ALL `kind==='review'` rows regardless of agent.* Simpler, but it would
  double-count a re-review: a second run by the same agent would add a second
  (older) review's findings on top of its latest, inflating badges. Per-agent dedup
  (keep newest per agent) matches how findings are tallied elsewhere and how a
  re-run supersedes the prior run per agent.
- *Push the aggregation down into a new repository query.* Unnecessary — the data
  is already fetched by `reviewsForPull`; a SQL-side `DISTINCT ON (agent_id)` would
  add a query path with no benefit and more surface to test. Keep it in the service.
- *Change the contract to carry per-agent attribution.* Out of scope and would
  require editing the vendored, triplicated `brief.ts` (forbidden); badges are
  agent-agnostic line markers, so a flat union is the correct shape.

## Implementation steps

1. **Replace `.find()` with a per-`agentId` aggregation loop** —
   `server/src/modules/reviews/smart-diff.service.ts`
   - Change type: modify
   - What: in `get()`, delete the `latestReview = reviewRows.find(...)` block
     (lines ~44-51) and replace it with a dedup loop that keeps the newest review
     per agent and unions findings into `findingLinesByPath`:
     ```ts
     // Aggregate finding lines across the NEWEST review PER agent. A multi-agent
     // run emits one 'review' row per agent (reviewsForPull is newest-first), so
     // dedupe by agentId and union every agent's latest review's findings —
     // mirrors the per-(pr,agent) tally in pulls/routes.ts. A null agentId
     // (legacy/seed review) collapses to a single bucket.
     const findingLinesByPath = new Map<string, number[]>();
     const reviewRows = await this.repo.reviewsForPull(prId);
     const seenAgents = new Set<string>();
     for (const { review, findings } of reviewRows) {
       if (review.kind !== 'review') continue;
       const agentKey = review.agentId ?? 'null';
       if (seenAgents.has(agentKey)) continue;
       seenAgents.add(agentKey);
       for (const finding of findings) {
         const bucket = findingLinesByPath.get(finding.file) ?? [];
         bucket.push(finding.startLine);
         findingLinesByPath.set(finding.file, bucket);
       }
     }
     ```
     Also update the method's JSDoc (lines ~21-29): change "Takes the newest review
     of kind='review'; builds findingLinesByPath from its findings' start_line
     values" to "Aggregates finding start_line values across the newest review per
     agent (multi-agent runs emit one review per agent)". Leave the `getPull` /
     `getPrFiles` / `assembleSmartDiff(files, findingLinesByPath)` lines untouched.
   - Verify: from `server/`, `node_modules/.bin/tsc --noEmit` passes; no remaining
     `.find(` in the file (`grep -n "\.find(" server/src/modules/reviews/smart-diff.service.ts`
     returns nothing).

2. **Add a multi-agent integration test case** —
   `server/test/smart-diff-routes.it.test.ts`
   - Change type: modify
   - What: add a second fixture helper (e.g. `setupMultiAgentPr`) and a new `it`
     inside the existing `d('Smart Diff routes …')` describe block. The helper:
     - inserts a unique repo + PR (reuse the `repoSeq` counter so names/numbers stay
       collision-free, per the existing helper);
     - inserts TWO core `pr_files`, e.g.
       `CORE_FILE_A = 'src/modules/reviews/service.ts'` and
       `CORE_FILE_B = 'src/modules/pulls/routes.ts'` (both classify as `core`);
     - inserts TWO `reviews` rows, each `kind:'review'` with a DISTINCT
       `agentId: crypto.randomUUID()` (valid because `reviews.agent_id` is not a FK);
       agent A's finding is on `CORE_FILE_A` (e.g. startLine 42), agent B's finding
       is on `CORE_FILE_B` (e.g. startLine 88). Use distinct files per agent so the
       broken `.find()` necessarily drops one file's badge regardless of row order.
     - The new `it('aggregates finding_lines across all agents in a multi-agent run')`
       calls `GET /pulls/:id/smart-diff`, parses with `SmartDiff.parse`, then asserts
       BOTH core files have their finding line populated:
       `coreGroup.files.find(f => f.path === CORE_FILE_A)!.finding_lines` contains 42
       AND `… === CORE_FILE_B …` contains 88. The assertion is order-independent: on
       the broken code exactly one of the two will be empty (whichever agent `.find()`
       skipped), so the test fails pre-fix and passes post-fix.
   - Verify: from `server/`,
     `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run smart-diff-routes`
     — all four existing cases plus the new multi-agent case are green (suite skips
     cleanly when Docker is unavailable, as it does today).

3. **Confirm no other reader has the same `.find()` bug** —
   (investigation step, no file change)
   - Change type: none (verification)
   - What: `grep -rn "reviewsForPull" server/src` and confirm the only place that
     reduces multiple reviews to one via `.find` was `smart-diff.service.ts`; other
     callers (`run.repo.ts`, review detail) either list all reviews or are scoped to
     a single run. Documents that the fix is complete and localized.
   - Verify: `grep -rn "\.find((r) => r.review.kind" server/src` returns no matches
     after step 1.

## Acceptance criteria
Run from `server/` using the direct binaries (per `server/INSIGHTS.md`, `pnpm <script>`
hard-fails on `ERR_PNPM_IGNORED_BUILDS` in this env):

1. **Typecheck.** `node_modules/.bin/tsc --noEmit` passes (no type regression from
   the loop rewrite).
2. **Regression test proves the fix.** `TESTCONTAINERS_RYUK_DISABLED=true
   node_modules/.bin/vitest run smart-diff-routes` is green, including the new
   multi-agent case. Sanity check that the test is a real guard: temporarily reverting
   step 1 to the old `.find()` makes ONLY the new multi-agent case fail (one of the
   two files' `finding_lines` empty) while the three original cases stay green —
   confirming the test catches the bug the original suite missed.
3. **No stray single-review reducer remains.**
   `grep -rn "\.find((r) => r.review.kind" server/src` returns nothing.
4. **End-to-end behavior.** With API + web running (`./scripts/dev.sh`), open a PR
   reviewed by ≥2 agents whose findings land on different files → the Smart Diff tab
   shows a findings badge on EACH file an agent flagged (not just one agent's files),
   and a PR where only a non-newest agent found anything still shows its badges. No
   OpenAI/Anthropic/OpenRouter call occurs (the service reads persisted rows only).

## Risks / out of scope / open questions
- **Risks:**
  - `createdAt` ordering ties in the test: two reviews inserted in the same
    millisecond could come back in either order. Mitigated by making the new
    assertion order-independent (both files must have badges) — the fixed code is
    correct regardless of order, and the broken code fails regardless of order.
  - Per-agent dedup keys on `agentId ?? 'null'`. If a real run ever persisted
    multiple distinct agents all with a null `agentId`, they would collapse into one
    bucket — but real runs set `review.runId`/`agentId` (per `server/INSIGHTS.md`),
    and only legacy/seed standalone reviews are null, so this matches reality.
  - Do NOT touch `server/src/vendor/shared/contracts/brief.ts` — the `SmartDiff`
    contract already fits; editing the vendored/triplicated copy is forbidden.
- **Out of scope:** no DB schema / migration change; no contract change; no client
  (`SmartDiffViewer`) change (it already renders whatever `finding_lines` the API
  returns); no change to `smart-diff.classify.ts` / `smart-diff.constants.ts`; no
  change to the existing hermetic `smart-diff-classify.test.ts`; no filtering of
  dismissed findings (kept consistent with the current behavior and the PR-list
  counters, which include dismissed findings).
- **Open questions / assumptions:**
  - Assumed "keep the NEWEST review per agent" (re-run supersedes prior run for that
    agent), matching the per-`(pr,agent)` tally in `pulls/routes.ts`. If product
    wants the union of ALL reviews ever (including superseded re-runs), drop the
    `seenAgents` guard — but that would inflate badges on re-review and diverge from
    the PR-list counters, so this plan does not.
  - Assumed `finding_lines` should include dismissed findings (the assembler/service
    do not currently filter on `dismissedAt`); if only live findings should badge,
    that is a separate, broader change touching counters too.
