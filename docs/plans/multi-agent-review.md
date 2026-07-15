# Implementation Plan: Multi-Agent Review

## Overview
Let a reviewer pick a curated set of enabled agents to run on a PR (from a lightweight
PR-page picker and a dedicated Configure-run page), preview an honest per-agent and total
time/cost estimate before launch, persist the fan-out as one *multi-agent run* grouping its
per-agent runs, and compare the results on a dedicated Multi-Agent Review page (Columns +
Tabs views) with a deterministic "Where agents disagree" grouping, live per-agent status,
per-agent trace links, and finding actions (Accept / Dismiss / Learn / Turn into eval case).
Sourced entirely from `specs/SPEC-05-2026-07-12-multi-agent-review.md` (approved); the review
engine (run-executor / agent-runner / `ci/`) is reused as-is and is out of bounds.

## Execution mode
**multi-agent (parallel)** — user-confirmed. The feature spans 2 packages and ~30 files with a
clean contract/DB seam. Shaped as a 5-phase DAG: Phase 1 foundation (migration + shared
contract + lifted match helper) is the serialized wire seam; Phases 2–4 fan out into
non-overlapping owned-path groups (server services/routes ∥ client foundation ∥ client
components); Phase 5 wires pages + the PR-page picker. Client build is split by sub-layer
(foundation → components → page/wiring), never one mega client agent.

## Requirements (verified)
Every AC below is restated from SPEC-05 and mapped to its owning task(s). "assumed default —
user confirmed" marks the 8 HOW decisions confirmed at the clarify gate.

**Navigation & entry (AC-1..2)**
- R-AC-1: Top-level nav entry "Multi-Agent Review" opens Configure-run with no PR pre-selected → **T11, T18**
- R-AC-2: PR-page agent picker (replaces the one-or-all dropdown) lists every enabled agent with a time/cost guideline + a checkbox, plus "Select all"/"Clear" → **T19** (estimates from **T5/T10**)

**PR-page launch flow (AC-3..5)**
- R-AC-3: 0 selected → run action disabled, labelled "Select an agent" → **T19**
- R-AC-4: exactly 1 selected → label "Run <agent name>", run as an inline single-agent review on the PR page, **no** multi-agent run (reuse existing `useRunReview` → `POST /pulls/:id/review {agentId}`) → **T19**
- R-AC-5: N>1 selected → label "Run multi-agent review (N)", launch a multi-agent run and navigate to the results page with PR + selected set reflected → **T19** (launch **T5/T10**, results **T18**)

**Configure-run page (AC-6..10)**
- R-AC-6: two-step flow (step 1 PR, step 2 agents) → **T14**
- R-AC-7: PR picker lists only eligible (non-stale) PRs → **T14**
- R-AC-8: no PR → gate step 2 behind empty state "Pick a pull request first" + disable run → **T14**
- R-AC-9: PR selected → each enabled agent as a selectable card (name, short summary, time/cost guideline) + "Select all"/"Clear all" → **T14**
- R-AC-10: ≥1 agent + run activated → launch multi-agent run for the selected PR/agents, navigate to results; a single-agent selection produces a valid multi-agent run with no disagree section → **T14** (launch **T5**, results **T18**)

**Pre-launch estimate (AC-11..14)**
- R-AC-11: agent with ≥1 recent completed run → estimate = mean of its recent completed runs → **T5** (compute), **T14** (display)
- R-AC-12: agent with no completed-run history → show "no history", exclude from total → **T5, T14**
- R-AC-13: PR + ≥1 agent → total estimate = **sum** of times and **sum** of costs → **T14** (Rec A honest math)
- R-AC-14: never describe a run as parallel in the estimate or anywhere in this feature's copy → **T12** (pinned strings), enforced in **T14/T18**

**Results shell / totals / switch (AC-15..18)**
- R-AC-15: results show PR number+title, agent count, total time = **sum** of durations, total cost = **sum** of costs → **T18** (MetaRow)
- R-AC-16: switch between Columns and Tabs, default Columns → **T18**
- R-AC-17: "Configure run" affordance returns to Configure with current PR + agent selection preserved → **T18** (passes `?pr=&agents=`), **T14** (reads them)
- R-AC-18: results opened with no agents → empty state "No agents selected" + "Configure run" CTA → **T18**

**Columns view (AC-19..20)**
- R-AC-19: one column per agent; header = identity + duration + cost + score → **T15**
- R-AC-20: each column lists that agent's findings (severity, title, file:line) + footer "View trace" + finding count → **T15**

**Tabs + detail + finding actions (AC-21..25)**
- R-AC-21: one tab per agent (name + score) + detail panel (score, summary, duration, cost, "View trace", findings) → **T16**
- R-AC-22: finding detail shows confidence + suggested fix + 4 actions (Accept, Dismiss, Learn, Turn into eval case) → **T16**
- R-AC-23: Accept/Dismiss persist the disposition and reflect it (reuse `POST /findings/:id/accept|dismiss`) → **T16**
- R-AC-24: "Turn into eval case" creates a durable "must find" eval case seeded from the finding + confirms (reuse existing `POST /findings/:id/eval-case`) → **T16** (see gotcha: needs a prior disposition)
- R-AC-25: "Learn" creates a durable memory record seeded from the finding, attributable to finding + producing agent, + confirms → **T6** (route), **T16** (action)

**"Where agents disagree" grouping (AC-26..30)**
- R-AC-26: ≥2 agents reviewed → group findings by code location (same file, overlapping inclusive line ranges), derived from persisted findings → **T5** (compute), **T17** (render)
- R-AC-27: per location, show every reviewing agent's verdict/severity or "did not flag" → **T5, T17**
- R-AC-28: "Show only conflicts" toggle hides locations where all reviewing agents agreed → **T17**
- R-AC-29: location is a conflict when ≥1 flagged and ≥1 other did not, OR agents assigned divergent severities → **T5** (classification)
- R-AC-30: <2 agents that **reviewed** (status `done` — failed/running excluded) → do not show the section → **T17** (gate on the reviewed/succeeded set) + **T18** (parent gate). Consistent with T5's "reviewing" definition and AC-34 (all-fail ⇒ hidden); a 2-dispatched/1-failed run has one reviewer ⇒ hidden.

**Live status / trace / failure isolation (AC-31..34)**
- R-AC-31: live per-agent status (running/done/failed) in column/tab header, updates without manual refresh (reuse live-log stream) → **T18** (`useRunEvents` + refetch), **T15/T16** (status render)
- R-AC-32: per-agent "View trace" opens that agent's run trace / live log (reuse existing trace surface) → **T15/T16** (+ **T18**)
- R-AC-33: one agent fails → mark its column/tab failed, keep presenting the others; whole run not failed → **T5** (tolerant aggregate), **T15/T16/T18**
- R-AC-34: every agent fails → present run as failed, each trace still inspectable; no disagreement section → **T5, T18** (+ **T17** reviewed-set gate)

