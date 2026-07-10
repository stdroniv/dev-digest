# Implementation Plan: Eval Pipeline (SPEC-04)

## Overview
An offline, zero-LLM regression harness for reviewer **agents**. A maintainer turns
any accepted/dismissed finding into a frozen eval case, runs an agent version against
the whole set, and sees recall / precision / citation_accuracy move — with two runs
comparable side-by-side (metric deltas + system-prompt diff) and a one-click promote
of the winning version. Scoring is pure code; `pnpm verify:l06` proves the run path +
scoring math with no keys and no network.

## Execution mode
multi-agent (parallel) — the feature spans server (eval module + migration + scorer +
seed) and client (FindingCard, AgentEditor tab, dashboard, two modals, hooks, i18n,
nav) plus vendored contracts across 3 packages: >15 files, >1 package. The plan is
shaped as a dependency DAG with non-overlapping Owned paths, contracts/scorer first,
and the client build split into foundation → components → page+wiring sub-layers.

## Requirements (verified)
Every AC below is settled WHAT from `specs/SPEC-04-2026-07-08-eval-pipeline.md` (SPEC-04, approved). Each
maps to an owning task (T-id) in the Phased tasks section.

**Create a case from a finding**
- R-AC1 (SPEC-04 AC-1): accepted finding → one-click `must_find` case owned by the
  review's agent; expected output = one finding carrying file/start_line/end_line/
  severity/category/title; input = the diff fragment + PR metadata it was reviewed
  against. → **T6, T14**
- R-AC2 (AC-2): dismissed finding → `must_not_flag` case (expected output `[]`), same
  frozen input. → **T6, T14**
- R-AC3 (AC-3): one click, no mandatory form, visible confirmation, auto-derived
  editable name. → **T6, T14**
- R-AC4 (AC-4): no-decision finding yields no derivable expectation — action disabled
  unless a decision exists. → **T6, T14**
- R-AC5 (AC-5): repeated clicks do not create duplicate identical cases (idempotent
  per finding, or surfaced as "already added"). → **T6, T14**