**Persistence / revisiting / grouping (AC-35..39)**
- R-AC-35: exactly one agent run per selected agent, each associated with the one multi-agent run; persist each finding's producing-agent attribution → **T1** (column), **T4** (threading), **T5** (create via runReview)
- R-AC-36: on completion, persist the run so it can be retrieved + re-rendered (per-agent status/score/duration/cost/findings, totals, disagreement grouping) → **T1, T5** (grouping/totals derived on read)
- R-AC-37: opening a previously completed run renders it from persisted data in both views → **T18** (`/multi-agent/runs/[runId]`), **T5** (`GET /multi-agent-runs/:id`)
- R-AC-38: the individual agent runs also appear in the PR's normal per-agent run history → **T4** (rows created normally, still surfaced by existing `GET /pulls/:id/runs`)
- R-AC-39: do not add a grouped multi-agent-run entry to the PR page's reviews list → **T5, T19** (multi-run confined to its own routes/page)

**Confirmed HOW defaults (assumed default — user confirmed)**
- Q1: new `MultiAgentRunRequest` contract; `RunRequest` untouched (Rec B) → **T2**
- Q2: one batched estimates endpoint (`GET /multi-agent/estimates`); full `AgentStats` screen deferred (Non-goal) → **T5**
- Q3: non-blocking launch (rows pre-created), reuse per-agent SSE (`useRunEvents`) + refetch aggregate → **T5, T10, T18**
- Q4: `ConflictTake.note` = flagged → finding title/rationale; did-not-flag → empty → **T5**
- Q5: lift pure `rangesOverlap`+`normalizePath` to a shared location, eval re-exports → **T3**
- Q6: new minimal `memory` module + `POST /findings/:id/learn` → **T6**
- Q7: add a demo seed of a completed multi-agent run + agent-run history → **T9**
- Q8: deterministic client-side agent icon/color map (no schema change) → **T13**

## Open questions & recommendations
- Q1..Q8 → answered: all 8 defaults accepted (see above).
- Rec A → accepted: the exact honest copy strings are pinned in this plan (see "Pinned copy & honest-math overrides") and owned by **T12**; implementers must not copy the mock's "parallel"/"fan-out via worktrees"/"they run in parallel" wording or its `Math.max` time math.
- Rec B → accepted: `RunRequest` (`contracts/platform.ts`) is not edited; the multi-run request is a new contract beside the already-present `MultiAgentRun`.

## Affected modules & contracts
- **server / `@devdigest/api`** — new `multi-agent-review` module (launch/read/estimates), new minimal `memory` module (Learn); thread `multiAgentRunId` through the reviews run seam (`service.ts` + `run.repo.ts`) *without touching the executor*; new migration (`agent_runs.multi_agent_run_id`); lifted pure match helper; demo seed.
- **client / `@devdigest/web`** — new `/multi-agent` Configure page + `/multi-agent/runs/[runId]` results page and their `_components/`; replace the PR-page `RunReviewDropdown` with a new `AgentPicker`; new `multi-agent.ts` hooks; new `multiAgent.json` i18n; nav entry; deterministic agent-visuals util.
- **reviewer-core / e2e / mcp** — no code changes, EXCEPT the vendored-contract sync (below).
- **Contracts (new):** `MultiAgentRunRequest` added to `contracts/observability.ts` and its barrel, applied **identically** to all three vendored copies (`server/`, `client/`, `mcp/`). The existing `MultiAgentRun`, `AgentColumn`, `AgentColumnFinding`, `Conflict`, `ConflictTake` in that file are **reused as-is** (already present, currently unconsumed). `AgentStats` is left unconsumed (deferred). `RunRequest` is **not** changed.

## Architecture changes
- `server/src/modules/multi-agent-review/` — new Fastify plugin module (Presentation `routes.ts`; Application `service.ts`; Infrastructure `repository.ts`; pure Domain helpers `grouping.ts` + `estimate.ts`). Onion: routes → service → repository; `grouping.ts`/`estimate.ts` are pure (no I/O).
- `server/src/modules/memory/` — new minimal Fastify plugin module (`routes.ts` + `service.ts` + `repository.ts`).
- `server/src/modules/_shared/finding-match.ts` — new shared pure kernel holding `rangesOverlap` + `normalizePath`; `eval/scoring/match.ts` + `eval/scoring/normalize.ts` re-export from it (no behavior change), so `multi-agent-review` does not depend on the `eval` module.
- `client/src/app/multi-agent/page.tsx` (Configure, thin route) and `client/src/app/multi-agent/runs/[runId]/page.tsx` (results). Both thin; feature logic in colocated `_components/`. Data only through `client/src/lib/hooks/multi-agent.ts` → `client/src/lib/api.ts` (never raw `fetch`).

## Pinned copy & honest-math overrides (Rec A — normative; `AC-14`, `AC-15`, Non-functional)
The design mock ships dishonest wall-clock copy/math; use these instead. Anchor screen ids in
`scratchpad/design/`: `ScreenMultiAgent`+`RunConfig` = `8bb91114-…jsx`; picker
`RunReviewDropdown` = `0d4883bb-…jsx`; data shapes = `63fa1709-…jsx`.
- **Totals & estimate are the SUM, never `Math.max`.** Mock `MetaRow` (`8bb91114:44`) and `RunConfig` (`8bb91114:114`) both use `reduce(max)` → replace with `reduce((a,x)=>a+x,0)`.
- Configure subtitle: `"Pick a pull request and choose which agents to run — compare their findings side by side."` (NOT "fan out — they run in parallel").
- Estimate line (Configure): `"≈ <sumSeconds>s · $<sumCost> · <N> agents"` (NOT "· parallel fan-out"). Shown only when a PR and ≥1 agent are selected.
- Results meta row: `"<N> agents · <sumSeconds>s total · $<sumCost>"` (NOT "· fan-out via worktrees ·").
- Results header label: `"<N> selected agents"` (NOT "· parallel").
- Run-bar labels — **Configure page**: N>1 `"Run multi-agent review (N)"`; 1 `"Run 1 agent"`; 0 `"Select agents"` (disabled). **PR-page picker**: 0 `"Select an agent"` (disabled); 1 `"Run <agent name>"`; N>1 `"Run multi-agent review (N)"`.
- Empty states (verbatim from spec §Screens): results no-agents → title `"No agents selected"`, body `"Pick at least one agent to fan out this review. Configure the run to choose agents."`, CTA `"Configure run"`. Configure no-PR → title `"Pick a pull request first"`, body `"Choose which PR to review above, then select the agents to run on it."` (NB: "fan out" as *dispatch* is spec-approved copy; only "parallel"/simultaneity claims are forbidden.)
- Number formatting (mock-faithful): duration `(duration_ms/1000).toFixed(1)+"s"`; cost `"$"+cost.toFixed(2)`; score = integer via vendored `CircularScore`.

## Design → real primitive map (reuse; do NOT edit `vendor/**`)
All mock primitives already exist as real ports — reuse by import; the only sanctioned
`vendor/` edit in this plan is the `nav.ts` entry (T11).
- `CircularScore` → `client/src/vendor/ui/primitives/CircularScore.tsx` `{score,size?,stroke?}`; score color **>=75 ok / >=50 warn / else crit** (use this everywhere, incl. tab-label score — the mock's 70 threshold is drift).
- `SectionLabel` → `.../primitives/SectionLabel.tsx` `{children,icon?,right?}`; `Toggle` → `.../primitives/Toggle.tsx` `{on,onChange,size?}`; `EmptyState` → `.../primitives/EmptyState.tsx` `{icon?,title,body?,cta?,onCta?,ctaLoading?}`; `MonoLink` → `.../primitives/MonoLink.tsx` `{children,onClick?,href?}`; `Badge`/`SeverityBadge`/`CategoryTag` → `.../primitives/Badge.tsx`; `Button` → `.../primitives/Button.tsx`; `Dropdown` → `.../kit/Dropdown.tsx` `{trigger,items,align?,width?}`; `Icon`/`IconName` → `.../icons.tsx`; `LiveLogStream` → `.../LiveLogStream.tsx`.
- Severity tokens (`SEV`) → `client/src/vendor/ui/primitives/tokens.ts:6-14`: CRITICAL `--crit`/`AlertOctagon`, WARNING `--warn`/`AlertTriangle`, SUGGESTION `--sugg`/`Lightbulb`, INFO `--info`/`Info`. Category tokens (`CAT`) → same file.
- Full finding card → existing app component `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx` (composes vendored primitives; supports `onAction(accept|dismiss)`). The multi-agent Tabs card (T16) follows this composition pattern and **adds** Learn + Turn-into-eval-case actions in a new component — do not add a second copy to `vendor/`.

## Reviewed-agent set (AC-30 / AC-34 — normative)
"Reviewing"/"reviewed" agents = columns whose `AgentColumn.status === 'done'` (both `failed` and
`running` are excluded). This is the single definition used by **T5's** disagreement grouping
(per-location "did not flag" enumeration is over this set), by **T17's** ≥2 render gate, and by
**T18's** parent gate. Derived purely from `AgentColumn.status` — **no contract change**; the
client computes it as `columns.filter(c => c.status === 'done')`. Consequences: an all-fail run
(0 reviewed, AC-34) and a 2-dispatched/1-failed/1-succeeded run (1 reviewed) both **hide** the
disagreement section, never render it empty (AC-30).

## Phased tasks

### Phase 1 — Foundation / wire seam (serialized before dependents)

#### T1 — Migration: `agent_runs.multi_agent_run_id` FK
- **Action:** Add a nullable `multiAgentRunId` uuid column to `agent_runs` referencing `multi_agent_runs.id` (`onDelete: 'set null'`). `multi_agent_runs` already has `id/workspaceId/prId/ranAt` — sufficient; totals (duration/cost/agent_count) are **derived on read** from child rows, not stored. Run `pnpm db:generate` to emit the next numbered migration (`0020_*`) + snapshot; do not hand-write or edit any existing migration.
- **Module:** server · **Type:** backend
- **Skills to use:** drizzle-orm-patterns, postgresql-table-design
- **Owned paths:** `server/src/db/schema/runs.ts`, `server/src/db/migrations/0020_*.sql` (generated), `server/src/db/migrations/meta/*` (generated snapshot)
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** migrations are NOT applied on boot — after generate, run `cd server && pnpm db:migrate`. Never edit `0000`–`0019` or delete the empty `multi_agent_runs` stub.
- **Acceptance:** `cd server && pnpm db:generate` produces a `0020` migration whose SQL adds `agent_runs.multi_agent_run_id`; `pnpm db:migrate` applies clean against a fresh DB; `pnpm typecheck` passes.

#### T2 — New shared contract `MultiAgentRunRequest` (all 3 vendored copies)
- **Action:** Add `export const MultiAgentRunRequest = z.object({ agent_ids: z.array(z.string().uuid()).min(1) })` (+ inferred type) to `contracts/observability.ts` and re-export it from the shared barrel. Apply the **identical** edit to all three vendored copies (server, client, mcp). Reuse the existing `MultiAgentRun`/`AgentColumn`/`Conflict`/`ConflictTake` shapes unchanged. Do **not** touch `RunRequest`.
- **Module:** server + client + mcp (vendored contract) · **Type:** backend
- **Skills to use:** zod, client-server-communication
- **Owned paths:** `server/src/vendor/shared/contracts/observability.ts`, `client/src/vendor/shared/contracts/observability.ts`, `mcp/src/vendor/shared/contracts/observability.ts`, and the barrel/index in each `src/vendor/shared/` that re-exports the contract (mirror whatever the existing `MultiAgentRun` export uses).
- **Depends-on:** none
- **Risk:** medium
- **Known gotchas:** **vendored-contract sync** (root `INSIGHTS.md` ~109-162) — there is no sync script; the three copies MUST be byte-identical or the packages desync silently. This is the single sanctioned `vendor/shared` edit in the plan (a new contract, no existing-contract change).
- **Acceptance:** `MultiAgentRunRequest` importable from `@devdigest/shared` in all three packages; `cd server && pnpm typecheck`, `cd client && pnpm typecheck`, `cd mcp && pnpm typecheck` all pass; a grep confirms the three files' new blocks are identical.

#### T3 — Lift the pure match helper to a shared kernel
- **Action:** Create `server/src/modules/_shared/finding-match.ts` exporting `rangesOverlap(a,b)` and `normalizePath(p)` (moved verbatim from `eval/scoring/match.ts` + `eval/scoring/normalize.ts`). Update `eval/scoring/match.ts` and `eval/scoring/normalize.ts` to re-export from the shared kernel (keep `matchFinding` + `ScorableFinding` in the eval file — they depend on eval types). No behavior change.
- **Module:** server · **Type:** backend
- **Skills to use:** backend-onion-architecture
- **Owned paths:** `server/src/modules/_shared/finding-match.ts` (new), `server/src/modules/eval/scoring/match.ts`, `server/src/modules/eval/scoring/normalize.ts`
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** keeps `multi-agent-review` from importing the `eval` module (avoids module→module coupling per onion); the grouping in T5 consumes this kernel, not eval's.
- **Acceptance:** `cd server && pnpm exec vitest run modules/eval` (existing eval unit tests) stays green; `pnpm typecheck` passes; `rangesOverlap`/`normalizePath` importable from `modules/_shared/finding-match.js`.

### Phase 2 — Server services, routes, seed (depend on Phase 1)

#### T4 — Thread `multiAgentRunId` through the run seam (executor untouched)
- **Action:** Add optional `multiAgentRunId?: string | null` to `createAgentRun` (`run.repo.ts`) and set it on the `agent_runs` insert. Add an optional trailing `multiAgentRunId?: string` param to `ReviewService.runReview` (`service.ts`) and pass it into each `createAgentRun` call in the up-front row-creation loop. Do **not** modify `run-executor.ts`/`executeRuns` or the execution loop — only the row-creation seam.
- **Module:** server · **Type:** backend
- **Skills to use:** backend-onion-architecture, drizzle-orm-patterns
- **Owned paths:** `server/src/modules/reviews/repository/run.repo.ts`, `server/src/modules/reviews/service.ts`
- **Depends-on:** T1
- **Risk:** medium
- **Known gotchas:** rows are created BEFORE the fire-and-forget executor (`service.ts:114-129`), so the `multiAgentRunId` must be set at insert time. `runReview` must keep returning `runIds` immediately (non-blocking) — do not `await` the executor. Individual `agent_runs` still carry `prId`, so they keep appearing in `GET /pulls/:id/runs` (AC-38).
- **Acceptance:** `cd server && pnpm exec vitest run modules/reviews` passes incl. a new case asserting `createAgentRun` persists `multiAgentRunId`; `runReview(..., multiAgentRunId)` returns the run ids synchronously; `pnpm typecheck` passes.

#### T5 — `multi-agent-review` module: service + repository + grouping + estimate + routes
- **Action:** New Fastify plugin module. Routes (schema-first via `fastify-type-provider-zod`, no hand-rolled parsing):
  - `POST /pulls/:id/multi-agent-run` (body `MultiAgentRunRequest`, tight rate limit like `/pulls/:id/review`): create a `multi_agent_runs` row; resolve targets = workspace enabled agents filtered to `agent_ids` (404 if none valid); call `ReviewService.runReview(ws, prId, targets, req.log, multiAgentRunId)`; return `{ run_id: <multiAgentRunId>, pr_id }` immediately (non-blocking).
  - `GET /multi-agent-runs/:id` → build and return a `MultiAgentRun`: `columns` from `agent_runs` where `multiAgentRunId=:id` (status/score/durationMs/costUsd/provider/model/agentId+name) each joined to its `reviews`(by `runId`)→`findings` (mapped to `AgentColumnFinding`); `total_duration_ms`/`total_cost_usd` = **SUM** over columns; `agent_count` = column count; `conflicts` computed by `grouping.ts` from the persisted findings **at read time** (never stored).
  - `GET /multi-agent/estimates` → for each enabled agent, `estimate.ts` returns `{ agent_id, agent_name, avg_latency_ms, avg_cost_usd, runs }` = mean of that agent's recent completed (`status='done'`) `agent_runs`; `runs=0` ⇒ nulls (client shows "no history").
  - `grouping.ts` (pure): cluster findings by `normalizePath(file)` + inclusive line-range overlap (`rangesOverlap` from T3); for each cluster emit a `Conflict{file,line,title,takes[]}` with a `ConflictTake` **for every agent that reviewed the run** (= the reviewed set, `status==='done'`) — flagged → `verdict=severity`, `note=finding.title` (fallback `rationale`); reviewed-but-not-here → `verdict='ignored'`, `note=''`. Classify a cluster as a conflict when ≥1 flagged and ≥1 other reviewing agent did not, OR severities diverge (AC-29). Failed/running agents contribute no findings and are NOT enumerated as "did not flag" (they are not in the reviewed set — see "Reviewed-agent set").
  - `service.ts` orchestrates; `repository.ts` holds all Drizzle reads/writes. Run status is **derived**: all columns failed ⇒ run failed (AC-34); otherwise present survivors (AC-33).
- **Module:** server · **Type:** backend
- **Skills to use:** fastify-best-practices, backend-onion-architecture, drizzle-orm-patterns, zod, client-server-communication, security
- **Owned paths:** `server/src/modules/multi-agent-review/routes.ts`, `server/src/modules/multi-agent-review/service.ts`, `server/src/modules/multi-agent-review/repository.ts`, `server/src/modules/multi-agent-review/grouping.ts`, `server/src/modules/multi-agent-review/estimate.ts`, plus test files `*.test.ts` / `*.it.test.ts` in that dir
- **Depends-on:** T2, T3, T4
- **Risk:** high
- **Known gotchas:** does NOT edit `modules/index.ts` (registration is T8, to avoid owned-path overlap with T6). The **reviewed set** = columns with `status==='done'` (failed AND running excluded) — grouping enumerates "did not flag" only over this set, and the client gates the disagree section on the same `columns.filter(c => c.status==='done').length >= 2` (T17/T18), so an all-fail run and a 2-dispatched/1-failed run both hide the section (AC-30/AC-34); no contract change needed. Estimate mirrors `SkillsRepository.getStats` aggregation style (`skills/repository.ts:143-183`) — count rows in SQL, do percentage/mean math in a pure helper; guard `inArray(col, [])` with a `false` predicate. Foreign PR/finding text is display **data only** — grouping matches on normalized paths + numeric ranges, never on model interpretation of text (`security`, Untrusted inputs). A second launch on the same in-progress PR creates a **new** `multi_agent_runs` row (never reuses/overwrites) — both remain retrievable by id.
- **Acceptance:** unit: `pnpm exec vitest run modules/multi-agent-review` covers grouping (AC-26/27/29 incl. did-not-flag empty note, divergent-severity conflict, and that a failed/running agent is NOT enumerated as "did not flag") and estimate (AC-11 mean, AC-12 no-history→null+excluded, AC-13 sum). Integration: `pnpm exec vitest run .it.test` (testcontainers) seeds a multi-run and asserts `GET /multi-agent-runs/:id` returns columns+findings+summed totals (AC-36/37), one-fails-others-succeed keeps survivors + excludes the failed agent from the reviewed set (AC-33), all-fail marks the run failed with an empty reviewed set (AC-34). `pnpm typecheck` passes.

#### T6 — `memory` module: `POST /findings/:id/learn` (AC-25)
- **Action:** New minimal Fastify plugin. `POST /findings/:id/learn` (schema-first `IdParams`): load the finding + its `reviews` row (for `agentId`, `prId`); resolve the PR's `repoId` and agent name; insert one `memory` row: `scope='repo'`, `kind='learning'`, `content` = the finding's title + rationale (stored as plain **data**), `confidence` = finding.confidence, `sources` = `[{ pr: <prNumber>, context: 'learned from a <severity> finding by <agentName>' }]`, `embedding` null (no LLM). Return `{ memory_id }`. 404 if finding not found.
- **Module:** server · **Type:** backend
- **Skills to use:** fastify-best-practices, backend-onion-architecture, drizzle-orm-patterns, security
- **Owned paths:** `server/src/modules/memory/routes.ts`, `server/src/modules/memory/service.ts`, `server/src/modules/memory/repository.ts`, plus `*.it.test.ts` in that dir
- **Depends-on:** none (memory table already exists; reads existing findings/reviews)
- **Risk:** medium
- **Known gotchas:** does NOT edit `modules/index.ts` (T8 registers it). The record must be persisted **as data**, never as instructions (Untrusted inputs) — a plain text insert satisfies this; defining the downstream read-time guard is the consuming feature's concern, not this one. No new outbound LLM call (Non-functional "No added model cost").
- **Acceptance:** `cd server && pnpm exec vitest run .it.test` includes a case: POST against a seeded finding inserts a `memory` row with `kind='learning'`, content derived from the finding, and `sources` referencing the producing agent + PR; a missing finding id → 404. `pnpm typecheck` passes.

#### T7 — (folded into T5) batched estimates endpoint
- Covered by `GET /multi-agent/estimates` + `estimate.ts` in **T5**. No separate task; listed for AC traceability (AC-11/12/13 source). The full `AgentStats` per-agent-stats screen and `GET /agents/:id/stats` remain **out of scope** (SPEC Non-goal).

#### T8 — Register the two new modules
- **Action:** Add two imports + two keys (`multiAgentReview`, `memory`) to the `modules` registry in `server/src/modules/index.ts` (single edit, avoids both T5 and T6 touching this file).
- **Module:** server · **Type:** backend
- **Skills to use:** fastify-best-practices
- **Owned paths:** `server/src/modules/index.ts`
- **Depends-on:** T5, T6
- **Risk:** low
- **Known gotchas:** plugins register statically here (no filesystem autoload); routes are declared with full paths (no prefix), so `GET /multi-agent/estimates` and `GET /agents/:id` (agents module) do not collide.
- **Acceptance:** `cd server && pnpm dev` boots with both modules; `pnpm typecheck` passes; a smoke check that the three new routes + `POST /findings/:id/learn` are registered (e.g. an integration test hitting them returns non-404).

#### T9 — Demo seed: one completed multi-agent run + agent-run history
- **Action:** Extend `server/src/db/seed.ts` (idempotent, guarded like the existing agent seed) to insert, for the seeded PR, a `multi_agent_runs` row plus a handful of completed `agent_runs` (status `done`, populated `durationMs`/`costUsd`/`score`, `multiAgentRunId` set) for ≥2 of the 5 seeded agents, each with a `reviews` row + a few `findings` (including at least one overlapping file:line pair across two agents so the disagree grouping renders, and one divergent-severity pair). This makes estimates non-"no history" and the results page demoable on a fresh DB.
- **Module:** server · **Type:** backend
- **Skills to use:** drizzle-orm-patterns
- **Owned paths:** `server/src/db/seed.ts` (and a colocated `seed-multi-agent.ts` helper if the block is large)
- **Depends-on:** T1
- **Risk:** low
- **Known gotchas:** guard with existence checks (the seed is re-run). Keep costs/durations realistic so the summed estimate/total look sane. Seed at least two agents as `status='done'` so the reviewed set is ≥2 and the disagree section renders. This is dev data only — no schema change beyond T1.
- **Acceptance:** `cd server && pnpm db:seed` inserts a multi-agent run with ≥2 `done` agent columns + findings; afterwards `GET /multi-agent/estimates` returns non-null estimates for the seeded agents and `GET /multi-agent-runs/:id` returns a populated run with a non-empty `conflicts` array; re-running the seed does not duplicate.

### Phase 3 — Client foundation (parallelizable; depend on the contract/routes)

#### T10 — Client hooks `multi-agent.ts`
- **Action:** New hook module. `useAgentEstimates()` → `GET /multi-agent/estimates`. `useLaunchMultiAgentRun()` (mutation) → `POST /pulls/:id/multi-agent-run` with `MultiAgentRunRequest` body, returns `{ run_id }`. `useMultiAgentRun(runId)` → `GET /multi-agent-runs/:id`, typed `MultiAgentRun`, with `refetchInterval` while any column status is `running` (mirrors `usePrRuns`'s self-clearing poll) so per-agent duration/cost/score/findings fill in as agents complete. `useLearnFinding()` → `POST /findings/:id/learn`. `useCreateEvalCaseFromFinding()` → `POST /findings/:id/eval-case` (reuse). Live per-agent status reuses the existing `useRunEvents(runIds[])` (already subscribes to N agent-run ids in parallel) — no new hook. All calls via `api.*`, never raw `fetch`.
- **Module:** client · **Type:** ui
- **Skills to use:** react-best-practices, client-server-communication
- **Owned paths:** `client/src/lib/hooks/multi-agent.ts`
- **Depends-on:** T2 (contract types)
- **Risk:** low
- **Known gotchas:** query keys are inline arrays (repo convention) — e.g. `["multi-agent-run", runId]`, `["agent-estimates"]`. On launch success, invalidate `["pr-runs", prId]` so the PR history (AC-38) refreshes.
- **Acceptance:** `cd client && pnpm typecheck` passes; hooks are typed against `MultiAgentRun` / `MultiAgentRunRequest`; a hook test (fetch mocked) confirms `useMultiAgentRun` stops polling once all columns are non-running.

#### T11 — Nav entry (sanctioned `vendor/` exception)
- **Action:** Append a `{ key: "multi-agent", label: "Multi-Agent Review", icon: <IconName>, href: "/multi-agent", gKey: "m" }` item to `NAV` in `client/src/vendor/ui/nav.ts` (SKILLS LAB section, near Agents) and a matching `SHORTCUTS` entry ("Go to Multi-Agent Review"). The reserved active-key `"multi-agent"` (`app-shell/helpers.ts:28`) and i18n label (`messages/en/shell.json:26`) already exist — reuse them; do NOT edit those two files.
- **Module:** client · **Type:** ui
- **Skills to use:** ui-frontend-architecture
- **Owned paths:** `client/src/vendor/ui/nav.ts`
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** editing `vendor/**` is normally forbidden; this is the **one sanctioned scoped exception** (precedent: `docs/plans/project-context-nav-entry.md`). Pick a free `gKey` (verify `m` is unused in `SHORTCUTS`) and a valid `IconName` from `icons.tsx` (e.g. `Users` or `Boxes`). `href: "/multi-agent"` is top-level (not `repoScoped`) so AC-1 opens with no PR.
- **Acceptance:** `cd client && pnpm typecheck` + `pnpm test` pass; the sidebar renders "Multi-Agent Review" linking to `/multi-agent`; `activeKeyFor("/multi-agent")` already returns `"multi-agent"` (existing helper) so the item highlights.

#### T12 — i18n namespace `multiAgent.json` (honest copy)
- **Action:** Add `client/messages/en/multiAgent.json` containing every user-facing string for this feature, using the exact honest wording from "Pinned copy & honest-math overrides" (no "parallel"/"fan-out via worktrees"/"they run in parallel"). Register the namespace in the next-intl message loader if namespaces are enumerated there (verify the client i18n request config; if it auto-loads all files in `messages/<locale>/`, no registration is needed).
- **Module:** client · **Type:** ui
- **Skills to use:** next-best-practices, ui-frontend-architecture
- **Owned paths:** `client/messages/en/multiAgent.json` (+ the i18n loader config file only if it enumerates namespaces)
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** strings come from messages, not hard-coded JSX (client convention). AC-14 is satisfied here at the source — the components in T14/T18 must consume these keys, never inline the mock copy.
- **Acceptance:** `useTranslations("multiAgent")` resolves all keys in the components that consume them; `cd client && pnpm typecheck` + `pnpm test` pass; a grep confirms the file contains none of the forbidden words ("parallel", "fan-out via worktrees").

#### T13 — Deterministic agent icon/color map
- **Action:** New util `client/src/lib/agent-visuals.ts`: `agentVisual(agent: {id: string; name: string}) → { color: string; icon: IconName }`. Deterministic — keyword-match common names to the design palette (Security→`Shield`/`#ef4444`, Performance→`Zap`/`#f59e0b`, mentor→`Lightbulb`/`#3b82f6`, customer→`Users`/`#8b5cf6`, architecture→`Boxes`/`#10b981`) with a stable hash-of-id fallback into that palette. No schema change; no server field.
- **Module:** client · **Type:** ui
- **Skills to use:** ui-frontend-architecture, react-best-practices
- **Owned paths:** `client/src/lib/agent-visuals.ts`, `client/src/lib/agent-visuals.test.ts`
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** agents have no icon/color column (`db/schema/agents.ts`) — the design colours them, so this is purely client-side and must be stable across renders (same id ⇒ same visual). Icons must be valid `IconName`s.
- **Acceptance:** `cd client && pnpm test` passes a unit test asserting stable, valid mappings for the 5 seeded agent names + an arbitrary id; `pnpm typecheck` passes.

### Phase 4 — Client components (parallelizable; non-overlapping component dirs)

#### T14 — Configure-run components (`RunConfig`, `PersonaPickCard`)
- **Action:** Build the Configure-run subtree per `RunConfig` (`8bb91114:107-148`): H1 "Run a Multi-Agent Review" + honest subtitle; step 1 = circle "1" + "Pull request" + `Dropdown` (width 420) whose trigger is a secondary `Button` (icon `GitPullRequest`/`ChevronDown`) showing `"#<n> · <title>"` or `"Select a pull request…"`, items = the PR list **filtered to non-stale** (AC-7); step 2 = circle "2" (accent when a PR is chosen, muted otherwise) + "Agents to run" + "Select all"/"Clear all" (only when a PR is chosen). When no PR: the dashed empty state ("Pick a pull request first" + body, AC-8) and a disabled run bar. When a PR is chosen: a `PersonaPickCard` per enabled agent (checkbox tinted the agent color when on, agent icon tile, name, short summary, right-aligned mono guideline = its estimate or `"no history"` per AC-11/12) (AC-9). Run bar = primary `Button` (icon `Users`) with the **Configure-page** label logic + the honest estimate span (SUM, AC-13) shown only when a PR and ≥1 agent are selected. Accept `preselectedPr`/`preselectedAgents` props (for AC-17). The launch handler + navigation live in the page (T18); this component raises `onRun(prId, agentIds)`.
- **Module:** client · **Type:** ui
- **Skills to use:** react-best-practices, next-best-practices, ui-frontend-architecture
- **Owned paths:** `client/src/app/multi-agent/_components/RunConfig/**` (component, `PersonaPickCard`, `constants.ts`, `styles.ts`, `index.ts`, `*.test.tsx`)
- **Depends-on:** T10 (estimates hook), T12 (copy), T13 (visuals)
- **Risk:** medium
- **Known gotchas:** PR list source = reuse the existing PRs hook/endpoint; filter `status==='stale'` out client-side (AC-7). Estimate math is the SUM, computed in ms then `/1000` (Rec A) — agents with `"no history"` are excluded from the total. Never render the mock's "· parallel fan-out".
- **Acceptance:** `cd client && pnpm test` covers AC-6 (two steps), AC-7 (stale PRs absent), AC-8 (gate + disabled run + title), AC-9 (card fields + select-all/clear-all), AC-12 (a no-history agent shows "no history" and is excluded from the summed estimate), AC-13 (total = sum), and the run-bar label transitions 0→"Select agents"(disabled) / 1→"Run 1 agent" / N→"Run multi-agent review (N)".

#### T15 — Columns view (`ColumnsView`, `AgentColHeader`, `AgentFindingMini`)
- **Action:** Per `ColumnsView` (`8bb91114:52-65`): CSS grid `repeat(cols, minmax(220px,1fr))` with `cols = n<=5 ? n : 5` and `overflowX:auto` when n>5. Each column = a card with a 2px top border in the agent color; header `AgentColHeader` = icon tile (T13) + name + mono `"<dur>s · $<cost>"` + `CircularScore` (AC-19); body = that agent's findings as `AgentFindingMini` (severity icon + 2px left border in `SEV` color + title + mono `file:start_line`); footer = `MonoLink` "View trace" + `"<n> findings"` (AC-20). A running column shows live status (AC-31) and a failed column shows a failed state (AC-33) in its header; zero-findings columns render an empty body + count 0 (edge). "View trace" opens the agent's trace (AC-32) — reuse the existing trace/live-log surface (`RunTraceDrawer` / `LiveLogStream`) keyed on the agent's `run_id`.
- **Module:** client · **Type:** ui
- **Skills to use:** react-best-practices, ui-frontend-architecture
- **Owned paths:** `client/src/app/multi-agent/_components/ColumnsView/**` (`ColumnsView`, `AgentColHeader`, `AgentFindingMini`, `styles.ts`, `index.ts`, `*.test.tsx`)
- **Depends-on:** T10, T12, T13
- **Risk:** medium
- **Known gotchas:** consume `AgentColumn` from the contract; map `status ∈ {done,failed,running}` to header state. `View trace` reuses the existing surface — do not build a new trace viewer.
- **Acceptance:** `cd client && pnpm test` covers AC-19 (one column/agent; header identity+dur+cost+score), AC-20 (findings show sev+title+file:line; footer has View trace + count), a failed column renders a failed state (AC-33), and a zero-findings column renders an empty body with count 0.

#### T16 — Tabs + detail view + multi-agent finding card (4 actions)
- **Action:** Per `TabsView` (`8bb91114:67-91`): a tab per agent (icon + name + score tinted by the CircularScore threshold; active tab underlined in the agent color) (AC-21); detail panel = `CircularScore` 44 + agent name (in agent color) + summary + right-side `MonoLink` "View trace" + mono `"<dur>s · $<cost>"`, then the finding cards. Build a **new** `MultiAgentFindingCard` (following the existing `FindingCard` composition pattern, not editing it) that shows the finding's confidence + suggested fix and offers **Accept / Dismiss / Learn / Turn into eval case** (AC-22). Accept/Dismiss → `useFindingAction` (existing, AC-23); Learn → `useLearnFinding` (T10/T6, AC-25); Turn into eval case → `useCreateEvalCaseFromFinding` (T10, AC-24). Each action confirms via `notify`/toast and reflects the new state.
- **Module:** client · **Type:** ui
- **Skills to use:** react-best-practices, ui-frontend-architecture
- **Owned paths:** `client/src/app/multi-agent/_components/TabsView/**` (`TabsView`, `MultiAgentFindingCard`, `styles.ts`, `index.ts`, `*.test.tsx`)
- **Depends-on:** T10, T12, T13
- **Risk:** medium
- **Known gotchas:** **AC-24 constraint** — `POST /findings/:id/eval-case` derives the "must find"/"must not flag" expectation from the finding's disposition and returns `no_decision` (422/ValidationError) if the finding has not been accepted/dismissed yet. So "Turn into eval case" must ensure a disposition first (simplest: Accept then create, or gate the action until Accept/Dismiss) and surface the 422 as a helpful message rather than a raw error. Confirm the outcome to the user (AC-24). Score-color threshold = the vendored 75/50 (not the mock's 70).
- **Acceptance:** `cd client && pnpm test` covers AC-21 (tab per agent + detail fields), AC-22 (confidence + suggested fix + all four actions present), AC-23 (Accept/Dismiss reflect the new disposition), AC-24 (Turn-into-eval-case calls the eval-case endpoint and confirms; the no-decision path shows a helpful message), AC-25 (Learn calls `/findings/:id/learn` and confirms).

#### T17 — "Where agents disagree" section (`ConflictsSection`)
- **Action:** Per `ConflictsSection` (`8bb91114:21-40`): `SectionLabel` (icon `Activity`) "Where agents disagree" with a right-aligned "Show only conflicts" + `Toggle`. Each `Conflict` row = a card with header (Code icon + mono `file:line` + title) and a grid `repeat(takes.length, 1fr)` of takes; each take = agent/persona name, a status dot (`SEV` color when flagged, muted when not), an uppercase severity **or** a muted "did not flag", and the note (AC-27). The toggle, when on, hides locations where all reviewing agents agreed (AC-28). **Gate: render nothing unless ≥2 agents actually reviewed** — i.e. `columns.filter(c => c.status === 'done').length >= 2` (the reviewed/succeeded set, see "Reviewed-agent set"), NOT total dispatched `columns`/`agent_count` (AC-30). Both this render gate and the per-location "did not flag" enumeration operate over that reviewed set, matching T5's grouping semantics — so an all-fail run (0 reviewed, AC-34) and a 2-dispatched/1-failed/1-succeeded run (1 reviewed) both hide the section rather than render it empty. The parent (T18) applies the same gate; this component must also no-op defensively.
- **Module:** client · **Type:** ui
- **Skills to use:** react-best-practices, ui-frontend-architecture
- **Owned paths:** `client/src/app/multi-agent/_components/ConflictsSection/**` (`ConflictsSection`, `styles.ts`, `index.ts`, `*.test.tsx`)
- **Depends-on:** T10, T12, T13
- **Risk:** low
- **Known gotchas:** consume `Conflict`/`ConflictTake` from the contract; classification/grouping is done server-side (T5) — this component is display-only over foreign text (data, never instructions). "did not flag" uses `verdict==='ignored'`. The ≥2 gate counts **reviewed (`status==='done'`)** columns, never total dispatched columns.
- **Acceptance:** `cd client && pnpm test` covers AC-26/27 (one row per grouped location; every reviewing agent shows a verdict or muted "did not flag"), AC-28 (toggle hides all-agreed locations), and the reviewed-set gate (AC-30/AC-34): the section is hidden when fewer than two columns are `done` — asserted explicitly for (a) a <2-dispatched run, (b) an all-failed run (0 done), and (c) a 2-dispatched run where one agent failed and one succeeded (1 done).

### Phase 5 — Pages + wiring

#### T18 — Multi-agent pages (Configure + results) assembly & live status
- **Action:** Two thin routes. `client/src/app/multi-agent/page.tsx` = Configure-run shell: renders `RunConfig` (T14), reads `?pr=&agents=` to preselect (AC-17), and on `onRun(prId, agentIds)` calls `useLaunchMultiAgentRun` then `router.push('/multi-agent/runs/<run_id>')` (AC-10; AC-1 = opens with no PR when no query). `client/src/app/multi-agent/runs/[runId]/page.tsx` = results: `useMultiAgentRun(runId)`; header with a "Configure run" affordance linking back to `/multi-agent?pr=<prId>&agents=<ids>` (AC-17), title "Multi-Agent Review", `"<N> selected agents"` label, and a Columns/Tabs segmented switch defaulting to **Columns** (AC-16); `MetaRow` with PR #+title and `"<N> agents · <sumSec>s total · $<sumCost>"` (AC-15, SUM); then `ColumnsView` (T15) or `TabsView` (T16), each followed by `ConflictsSection` (T17) only when **≥2 columns have status `done`** (the reviewed set = `columns.filter(c => c.status === 'done').length >= 2`, see "Reviewed-agent set") — so all-failed runs (AC-34) and partial-failure runs that leave a single reviewer both hide the section (AC-30). Live status (AC-31): pass the running columns' `run_id`s to `useRunEvents` and let `useMultiAgentRun`'s poll refetch the aggregate as agents complete; all-failed ⇒ present the run as failed but keep traces open (AC-34). No-agents run ⇒ the "No agents selected" empty state + "Configure run" CTA (AC-18). A run opened later renders purely from persisted data (AC-37); a run in progress survives navigate-away because rows + the fire-and-forget executor are server-side and orphans are reaped on boot.
- **Module:** client · **Type:** ui
- **Skills to use:** next-best-practices, react-best-practices, ui-frontend-architecture, client-server-communication
- **Owned paths:** `client/src/app/multi-agent/page.tsx`, `client/src/app/multi-agent/runs/[runId]/page.tsx`, `client/src/app/multi-agent/_components/MetaRow/**`, `client/src/app/multi-agent/_components/ResultsHeader/**`, `client/src/app/multi-agent/layout.tsx` (if a shared breadcrumb/frame is needed), plus `*.test.tsx`
- **Depends-on:** T10, T11, T12, T13, T14, T15, T16, T17
- **Risk:** medium
- **Known gotchas:** the mock's `AppFrame active:"personas"` is wrong — the real active key is `"multi-agent"` (already reserved). Default view is Columns. Totals are SUM (Rec A). The disagree-section gate counts **reviewed (`status==='done'`)** columns, not total dispatched columns (AC-30/AC-34). Do not re-fetch-block navigation; the results page reads persisted state first, layers live SSE on top.
- **Acceptance:** `cd client && pnpm test` covers AC-1 (Configure opens with no PR), AC-15 (meta totals = sum), AC-16 (switch defaults Columns), AC-17 (Configure affordance carries pr+agents in the query), AC-18 (no-agents empty state), AC-31 (headers update from streamed status without manual refresh — mocked SSE/refetch), AC-30/AC-34 (the disagree section is hidden when fewer than two columns are `done` — asserted for an all-failed run AND a 2-dispatched run where only one agent succeeded, while surviving columns still render and traces stay linkable), AC-37 (a persisted run renders in both views). `pnpm typecheck` passes.

#### T19 — PR-page picker replacement + launch wiring (replaces `RunReviewDropdown`)
- **Action:** Build a new `AgentPicker` (mock `RunReviewDropdown`, `0d4883bb:24-65`): header "Pick agents to run"; a checkbox row per enabled agent with its time/cost guideline (from `useAgentEstimates`, T10) + "Select all"/"Clear"; footer "Configure agents…" → `/agents` (Resolved decision). Primary button label logic (**PR-page** variant): 0 → "Select an agent" (disabled, AC-3); 1 → "Run <agent name>" → runs inline via existing `useRunReview({prId, agentId})`, **no** multi-agent run, keeping today's inline SSE/accordion behavior (AC-4); N>1 → "Run multi-agent review (N)" → `useLaunchMultiAgentRun` then `router.push('/multi-agent/runs/<run_id>')` (AC-5). Swap `RunReviewDropdown` for `AgentPicker` in `PrDetailHeader` and adjust the PR-page `page.tsx` wiring (the existing `onRunsStarted(runIds)` SSE hand-off stays for the single-agent path).
- **Module:** client · **Type:** ui
- **Skills to use:** react-best-practices, ui-frontend-architecture, client-server-communication
- **Owned paths:** `client/src/app/repos/[repoId]/pulls/[number]/_components/AgentPicker/**` (new), `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`, and `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/**` (remove once unreferenced)
- **Depends-on:** T10, T12, T13 (and the results route from T18 for the N>1 navigation target — soft dependency; the push target is a static path so it need not block, but land after T18 to test the full flow)
- **Risk:** medium
- **Known gotchas:** AC-4 vs AC-10 asymmetry — 1 agent **from the picker** must NOT create a multi-agent run (inline only); 1 agent from Configure DOES. Do NOT add a grouped multi-agent-run entry to the PR reviews list (AC-39); the individual agent runs still appear in the run history via the unchanged `GET /pulls/:id/runs` (AC-38). Reuse `useAgents` for the enabled list (as `RunReviewDropdown` does).
- **Acceptance:** `cd client && pnpm test` covers AC-2 (enabled agents + guideline + checkbox + select-all/clear), AC-3 (disabled + "Select an agent"), AC-4 (1 agent → inline `useRunReview`, no navigation, no multi-run), AC-5 (N>1 → launch + navigate to `/multi-agent/runs/…`), and asserts the picker adds nothing to the reviews list (AC-39). `pnpm typecheck` passes.

## Testing strategy
- **server (hermetic unit):** `cd server && pnpm exec vitest run modules/multi-agent-review` — grouping/conflict classification incl. reviewed-set exclusion of failed/running agents (AC-26/27/29/34), estimate mean/no-history/sum (AC-11/12/13). Plus the lifted-helper regression `pnpm exec vitest run modules/eval` (T3).
- **server (DB-backed, `.it.test.ts`, testcontainers):** `cd server && pnpm exec vitest run .it.test` — threaded `multiAgentRunId` persistence (AC-35), `GET /multi-agent-runs/:id` aggregate + summed totals + revisit (AC-36/37), one-fails-others (AC-33), all-fail run + empty reviewed set (AC-34), `POST /findings/:id/learn` insert + attribution (AC-25), route registration smoke (T8). DB-backed tests MUST use the `.it.test.ts` suffix.
- **client (vitest + jsdom, `fetch` mocked):** `cd client && pnpm test` — per-component tests colocated with T13–T19 covering AC-1..AC-30/AC-34 and AC-37 as listed in each task's Acceptance (incl. the reviewed-set disagree gate in T17/T18).
- **typecheck gate:** `pnpm typecheck` in `server/`, `client/`, and `mcp/` (mcp only for the vendored-contract sync, T2).
- **manual/dev demo:** after `pnpm db:migrate` + `pnpm db:seed` (T1, T9), the Configure page shows real estimates and `/multi-agent/runs/<seeded id>` renders populated Columns/Tabs + a disagree section.
- **e2e:** none required by the spec; not in scope for this plan.

## Risks & mitigations
- **Vendored-contract desync (T2)** → apply the identical block to all three copies in one task; acceptance greps the three files for equality; `mcp` typecheck included.
- **Touching the out-of-bounds engine while threading `multiAgentRunId`** → T4 is scoped to `service.ts` + `run.repo.ts` only; `run-executor.ts`/`executeRuns` are explicitly excluded from owned paths and acceptance asserts non-blocking return is preserved.
- **AC-30/AC-34 disagree-gate correctness** → a single "Reviewed-agent set" definition (`status==='done'`) is pinned and used identically by T5 (grouping), T17 (render gate), and T18 (parent gate); acceptances assert the all-fail and 1-of-2-succeeded cases hide the section.
- **AC-24 "no decision" trap** → T16 gotcha + acceptance force handling the `no_decision` path rather than surfacing a raw 422.
- **`modules/index.ts` contention** → isolated to T8 (depends on T5+T6) so T5 and T6 stay parallel with non-overlapping owned paths.
- **Live-status flakiness** → reuse the proven `useRunEvents` multi-subscribe + the self-clearing poll; do not invent a new stream (Q3).
- **Honest-copy drift** → all strings live in `multiAgent.json` (T12) and math is pinned in this plan (Rec A); component acceptances grep for forbidden words / assert SUM math.
- **Design ordinal drift** → screens are anchored by design **file id + component name**, never "design N".

## Red-flags check
- [x] Every requirement (AC-1..AC-39 + the 8 confirmed HOW defaults) maps to at least one task — see "Requirements (verified)".
- [x] No specification was authored or edited — SPEC-05 is taken as input only.
- [x] Execution mode recorded (multi-agent) and the plan is shaped for it (5-phase DAG, non-overlapping owned paths).
- [x] Dependencies form a DAG (T1/T2/T3 → T4/T5/T6/T9 → T8/T10 → T14–T17 → T18/T19); no cycles.
- [x] (multi-agent) Concurrent tasks have non-overlapping Owned paths — `modules/index.ts` isolated to T8; PR-page `page.tsx`/`PrDetailHeader` only in T19; component dirs disjoint.
- [x] Every Acceptance is measurable (named test/AC, command + expected result, or observable behavior).
- [x] Contracts defined before dependents — T2 precedes T5/T10; T1 precedes T4/T5/T9.
- [x] No edits to existing shared contracts without a callout — `RunRequest` untouched (Rec B); the only `vendor/shared` change is the **new** `MultiAgentRunRequest` (T2, flagged).
- [x] `*/src/vendor/**` not modified except the two sanctioned exceptions, each flagged: the new contract (T2, applied to all 3 copies) and the `nav.ts` entry (T11, documented precedent).
- [x] No DB table deletions or edits to existing migrations — T1 appends `0020` only; the empty `multi_agent_runs` stub is reused, not dropped.
- [x] Failure & edge states owned: first-ever failure vs prior run (each launch = a new `multi_agent_runs` row, never overwrites — T5); partial one-of-N isolation (AC-33, T5/T15/T16/T18); all-fail with an empty reviewed set ⇒ no disagree section (AC-34, T5/T17/T18); disagree gate over the reviewed (`done`) set, not dispatched count (AC-30, T5/T17/T18); in-progress + navigate-away (server-side rows + reaped orphans, T18); unavailable/not-ready preconditions distinct from empty ("No agents selected" AC-18/T18, "Pick a pull request first" AC-8/T14, "no history" AC-12/T14).
- [x] (design referenced) Every in-scope screen is anchored by a stable id (design file id + component name) with a measurable visual contract (layout/copy/colour tokens/states) in T14–T19; the design's populated state needs run history the fresh DB lacks, owned by the demo-seed task T9.