**Viewing the set**
- R-AC6 (AC-6): Agent editor **Evals** tab lists every case (name, "expected N
  findings", severity·category or "empty []", last-run status). → **T15**
- R-AC7 (AC-7): ≥8 seeded cases for the demo agent, both expectation types present.
  → **T9**
- R-AC8 (AC-8): Evals tab shows current aggregate metrics + delta vs previous run.
  → **T6, T15**

**Running**
- R-AC9 (AC-9): "Run all evals" executes the agent over every case on frozen inputs;
  persists one record per case + aggregate, attributed to the current version.
  → **T2, T6, T7**
- R-AC10 (AC-10): runs across versions use identical case inputs. → **T2, T6**
- R-AC11 (AC-11): scoring makes zero LLM calls — pure fn of (expected, actual, input
  diff). → **T3**
- R-AC12 (AC-12): same version + deterministic reviewer → identical metrics. → **T3, T10**

**Metrics move with the prompt**
- R-AC13 (AC-13): a deliberately degraded prompt produces a visible precision drop vs
  the prior run. → **T10 (deterministic proof), T15/T18 (surfaced)**
- R-AC14 (AC-14): a delta indicator states which metric moved and by how much between
  the two most recent runs. → **T6, T15**

**History & comparison**
- R-AC15 (AC-15): per-agent run history, newest-first (ran-at, version, recall,
  precision, citation, pass count, cost). → **T4, T6, T7, T17**
- R-AC16 (AC-16): select two runs → read-only side-by-side (old→new + delta per
  metric, cost old→new, system-prompt diff of the two versions). → **T1, T6, T18**

**Dashboard**
- R-AC17 (AC-17): sidebar **Eval Dashboard** (SKILLS LAB) → per-agent latest metrics +
  pass count + cross-agent Recent Eval Runs. → **T11, T17**
- R-AC18 (AC-18): select an agent → eval detail (cards, trend, recent runs) reaching
  comparison. → **T17, T18**

**Robustness & verification**
- R-AC19 (AC-19): every eval route schema-first (Zod via type provider), `422` before
  the handler. → **T7**
- R-AC20 (AC-20): degraded inputs (zero cases, empty diff, no findings, correct
  silence) score without throwing; empty set → defined metrics, not `NaN`. → **T3**
- R-AC21 (AC-21): `cd server && pnpm verify:l06` green with no keys/network — mock
  reviewer run path + pure scoring math on fixtures. → **T5, T10**

**Case management**
- R-AC22 (AC-22): author a brand-new case from scratch (name, frozen input, expected
  output). → **T7, T16**
- R-AC23 (AC-23): edit → rename + edit expected-output as JSON; invalid JSON blocks
  save + is flagged; finding-skeleton affordance inserts a well-formed shape. → **T16**
- R-AC24 (AC-24): delete removes from the live set; prior runs that scored it remain in
  history. → **T4, T7, T16**

**Added run entry points**
- R-AC25 (AC-25): run a single case → one per-case record like a full run; aggregate
  still derives from the set's **latest** per-case records. → **T6, T7**
- R-AC26 (AC-26): "Run all agents" from the dashboard runs each independently; one
  agent's failure is isolated, the rest still complete. → **T6, T7, T17**

**Promotion**
- R-AC27 (AC-27): confirm "Promote vN" in the comparison view → set active version to
  the newer of the two runs' versions; comparison exposes no other write. → **T6, T7, T18**

**Trend over history**
- R-AC28 (AC-28): dashboard + agent-detail show per-agent metric history over runs
  (sparkline + per-metric trend), beyond the two most recent. → **T6, T17**

Edge cases from the spec (snapshot-at-creation, extra-findings precision dent,
same-version empty prompt-diff, out-of-diff citation lowering citation_accuracy, path
prefix normalisation, deleted-case history retention, invalid-JSON block) are covered
by the scorer (T3), the case snapshot (T6), and the editor (T16) as noted per-task.

## Open questions & recommendations
- Q1 → answered: **new migration `0019`** confirmed after reading `schema/eval.ts` —
  `eval_runs` has no way to group per-case rows into one run or attribute a run to an
  agent version (columns are id, case_id, ran_at, actual_output, pass, recall,
  precision, citation_accuracy, duration_ms, cost_usd). Add `run_group_id` (uuid) +
  `agent_version` (integer) to `eval_runs`. Whole-set aggregate stays **derived** from
  the latest per-case records (no second aggregate row persisted). → T2.
- Q2 → answered: pure scorer lives in `server/src/modules/eval/scoring/` as tiny
  independently-testable functions. reviewer-core stays the review engine. → T3.
- Q3 → answered: `verify:l06` added to **`server/package.json`**; run via
  `cd server && pnpm verify:l06`. No root package.json / no root proxy. → T10.
- Q4 → answered: **no upstream `shared/` package exists** (only unrelated clones under
  `server/clones/`). The three `src/vendor/shared` copies (server, client, mcp) are the
  de-facto source of truth; new contracts are added **identically** to all three and a
  parity gate verifies they stay byte-identical. Provenance is a recorded risk. → T1, T21.
- Q5 → answered: server seed extended to create ≥8 eval cases for the demo agent
  ("Security Reviewer") from real accepted/dismissed findings, both expectation types.
  The one-click-from-finding path remains the primary write path; seeding guarantees
  the AC-7 floor. → T9.
- Rec (applied): scorer is a set of tiny pure functions with per-function fixtures. → T3.
- Rec (applied): the run aggregate is **derived** from the latest per-case records, not
  a second persisted row (avoids per-case/aggregate drift; directly serves AC-25). → T4.

## Affected modules & contracts
- **server** — new `modules/eval/` (routes + service + repository + scoring + mock
  reviewer + tests); migration `0019` + `schema/eval.ts` column additions; module
  registration in `modules/index.ts`; seed additions; `verify:l06` script.
- **client** — FindingCard button; AgentEditor **Evals** tab (+ case-editor modal);
  Eval Dashboard page + agent detail + compare modal; `lib/hooks/evals.ts`; i18n
  `messages/en/evals.json`; nav entry.
- **Contracts** (added identically to `server`, `client`, `mcp` `src/vendor/shared/`):
  `EvalExpectedFinding`, `EvalRunGroup` (run aggregate attributed to a version),
  `EvalComparison` (two-run deltas + cost delta + system-prompt diff), `EvalPromoteInput`.
  Extend `contracts/eval-ci.ts`; base `EvalRun`/`EvalCase`/`EvalOwnerKind` in
  `contracts/knowledge.ts` are reused unchanged. No existing contract field is edited.

## Architecture changes
Onion layering for the new server module (Presentation → Application → Infrastructure;
scoring is a pure Domain helper):
- `server/src/modules/eval/routes.ts` — Presentation (schema-first Fastify plugin).
- `server/src/modules/eval/service.ts` — Application (freeze case from finding, run
  orchestration, dashboard/comparison assembly, promote).
- `server/src/modules/eval/repository.ts` — Infrastructure (Drizzle reads/writes over
  `eval_cases` / `eval_runs`).
- `server/src/modules/eval/scoring/` — pure Domain (no I/O, no LLM): `normalize.ts`,
  `match.ts`, `metrics.ts`, `aggregate.ts` + `*.test.ts` fixtures.
- `server/src/modules/eval/mock-reviewer.ts` — a deterministic reviewer/LLM stub used
  only by `verify:l06` (never wired into the real DI container).
Client (App Router / RSC boundaries):
- `client/src/app/evals/page.tsx` — thin RSC page; interactive dashboard is a client
  component under `_components/`.
- AgentEditor **Evals** tab + modals are client components (`"use client"`) colocated
  under the existing AgentEditor tree.

## Phased tasks

### Phase 1 — Contracts, schema, pure scorer (foundation)

#### T1 — Add eval contracts to the three vendored `shared` copies
- **Action:** Add `EvalExpectedFinding` (`file`, `start_line`, `end_line`, optional
  `severity`/`category`/`title`), `EvalRunGroup` (id/run_group_id, agent_id,
  agent_version, ran_at, recall, precision, citation_accuracy, traces_passed,
  traces_total, cost_usd), `EvalComparison` (old/new `EvalRunGroup` + per-metric
  `{old,new,delta}` incl. cost + `system_prompt_diff` text/hunks + `newer_version`),
  and `EvalPromoteInput` to `contracts/eval-ci.ts`. Reuse base `EvalRun`/`EvalCase`/
  `EvalOwnerKind` from `knowledge.ts` unchanged. Apply the **identical** edit to all
  three copies. Do not edit any existing exported field.
- **Module:** server + client + mcp (vendored contracts)
- **Type:** core
- **Skills to use:** `zod`, `client-server-communication`, `typescript-expert`
- **Owned paths:** `server/src/vendor/shared/contracts/eval-ci.ts`,
  `client/src/vendor/shared/contracts/eval-ci.ts`,
  `mcp/src/vendor/shared/contracts/eval-ci.ts`
- **Depends-on:** none
- **Risk:** medium
- **Known gotchas:** no upstream generator exists — the three copies must be edited
  by hand and kept byte-identical (T21 gate); vendored barrels are re-exported, so a
  new export must appear in each package's barrel if `eval-ci.ts` is not already
  wildcard-exported — verify the barrel before finishing.
- **Acceptance:** `cd server && pnpm typecheck` and `cd client && pnpm typecheck` and
  `cd mcp && pnpm typecheck` all pass with the new types importable from
  `@devdigest/shared`; a diff of the three `eval-ci.ts` files shows no differences in
  the added region (proven mechanically in T21).

#### T2 — Migration 0019: run grouping + version attribution on `eval_runs`
- **Action:** Add `runGroupId: uuid('run_group_id')` and `agentVersion:
  integer('agent_version')` (nullable, back-compatible) to `evalRuns` in
  `schema/eval.ts`, then generate a **new** migration via `pnpm db:generate` (never
  edit `0000`). Do not persist a separate aggregate row — the aggregate is derived
  (T4). `run_group_id` ties the N per-case rows of one run together; `agent_version`
  attributes the run to the `agent_versions` snapshot that produced it (agent id is
  reachable via `eval_cases.owner_id`).
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `postgresql-table-design`
- **Owned paths:** `server/src/db/schema/eval.ts`, `server/src/db/migrations/**` (only
  the newly generated `0019_*.sql` + its meta snapshot — never an existing migration)
- **Depends-on:** none
- **Risk:** medium
- **Known gotchas:** migrations are NOT applied on boot — the run command is
  `cd server && pnpm db:migrate`; never edit `0000` or any existing migration; keep
  the new columns nullable so existing empty tables/back-compat hold.
- **Acceptance:** `cd server && pnpm db:generate` produces exactly one new
  `0019_*.sql`; `pnpm db:migrate` applies clean against a fresh Postgres; `pnpm
  typecheck` passes with `evalRuns.runGroupId` / `evalRuns.agentVersion` present.

#### T3 — Pure scorer functions + per-function fixtures
- **Action:** Implement tiny pure functions, each with its own fixture test:
  `normalizePath` (strip `a/`,`b/` diff-header prefixes so `a/src/x.ts` == `src/x.ts`),
  `rangesOverlap([s1,e1],[s2,e2])`, `matchFinding(expected, actual)` (file equal after
  normalise AND line ranges overlap; no text/semantic compare), `computeRecall`
  (matched `must_find` expectations / total `must_find`), `computePrecision` (actual
  findings that are NOT noise / total actual — noise = matches a `must_not_flag`, or
  matches nothing in a case that expected something specific), `computeCitationAccuracy`
  (actual findings citing a real file:line inside the case's input diff / total actual),
  and `aggregate(latestPerCaseRecords)` (set-level recall/precision/citation + pass
  count). Every metric is a pure function of `(expectedOutput, actualFindings,
  inputDiff)` and makes zero LLM/IO calls. Empty inputs return defined 0/1 values,
  never `NaN`.
- **Module:** server
- **Type:** core
- **Skills to use:** `typescript-expert`, `backend-onion-architecture`
- **Owned paths:** `server/src/modules/eval/scoring/normalize.ts`,
  `server/src/modules/eval/scoring/match.ts`,
  `server/src/modules/eval/scoring/metrics.ts`,
  `server/src/modules/eval/scoring/aggregate.ts`,
  `server/src/modules/eval/scoring/index.ts`,
  `server/src/modules/eval/scoring/normalize.test.ts`,
  `server/src/modules/eval/scoring/match.test.ts`,
  `server/src/modules/eval/scoring/metrics.test.ts`,
  `server/src/modules/eval/scoring/aggregate.test.ts`
- **Depends-on:** T1
- **Risk:** medium
- **Known gotchas:** covers spec edge cases directly — path-prefix normalisation must
  not cause false mismatches; an out-of-diff citation lowers citation_accuracy AND does
  not count as a recall match; extra findings dent precision only when they are noise
  per the match rule; empty set / empty diff / no findings / correct `must_not_flag`
  silence must all score to defined numbers (AC-20). Hermetic `*.test.ts` (NOT
  `.it.test.ts`) — no DB, no keys, no network.
- **Acceptance:** `cd server && pnpm exec vitest run src/modules/eval/scoring` green;
  fixtures assert exact recall/precision/citation values including the AC-20 degraded
  cases (empty set → defined, not `NaN`) and the AC-12 reproducibility (same inputs →
  identical numbers).

### Phase 2 — Server eval module

#### T4 — Eval repository (cases + runs + derived aggregate)
- **Action:** Drizzle repository over `eval_cases` / `eval_runs`: create/update/delete
  a case; list cases for an agent (`owner_kind='agent'`, `owner_id=:agentId`,
  workspace-scoped); insert per-case run rows tagged with a shared `run_group_id` +
  `agent_version`; read the **latest** per-case record per case (for the derived
  aggregate — AC-25); list run groups newest-first (AC-15); read the two run groups'
  per-case rows for a comparison; read a trend series over run groups (AC-28). Deleting
  a case removes it from the live set but leaves historical `eval_runs` rows intact
  (AC-24; `eval_runs.case_id` FK is `onDelete: cascade`, so **soft-exclude** deleted
  cases from the live set rather than hard-deleting the case if historical rows must
  survive — decide and document: prefer keeping the case row and filtering, or copy the
  case identity into the run row; implementer picks the approach that preserves history
  and records it in `server/INSIGHTS.md`).
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `backend-onion-architecture`,
  `postgresql-table-design`
- **Owned paths:** `server/src/modules/eval/repository.ts`,
  `server/src/modules/eval/repository.it.test.ts`
- **Depends-on:** T2
- **Risk:** high
- **Known gotchas:** AC-24 history retention interacts with the `onDelete: cascade` on
  `eval_runs.case_id` — a naive case delete would cascade away historical run rows;
  the repo must preserve prior runs (soft-exclude or de-reference). DB-backed test MUST
  use the `.it.test.ts` suffix (testcontainers Postgres).
- **Acceptance:** `cd server && pnpm exec vitest run
  src/modules/eval/repository.it.test.ts` green, including a test that deletes a case
  and asserts its historical `eval_runs` rows still exist while it no longer appears in
  the live set (AC-24).

#### T5 — Deterministic mock reviewer adapter
- **Action:** A deterministic reviewer/LLM stub the run path can use instead of the
  real provider: given a case input + a canned scenario, it returns a fixed set of
  actual findings (including a "degraded prompt" scenario that emits an extra noisy
  finding, for AC-13). No network, no keys. Injected only by tests/`verify:l06`; never
  registered in the production DI container. Model it on `reviewer-core`'s stubbed
  `LLMProvider` pattern and `server/src/adapters/mocks.ts` so it plugs into
  `reviewPullRequest` unchanged (AC-11: the reviewer is consumed, not modified).
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`, `typescript-expert`
- **Owned paths:** `server/src/modules/eval/mock-reviewer.ts`
- **Depends-on:** T3
- **Risk:** medium
- **Known gotchas:** must satisfy the real `LLMProvider`/`ReviewInput` contract from
  `@devdigest/reviewer-core` so the run path is genuinely exercised (not stubbed away);
  keep it deterministic (fixed findings per scenario) so AC-12 holds.
- **Acceptance:** unit test in T10 drives `reviewPullRequest` (or the run service) with
  this adapter and gets identical findings on repeated calls; zero network/keys.

#### T6 — Eval service (freeze-from-finding, run orchestration, dashboard, compare, promote)
- **Action:** Application layer:
  - **create-from-finding** (AC-1..AC-5): read the finding → its review → PR; disable
    when the finding has no decision (AC-4); derive expectation from `accepted_at` vs
    `dismissed_at` (accepted → `must_find` with one expected finding carrying
    file/start_line/end_line/severity/category/title; dismissed → `must_not_flag` `[]`);
    **freeze the input** by loading the diff via `loadDiff(...)` and storing its raw
    text in `eval_cases.input_diff` + PR metadata in `input_meta` (title/number/body);
    auto-derive an editable name from the finding title; make it idempotent per finding
    (AC-5 — e.g. a natural key of finding id in `input_meta`/`notes`, return
    "already added"). The case is a snapshot: a later decision flip does not mutate it
    (edge case).
  - **run-all / single-case** (AC-9, AC-25): for each case, rebuild `UnifiedDiff` from
    the frozen `input_diff` via `parseUnifiedDiff`, run the agent's config through
    `reviewPullRequest` (real provider in app; mock in verify), score via T3, persist
    one per-case row under a shared `run_group_id` + current `agent_version`. Identical
    inputs across versions (AC-10). Aggregate is derived from latest per-case rows.
  - **run-all-agents** (AC-26): iterate agents, isolate failures so one agent's error
    still lets the rest complete and be reflected individually.
  - **dashboard aggregate** (AC-8, AC-14, AC-17, AC-28): current metrics + delta vs
    previous run + a legible alert string ("Precision dipped 2pts") + trend series.
  - **comparison** (AC-16): assemble two run groups' metric `old→new`+delta, cost
    delta, and a system-prompt diff computed from the two `agent_versions` config
    snapshots. Read-only.
  - **promote** (AC-27): set the agent's active version to the newer of the two
    compared versions (reuse the agents module's version/promote path); the only write
    the comparison exposes; same-version compare → no-op.
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`, `fastify-best-practices`,
  `security`, `typescript-expert`
- **Owned paths:** `server/src/modules/eval/service.ts`,
  `server/src/modules/eval/service.it.test.ts`
- **Depends-on:** T3, T4, T5
- **Risk:** high
- **Known gotchas:** the frozen diff is **untrusted** (real PR text) — it is stored and
  replayed as **data**, never as prompt instructions; rely on the existing reviewer's
  `wrapUntrusted`/grounding guard and add no new path that lets frozen text steer the
  model or scorer (spec §Untrusted inputs). `loadDiff` prefers `git diff` and falls
  back to `pr_files` reconstruction — freeze the resolved text so replays are stable.
  Per-agent failure isolation must mirror the existing `run-executor` try/catch pattern.
- **Acceptance:** `cd server && pnpm exec vitest run
  src/modules/eval/service.it.test.ts` green, covering: accepted→`must_find` &
  dismissed→`must_not_flag` freeze (AC-1/AC-2), idempotent re-create (AC-5), snapshot
  survives a decision flip (edge case), run-all persists N rows under one run_group_id
  with version attribution (AC-9/AC-10), single-case updates the derived aggregate
  (AC-25), run-all-agents isolates a failing agent (AC-26), comparison returns deltas +
  prompt diff (AC-16), promote sets the newer active version (AC-27).

#### T7 — Eval routes (schema-first Fastify plugin)
- **Action:** A Fastify plugin exposing (all Zod `params`/`body` via the type
  provider; workspace-scoped via `getContext`; `NotFoundError` for missing entities):
  `POST /findings/:id/eval-case` (create-from-finding, AC-1..AC-5),
  `GET /agents/:id/eval-cases` (list, AC-6), `POST /agents/:id/eval-cases` (author from
  scratch, AC-22), `PUT /eval-cases/:id` (rename + expected-output edit, AC-23),
  `DELETE /eval-cases/:id` (AC-24), `POST /agents/:id/eval-runs` (run all, AC-9),
  `POST /eval-cases/:id/eval-runs` (single case, AC-25),
  `POST /eval-runs/run-all-agents` (AC-26), `GET /agents/:id/eval-runs` (history,
  AC-15), `GET /agents/:id/eval-dashboard` (AC-8/AC-28), `GET /eval-dashboard`
  (cross-agent, AC-17), `POST /eval-runs/compare` (two run_group ids → EvalComparison,
  AC-16), `POST /agents/:id/eval-promote` (AC-27). Response bodies use the T1 contracts.
- **Module:** server
- **Type:** backend
- **Skills to use:** `fastify-best-practices`, `client-server-communication`, `zod`,
  `security`
- **Owned paths:** `server/src/modules/eval/routes.ts`,
  `server/src/modules/eval/routes.it.test.ts`
- **Depends-on:** T6, T1
- **Risk:** medium
- **Known gotchas:** schema-first only — never hand-roll `Schema.parse(req.body)` in a
  handler (AC-19); invalid input must be rejected with `422` before the handler by the
  type provider. Cross-workspace ids must 404 (defense-in-depth, `security`), mirroring
  the agents/documents routes.
- **Acceptance:** `cd server && pnpm exec vitest run
  src/modules/eval/routes.it.test.ts` green, including an invalid-body case asserting a
  `422` (AC-19) and happy-path round-trips for create-from-finding, run, history,
  compare, promote.

#### T8 — Register the eval module
- **Action:** Add one import + one registry entry for the eval plugin in the module
  registry (the only task that edits this shared file).
- **Module:** server
- **Type:** backend
- **Skills to use:** `fastify-best-practices`
- **Owned paths:** `server/src/modules/index.ts`
- **Depends-on:** T7
- **Risk:** low
- **Known gotchas:** register statically (not filesystem autoload) per the existing
  pattern; plugins register after the shared plugins so encapsulated routes inherit
  helmet/cors/rate-limit/error-handler.
- **Acceptance:** `cd server && pnpm typecheck` passes and the server boots with the
  eval routes mounted (a `GET /eval-dashboard` smoke assertion in an existing route
  registration test, or a new hermetic boot test).

#### T9 — Seed ≥8 eval cases for the demo agent (AC-7)
- **Action:** Extend the server seed to create ≥8 eval cases for the demo "Security
  Reviewer" agent from real accepted/dismissed seed findings, with **both** expectation
  types represented (≥1 `must_find` and ≥1 `must_not_flag`). Put the logic in a new
  `seed-evals.ts` and call it from `seed.ts` (the only task that touches `seed.ts`).
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`
- **Owned paths:** `server/src/db/seed-evals.ts`, `server/src/db/seed.ts`
- **Depends-on:** T4
- **Risk:** low
- **Known gotchas:** the seed must reuse the same freeze shape the service writes
  (input_diff text + input_meta) so seeded cases run identically to clicked ones; the
  one-click-from-finding path stays primary — seeding only guarantees the floor.
- **Acceptance:** `cd server && pnpm db:seed` populates ≥8 `eval_cases` for the demo
  agent with both expectation types; a query in the seed test (or a follow-up assertion)
  confirms count ≥ 8 and both `must_find` + `must_not_flag` present.

#### T10 — `verify:l06` script + mock-reviewer run-path test (+ AC-13 proof)
- **Action:** Add `"verify:l06"` to `server/package.json` (sibling of `verify:l03`)
  running a scoped `vitest run` over the scorer unit tests (T3) plus a new hermetic
  run-path test that drives the run service with the T5 mock reviewer and asserts the
  scoring math on known fixtures — no keys, no network. Include the AC-13 proof: run the
  set with a baseline mock scenario, then with the "degraded prompt" scenario, and
  assert a **visible precision drop** between the two runs (deterministic). All
  `*.test.ts` (NOT `.it.test.ts`).
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`, `typescript-expert`
- **Owned paths:** `server/package.json`,
  `server/src/modules/eval/run-path.test.ts`
- **Depends-on:** T3, T5, T6
- **Risk:** medium
- **Known gotchas:** must be GREEN offline — the run-path test uses the mock reviewer
  (no real LLM), so it is a plain `*.test.ts`, never `.it.test.ts` (no testcontainers/DB
  required for the scoring assertions). There is no root package.json — the green
  command is `cd server && pnpm verify:l06`.
- **Acceptance:** `cd server && pnpm verify:l06` exits 0 with no `~/.devdigest/secrets`
  and no network; the run-path test asserts reproducible metrics (AC-12/AC-21) and the
  degraded-prompt precision drop (AC-13).

### Phase 3 — Client foundation

#### T11 — Nav entry: Eval Dashboard (SKILLS LAB) + shortcut
- **Action:** Add an "Eval Dashboard" `NavItemDef` to the SKILLS LAB group in
  `vendor/ui/nav.ts` (`href: "/evals"`, an icon from the existing `IconName` set,
  `gKey` e.g. `"e"`), a matching `SHORTCUTS` entry, and update the nav-gating test.
- **Module:** client
- **Type:** ui
- **Skills to use:** `next-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/vendor/ui/nav.ts`,
  `client/src/components/app-shell/NavGating.test.tsx`
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** `nav.ts` is vendored with no upstream — edit the copy directly and
  note provenance (T21 covers `shared`, not `ui`; still flag). Pick a `gKey` not already
  used (p/d/t/s/a/c/, taken).
- **Acceptance:** `cd client && pnpm exec vitest run
  src/components/app-shell/NavGating.test.tsx` green with the new item asserted.

#### T12 — TanStack Query hooks for the eval API
- **Action:** `lib/hooks/evals.ts` with query keys + hooks over the T7 routes:
  `useAgentEvalCases`, `useCreateCaseFromFinding`, `useCreateCase`, `useUpdateCase`,
  `useDeleteCase`, `useRunAllEvals`, `useRunSingleCase`, `useRunAllAgents`,
  `useAgentEvalDashboard`, `useEvalDashboard`, `useAgentEvalRuns`, `useCompareRuns`,
  `usePromoteVersion`. All fetches go through `apiFetch` in `lib/api.ts`; typed with the
  T1 contracts. Register in `lib/hooks/index.ts`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `client-server-communication`,
  `next-best-practices`
- **Owned paths:** `client/src/lib/hooks/evals.ts`,
  `client/src/lib/hooks/index.ts`
- **Depends-on:** T1
- **Risk:** medium
- **Known gotchas:** never `fetch` from a component — all access through hooks →
  `apiFetch`; mutations must invalidate the right keys (case list, dashboard, run
  history) so metrics/delta refresh after a run (AC-8/AC-14). `index.ts` is shared —
  this is the only client task editing it.
- **Acceptance:** `cd client && pnpm typecheck` passes; a hermetic hook test
  (`fetch` mocked) exercises one query + one mutation shape.

#### T13 — i18n messages for evals
- **Action:** Add `messages/en/evals.json` with all user-facing strings (tab label,
  metric labels, confirmations, delta/alert templates, modal labels, promote copy) and
  register the namespace where message namespaces are wired.
- **Module:** client
- **Type:** ui
- **Skills to use:** `next-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/messages/en/evals.json`,
  `client/src/i18n/*` (only the namespace-registration file, if messages are enumerated
  there — implementer confirms the single registration point and owns just that file)
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** strings come from `messages/*`, not hard-coded JSX (`useTranslations`).
- **Acceptance:** `cd client && pnpm typecheck` + `pnpm build` succeed with the new
  namespace resolvable; no missing-message warnings for eval keys.

### Phase 4 — Client components

#### T14 — FindingCard "Turn into eval case" button
- **Action:** Add the action to `FindingCard`: enabled only when the finding has a
  decision (accepted or dismissed) — disabled otherwise with an explanatory tooltip
  (AC-4); one click, no form, immediate confirmation toast (AC-3); calls
  `useCreateCaseFromFinding` (T12); reflects "already added" idempotently (AC-5).
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:**
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/styles.ts`
- **Depends-on:** T12, T13
- **Risk:** low
- **Known gotchas:** derive the expectation only from the decision (never invent one for
  an undecided finding — AC-4); confirmation must be visible (AC-3).
- **Acceptance:** `cd client && pnpm exec vitest run
  .../FindingCard/FindingCard.test.tsx` green: button disabled for an undecided finding,
  enabled + fires the mutation + shows confirmation for accepted/dismissed.

#### T15 — AgentEditor Evals tab (list + metrics + run-all)
- **Action:** Add an **Evals** tab to `AgentEditor` in the order Config / Skills /
  Context / **Evals** / Stats / CI (per the designs). The tab lists every case (name,
  "expected N findings", severity·category or "empty []", last-run status —
  passed/failed/never run) (AC-6); shows current aggregate metrics + delta vs previous
  run with a legible direction indicator (AC-8/AC-14); and a "Run all evals" button
  (AC-9) plus per-case run (AC-25). Uses T12 hooks.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`,
  `next-best-practices`
- **Owned paths:**
  `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/index.ts`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/styles.ts`
- **Depends-on:** T12, T13
- **Risk:** medium
- **Known gotchas:** `AgentEditor.tsx` is the shared tab host — only this task edits it
  (T16 owns only the modal subdir and is wired in here or reached via the tab). Tab
  order is fixed by the designs.
- **Acceptance:** `cd client && pnpm exec vitest run .../EvalsTab/EvalsTab.test.tsx`
  green: renders the case list with expectation summaries + last-run status, shows
  metrics + delta indicator, and "Run all evals" invokes the mutation.

#### T16 — Case editor modal (author / edit / delete, JSON validation, skeleton)
- **Action:** A modal reached from the Evals tab to: author a case from scratch (name,
  frozen input fields, expected output) (AC-22); rename + edit expected-output as JSON
  with live validation that **blocks save while invalid** and flags it, plus a
  "finding skeleton" button inserting a well-formed expected-finding shape (AC-23);
  delete a case (AC-24). Uses T12 mutations.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`, `zod`
- **Owned paths:**
  `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/_components/CaseEditorModal/CaseEditorModal.tsx`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/_components/CaseEditorModal/CaseEditorModal.test.tsx`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/_components/CaseEditorModal/index.ts`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/_components/CaseEditorModal/styles.ts`
- **Depends-on:** T15
- **Risk:** medium
- **Known gotchas:** invalid JSON must block the save so no malformed case enters the
  set (AC-23 / edge case); the skeleton must match `EvalExpectedFinding` (T1) so a
  saved case scores correctly. Owns only the modal subdir — does not edit `EvalsTab.tsx`
  (T15 renders/opens it) beyond its own import barrel.
- **Acceptance:** `cd client && pnpm exec vitest run
  .../CaseEditorModal/CaseEditorModal.test.tsx` green: invalid JSON disables save +
  shows the flag, the skeleton button inserts a valid shape, and delete fires the
  mutation.

### Phase 5 — Dashboard, comparison, wiring & verification

#### T17 — Eval Dashboard page + agent detail
- **Action:** `app/evals/page.tsx` (thin RSC) hosting a client dashboard that shows each
  agent with latest recall/precision/citation + pass count and a cross-agent "Recent
  Eval Runs" list newest-first (AC-17, design 2), a "Run all agents" action reflecting
  each agent's individual result incl. isolated failures (AC-26), and drill-in to an
  agent eval detail (metric cards, per-agent sparkline + per-metric trend over runs —
  AC-28). The agent-eval-detail surface (`AgentEvalDetail`, design 3) additionally
  renders its **own per-agent recent-runs list, newest-first (AC-15)**, with the full
  AC-15 fields per row: ran-at, agent version, recall, precision, citation_accuracy,
  pass count, and cost. This per-agent runs list is the **run-picker source for T18's
  two-run compare flow** — each row carries a selection checkbox and, once exactly two
  runs are selected, a "Compare" affordance opens the T18 compare modal on those two run
  groups (design 3), which is how comparison is reached from the agent detail (AC-18).
  (This per-agent list is distinct from and in addition to the dashboard's cross-agent
  "Recent Eval Runs" list above.) Uses T12 hooks.
- **Module:** client
- **Type:** ui
- **Skills to use:** `next-best-practices`, `ui-frontend-architecture`,
  `react-best-practices`
- **Owned paths:**
  `client/src/app/evals/page.tsx`,
  `client/src/app/evals/_components/EvalDashboard/EvalDashboard.tsx`,
  `client/src/app/evals/_components/EvalDashboard/EvalDashboard.test.tsx`,
  `client/src/app/evals/_components/EvalDashboard/index.ts`,
  `client/src/app/evals/_components/EvalDashboard/styles.ts`,
  `client/src/app/evals/_components/AgentEvalDetail/AgentEvalDetail.tsx`,
  `client/src/app/evals/_components/AgentEvalDetail/AgentEvalDetail.test.tsx`,
  `client/src/app/evals/_components/AgentEvalDetail/index.ts`,
  `client/src/app/evals/_components/AgentEvalDetail/styles.ts`
- **Depends-on:** T12, T13, T11, T18
- **Risk:** medium
- **Known gotchas:** page thin, logic in `_components`; trend/sparkline reads the
  dashboard trend series (AC-28), not just the two most recent runs; "Run all agents"
  must surface per-agent success/failure independently (AC-26). The per-agent
  recent-runs list is the two-run selection source for compare (checkboxes → "Compare"),
  so it must expose stable run_group ids per row. Imports the T18 compare modal (T18
  owns the modal; this task wires it).
- **Acceptance:** `cd client && pnpm exec vitest run
  src/app/evals/_components/EvalDashboard/EvalDashboard.test.tsx` and
  `.../AgentEvalDetail/AgentEvalDetail.test.tsx` green: the dashboard renders per-agent
  cards + the cross-agent recent-runs list (AC-17); `AgentEvalDetail` renders metric
  cards + trend AND its own per-agent recent-runs list, newest-first, showing every
  AC-15 field per row (ran-at, version, recall, precision, citation, pass count, cost);
  selecting exactly two runs in that list enables "Compare" and opens the T18 modal on
  the two selected run groups (AC-15/AC-18).

#### T18 — Compare-runs modal (deltas + cost + prompt diff + Promote)
- **Action:** A read-only modal: pick two runs → per-metric `old→new` with delta
  (recall/precision/citation), a cost `old→new` delta shown alongside (reported, not a
  headline judging metric), and a **diff of the two agent versions' system prompts**
  (AC-16). Exposes exactly one write — a "Promote vN" button that sets the active
  version to the newer of the two (AC-27), a no-op when the versions are equal (edge
  case). Uses `useCompareRuns` + `usePromoteVersion` (T12).
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`,
  `client-server-communication`
- **Owned paths:**
  `client/src/app/evals/_components/CompareRunsModal/CompareRunsModal.tsx`,
  `client/src/app/evals/_components/CompareRunsModal/CompareRunsModal.test.tsx`,
  `client/src/app/evals/_components/CompareRunsModal/index.ts`,
  `client/src/app/evals/_components/CompareRunsModal/styles.ts`
- **Depends-on:** T12, T13
- **Risk:** medium
- **Known gotchas:** the view is read-only except Promote (AC-16/AC-27); same-version
  compare → empty prompt diff + Promote no-op (edge cases); cost is displayed as a
  reported delta, never as a pass/fail metric.
- **Acceptance:** `cd client && pnpm exec vitest run
  .../CompareRunsModal/CompareRunsModal.test.tsx` green: renders per-metric old→new+delta
  and the prompt diff, Promote fires the mutation, and same-version input yields an empty
  diff + disabled/no-op Promote.

#### T19 — Wire FindingCard mutation invalidation & cross-surface refresh
- **Action:** Ensure a case created from a finding (T14) and runs triggered from the
  Evals tab (T15) / dashboard (T17) invalidate the shared query keys so the Evals tab,
  agent detail, and dashboard all reflect new cases/metrics without a manual refresh.
  This is the integration glue that the individual component tasks each assume; it lives
  in the hook layer already (T12) — this task only adds any missing cross-key
  invalidations discovered during integration and an integration test.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `client-server-communication`
- **Owned paths:** `client/src/lib/hooks/evals.test.tsx`
- **Depends-on:** T12, T14, T15, T17
- **Risk:** low
- **Known gotchas:** if a cross-key invalidation is missing in `evals.ts`, prefer fixing
  it inside T12's window; by Phase 5 `evals.ts` is owned by T12 — coordinate so only the
  test file is added here (no concurrent edit to `evals.ts`).
- **Acceptance:** `cd client && pnpm exec vitest run src/lib/hooks/evals.test.tsx` green:
  a create-from-finding mutation invalidates the case-list + dashboard keys.

#### T20 — End-to-end verification gate (server + client)
- **Action:** Run the full verification matrix and record results: `cd server &&
  pnpm typecheck && pnpm verify:l06 && pnpm exec vitest run .it.test` (DB-backed) and
  `cd client && pnpm typecheck && pnpm build && pnpm test`. No product files owned — this
  is the merge gate.
- **Module:** server + client
- **Type:** backend + ui
- **Skills to use:** `backend-onion-architecture`, `react-testing-library`
- **Owned paths:** (none — verification only)
- **Depends-on:** T8, T9, T10, T14, T15, T16, T17, T18, T19
- **Risk:** low
- **Known gotchas:** `verify:l06` must stay green with no keys/network; DB-backed tests
  need Docker Postgres (testcontainers).
- **Acceptance:** all listed commands exit 0; `cd server && pnpm verify:l06` green
  offline (AC-21).

#### T21 — Vendored-contract parity gate
- **Action:** Verify the three `src/vendor/shared/contracts/eval-ci.ts` copies
  (server/client/mcp) are byte-identical after T1 (and, if applicable, the barrels).
  Since no upstream generator exists, add a small check (script or CI step) that diffs
  the three copies and fails on divergence, and document the provenance risk in
  `server/INSIGHTS.md`.
- **Module:** server + client + mcp
- **Type:** core
- **Skills to use:** `typescript-expert`
- **Owned paths:** `server/scripts/check-vendor-parity.*` (new helper) or a documented
  `diff` command; `server/INSIGHTS.md` (append the provenance note)
- **Depends-on:** T1
- **Risk:** low
- **Known gotchas:** the vendored copies have no single source of truth — this gate is
  the only thing preventing silent drift; keep it cheap (a `diff` of the three files).
- **Acceptance:** running the check reports the three `eval-ci.ts` copies identical
  (exit 0); an intentional one-character divergence makes it fail.

## Testing strategy
- **Pure scorer (T3):** `cd server && pnpm exec vitest run src/modules/eval/scoring` —
  hermetic `*.test.ts`, per-function fixtures incl. AC-20 degraded inputs + AC-12
  reproducibility.
- **Run path / verify:l06 (T10):** `cd server && pnpm verify:l06` — hermetic, mock
  reviewer, no keys/network; asserts scoring math + AC-13 precision drop.
- **DB-backed server (T4/T6/T7):** `cd server && pnpm exec vitest run .it.test` —
  `*.it.test.ts` with testcontainers Postgres; repository history retention, service
  freeze/run/compare/promote, route `422` + round-trips.
- **Client (T11–T19):** `cd client && pnpm exec vitest run <path>` — jsdom, `fetch`
  mocked; component behavior + hook invalidation.
- **Full gate (T20):** server typecheck + verify:l06 + `.it.test`; client typecheck +
  build + test.

## Risks & mitigations
- Vendored contracts have no upstream source → drift across 3 copies. → Edit all three
  identically (T1) + a parity gate (T21).
- `eval_runs.case_id` cascade could erase history on case delete (AC-24). → Repository
  soft-excludes/de-references deleted cases (T4), proven by an `.it.test.ts`.
- Frozen diff is untrusted PR text (prompt-injection surface). → Stored/replayed as data
  only; rely on the existing reviewer guard, add no new steering path (T6, spec
  §Untrusted inputs).
- Freeze fidelity: `loadDiff` has a git-vs-pr_files fallback → replay must be stable. →
  Freeze the resolved text and rebuild via `parseUnifiedDiff` (T6).
- Client tree is large → split into foundation (T11–T13) / components (T14–T16) /
  page+wiring (T17–T19) with non-overlapping Owned paths and a single owner per shared
  file (`AgentEditor.tsx`→T15, `hooks/index.ts`→T12, `nav.ts`→T11).

## Red-flags check
- [x] Every requirement (R-AC1..R-AC28) maps to at least one task
- [x] No specification was authored or edited — SPEC-04 taken as input
- [x] Execution mode is recorded (multi-agent) and the plan is shaped for it
- [x] Dependencies form a DAG (no cycles) — see the DAG below
- [x] (multi-agent) Concurrent tasks have non-overlapping Owned paths (shared files
      `AgentEditor.tsx`, `hooks/index.ts`, `nav.ts`, `index.ts`, `seed.ts`,
      `package.json` each owned by exactly one task)
- [x] Every Acceptance is measurable (named test / command + expected result)
- [x] Contracts (T1) are defined before any task that depends on them (T3, T7, T12)
- [x] No edits to existing shared contract fields — only additions (T1)
- [x] `*/src/vendor/**` shared: added-to identically, not divergently; parity gated (T21)
- [x] No DB table deletions or edits to existing migrations — one new `0019` only (T2)
- [x] Failure & edge states owned: first-ever vs prior-artifact (T6 idempotent create +
      snapshot), partial/one-of-N isolation (T6/T17 run-all-agents AC-26), preserve-prior
      (T4 history retention AC-24, derived aggregate keeps prior per-case rows),
      in-progress/navigate-away (runs persist per-case rows; dashboard/history re-read on
      return — T4/T17), unavailable precondition (zero-case agent / empty diff score to
      defined metrics — T3 AC-20)

## Dependency DAG
```
T1 ─┬─ T3 ─┬─ T5 ─┐
    │       └──────┼─ T6 ─┬─ T7 ─ T8
T2 ─┴─ T4 ─────────┘      │
                          ├─ T9 (via T4)
                          └─ T10 (T3,T5,T6)
T1 ─ T21
T1 ─ T12 ─┬─ T14 ─┐
T11 ──────┤       │
T13 ──────┼─ T15 ─ T16
          │       │
          └─ T18 ─ T17 (T11,T12,T13,T18)
T12,T14,T15,T17 ─ T19
T8,T9,T10,T14,T15,T16,T17,T18,T19 ─ T20
```
Independent roots (no deps): T1, T2, T11, T13.
