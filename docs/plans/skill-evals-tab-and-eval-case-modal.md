# Implementation Plan: Skill Evals tab + "Turn into eval case" seeded modal

## Overview

Two agreed additions to the L06 Eval Pipeline (SPEC-04), each reversing/refining a
prior cut:

- **Gap 1** — give the **Skill editor** an **Evals** tab that mirrors the Agent editor's,
  backed by the *same* in-app eval pipeline extended to skill owners (list / author /
  edit / delete cases, run-single, run-all, dashboard metrics + run history — all
  skill-keyed). SPEC-04 explicitly deferred skill eval cases as a non-goal (spec
  §Non-goals, §Out of scope); this gap deliberately reverses that cut.
- **Gap 2** — change **"Turn into eval case"** on a finding from a direct-save-plus-toast
  into a **pre-filled, reviewable `CaseEditorModal`** (a non-saving preview → user reviews
  name + expected output → Save), while preserving AC-5 idempotency and the finding→case link.

Both land on one branch. Gap 2 is smaller and self-contained and is sequenced first so it
can ship independently of Gap 1.

## Execution mode

**single-agent (one pass)** — chosen deliberately. `client/INSIGHTS.md` (entry at :135)
records that the original L06 build ran the eval server phase and client phase concurrently
off one plan and **drifted on 3 of 13 route response shapes**, invisibly to `pnpm typecheck`,
because client hooks annotated `api.post<T>()` with types that lied about the runtime JSON.
This plan re-touches exactly that server↔client eval wire surface (new skill routes, a new
finding-preview shape, generalized hooks), so a single sequential context that writes the
server route/`service.ts` shapes and then the matching client hooks is the risk-correct mode.
The DAG below still records dependencies so the work is checkpointable, but tasks are meant to
be executed top-to-bottom by one implementer.

## Requirements (verified)

These requirements are the **input** to this plan (the task brief + the two locked user
decisions). Where a SPEC-04 acceptance criterion carries over to the skill owner by parity,
it is cited so the conformance gate can trace it.

**Gap 1 — Skill Evals tab (extends the eval pipeline to skill owners)**
- **R-G1-1** — A Skill has a new **Evals** tab in `SkillEditor`, mirroring the Agent editor's
  Evals tab (metric strip + case list + run-all + new/edit/delete/run-single). *(user decision:
  "Mirror AgentEditor in-app"; parity with SPEC-04 AC-6, AC-8.)*
- **R-G1-2** — "Running a skill eval case" is defined and feasible against reviewer-core's
  real API; run semantics documented (see Open questions / assumptions, **A1**). *(parity with
  SPEC-04 AC-9, AC-11, AC-25.)*
- **R-G1-3** — Skill-keyed list / author / edit / delete of eval cases. *(parity AC-6, AC-22,
  AC-23, AC-24.)*
- **R-G1-4** — Skill-keyed run-single and run-all, persisting run history attributed to the
  skill's version. *(parity AC-9, AC-15, AC-25.)*
- **R-G1-5** — Skill-keyed dashboard metrics (recall / precision / citation_accuracy / traces
  passed) + delta vs previous run, shown in the tab's metric strip. *(parity AC-8, AC-14.)*
- **R-G1-6** — Every new skill eval route is schema-first (Zod `params`/`body` via the type
  provider), rejecting invalid input with `422`. *(SPEC-04 AC-19.)*
- **R-G1-7** — Degraded inputs (a skill with zero cases, an empty diff, a run with no findings,
  a `must_not_flag` case) score without throwing / `NaN`. *(SPEC-04 AC-20.)*
- **R-G1-8** — `pnpm verify:l06` stays green with no keys/network and additionally exercises
  the **skill** run path against the mock reviewer. *(SPEC-04 AC-21 extended.)*
- **R-G1-9** — Tab routing: `?tab=evals` is a valid Skill editor tab (descriptor,
  `VALID_SKILL_TABS`, page/workspace fallback) and i18n label present.
- **R-G1-10 (non-goal, documented)** — **Compare / Promote are NOT added for skills.** They are
  agent-version-config specific (`agent_versions` snapshots, `system_prompt` diff, promote =
  re-apply an agent config). Excluded; rationale in Open questions **A3**.

**Gap 2 — "Turn into eval case" opens a pre-filled modal**
- **R-G2-1** — Clicking "Turn into eval case" opens a `CaseEditorModal` **pre-filled** from a
  **non-saving preview** of the frozen draft, for review/edit before saving. *(user decision:
  "Reuse CaseEditorModal in a seeded mode, pre-filled via a non-saving preview endpoint.")*
- **R-G2-2** — Save preserves **AC-5 idempotency** (one case per finding) and the
  `input_meta.source_finding_id` link. *(SPEC-04 AC-5.)* Save path chosen: keep Save on the
  finding route with an optional edits body (see **A2**).
- **R-G2-3** — Name and expected-output are user-editable pre-save; the frozen diff is shown
  read-only (the freeze guarantee of AC-1/AC-2 must not be user-rewritable). *(SPEC-04 AC-1,
  AC-2, AC-3, AC-23.)*
- **R-G2-4** — If the finding already has a case, the flow opens that existing case (edit mode)
  rather than minting a duplicate. *(SPEC-04 AC-5 "clearly surfaced as already added".)*
- **R-G2-5** — A finding with **no decision** does not open the preview/modal (mirror the
  existing disabled state + `no_decision` handling). *(SPEC-04 AC-4.)*
- **R-G2-6** — The preview route is schema-first and does **no** DB write. *(SPEC-04 AC-19.)*

## Open questions & recommendations

- **A1 (skill-eval run semantics) — ASSUMPTION, resolved.** A Skill has
  `{ id, name, description, type, source, body, enabled, version }` — no `systemPrompt` /
  `provider` / `model` / `strategy`. Verified against `reviewer-core/src/review/run.ts`:
  `reviewPullRequest` already accepts an optional **`skills?: string[]`** slot of *resolved
  skill bodies* (this is exactly how `server/src/modules/reviews/run-executor.ts` injects an
  agent's enabled skills into a real review — line ~287/376). Therefore **running a skill eval
  case = `reviewPullRequest` over the case's frozen `input_diff` with a base reviewer system
  prompt PLUS the skill's `body` injected via the `skills` slot**:
  - `systemPrompt` = `GENERAL_REVIEWER_PROMPT` (existing built-in base prompt exported from
    `server/src/db/seed-prompts.ts`) — a full reviewer role the skill guidance augments.
  - `skills` = `[skill.body]` (the skill's *current* body; injected identically to production
    review composition — data, not a role prompt).
  - provider/model resolved via `resolveFeatureModelWithFallback(container, workspaceId,
    'eval_runner')` **with no `reachableModel`** (skills carry no provider/model) →
    workspace override → registry default (`openai/gpt-4.1`). The `eval_runner` slot already
    exists (`vendor/shared/contracts/platform.ts`).
  - the run is attributed to **`skill.version`** (stored in `eval_runs.agent_version`, surfaced
    as `EvalRunGroup.agent_version`).
  **Feasibility: confirmed with ZERO reviewer-core change.** Rejected alternative: using the
  skill `body` *as* the system prompt — a skill body is guidance/knowledge, not a reviewer role,
  and injecting via the `skills` slot is faithful to how skills actually shape a review.
- **A2 (Gap 2 save path) — ASSUMPTION, resolved.** Keep **Save on the finding route**
  (`POST /findings/:id/eval-case`) by adding an **optional** edits body (`name?`,
  `expected_output?`). Chosen over routing Save through `POST /agents/:id/eval-cases` because the
  finding route already owns idempotency (`repo.findByFindingId` on `input_meta.source_finding_id`)
  and the finding→case link; the author-from-scratch route would force re-implementing both.
  The frozen `input_diff` is **not** an accepted override (kept read-only, per R-G2-3), so the
  body carries only `name` + `expected_output`.
- **A3 (skill compare/promote excluded) — documented non-goal.** The compare modal + promote are
  agent-version specific: `EvalComparison.system_prompt_diff` diffs two `agent_versions`
  snapshots and `EvalService.promote` re-applies an agent config snapshot. Skills are versioned
  (`skill_versions` immutable body snapshots), so a *body-diff* compare is theoretically possible
  later, but there is **no "active version" pointer** to promote a skill to. Excluded here; the
  mirrored skill Evals tab does not surface compare/promote (neither does the agent Evals tab —
  those live on the agent-only `/evals` dashboard, which stays agent-only).
- **A4 (per-case failure isolation) — noted limitation, no change.** `runAllForOwner` runs a
  skill's cases sequentially; a single case throwing aborts that run — **identical to today's
  agent `runAllForAgent`**. SPEC-04 AC-26 isolates failures across *agents* on the dashboard, not
  across cases, and there is no skill dashboard here. Not changed; called out so it is not read as
  a regression.
- **Rec (lift the shared modal):** `CaseEditorModal` becomes a component shared by three features
  (agent Evals tab, skill Evals tab, and the repo/PR FindingCard). Recommend **lifting it to
  `client/src/components/evals/CaseEditorModal/`** (T5) so neither the skill editor nor the
  repo/PR area has to deep-import from `agents/[id]/_components/...`. User can decline; if so, the
  skill tab imports it in place.

## Affected modules & contracts

- **server (`@devdigest/api`)** — extend the eval module (`modules/eval/service.ts`,
  `modules/eval/routes.ts`) with owner-generic run/list/dashboard/history helpers, skill run
  semantics, a finding-preview shape, and an optional edits body on the finding route. Reuse
  (read-only) `db/seed-prompts.ts:GENERAL_REVIEWER_PROMPT`, `modules/skills/repository.ts`
  (`SkillsRepository`, instantiated in the service exactly as `run-executor.ts` does),
  `modules/settings/feature-models.ts:resolveFeatureModelWithFallback`. Optional demo seed in
  `db/seed-evals.ts`.
- **client (`@devdigest/web`)** — owner-generic + skill eval hooks (`lib/hooks/evals.ts`), a
  seeded/owner-aware `CaseEditorModal`, a rewired `FindingCard`, a new Skill `EvalsTab`, Skill
  editor tab wiring, and i18n.
- **Contracts: none.** No `@devdigest/shared` edit and **no re-vendor**. Verified:
  `EvalCase.owner_kind` / `EvalDashboard.owner_kind`/`owner_id` already include/allow `'skill'`;
  `EvalRunGroup.agent_id`/`agent_version` are reused **semantically** to carry the skill's id and
  version (the fields are owner-generic in meaning even though named `agent_*`). The Gap 2 preview
  response and the finding-route edits body are **ad-hoc, server-owned shapes** (a documented
  exported interface in `service.ts` + a route-local Zod schema), following the same
  "documented for the client hooks to conform to" convention as `CrossAgentDashboard` /
  `RunAllAgentsResult` — per `client/INSIGHTS.md:135` these documented server shapes are the wire
  contract of record.
- **DB migration: none required.** `eval_cases` (`owner_kind`,`owner_id`) and `eval_runs`
  (`agent_version` nullable int) already support skill owners; soft-delete uses the existing
  jsonb `_deleted` marker (`server/INSIGHTS.md:44`). Do not edit existing migrations; only append
  via `pnpm db:generate` if a truly new column is discovered (none is).

## Architecture changes

- **New (client, RSC boundary = client component):**
  `client/src/components/evals/CaseEditorModal/` (lifted from
  `agents/[id]/_components/AgentEditor/_components/EvalsTab/_components/CaseEditorModal/`) —
  shared eval-case editor consumed by agent tab, skill tab, and FindingCard.
  `client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/`
  (`EvalsTab.tsx`, `styles.ts`, `index.ts`, `EvalsTab.test.tsx`) — the skill Evals tab body
  (client component; rendered inside the existing client-side `SkillEditor` shell).
- **Server (onion layers unchanged):** all additions stay in the eval **Application** layer
  (`service.ts`) and **Presentation** layer (`routes.ts`); data-access (`repository.ts`) is
  already owner-generic and needs no change.

## Phased tasks

### Phase 1 — Gap 2: "Turn into eval case" → pre-filled seeded modal (independently shippable)

#### T1 — Extract freeze-draft + add non-saving preview + optional edits on create (service)
- **Action:** In `EvalService`, extract the freeze-derivation currently inline in
  `createCaseFromFinding` (loads finding context, checks decision, `loadDiff`, derives
  `expectedOutput`, `name`, `inputMeta` with `source_finding_id`/`pr_*`) into a private
  `buildCaseDraftFromFinding(workspaceId, findingId)` returning a discriminated result:
  `{ status:'ok'; agentId; draft:{ name; input_diff; input_meta; expected_output };
  existing?: EvalCase } | { status:'no_decision' } | { status:'not_found' }`.
  Add `previewCaseFromFinding(workspaceId, findingId)` that calls it and returns a documented
  exported interface `FindingEvalCasePreview = { name; input_diff; input_meta; expected_output;
  owner_id; already_added; existing_case? }` **without inserting**. Refactor
  `createCaseFromFinding` to call the same builder and accept an optional
  `edits?: { name?; expected_output? }` applied over the draft before insert; idempotency and the
  `already_exists`/`no_decision`/`not_found` statuses stay unchanged.
- **Module:** server · **Type:** backend
- **Skills to use:** `backend-onion-architecture`
- **Owned paths:** `server/src/modules/eval/service.ts`
- **Depends-on:** none
- **Risk:** medium
- **Known gotchas:** freeze the RESOLVED `loadDiff` text verbatim (data, never instructions —
  spec §Untrusted inputs; `server/CLAUDE.md` `loadDiff` gotcha). Preview must not mutate: no
  `insertCase`/`updateCase` call on that path. Keep the existing idempotency key
  (`input_meta.source_finding_id`) intact so a later Save still returns the existing case.
- **Acceptance:** `cd server && pnpm typecheck` passes; new `EvalService.previewCaseFromFinding`
  returns a draft with `expected_output` = one finding for an accepted finding and `[]` for a
  dismissed one, and `already_added:true` + `existing_case` when a case already exists — asserted
  by T3.

#### T2 — Add preview route + optional edits body on the finding route (routes)
- **Action:** Add `GET /findings/:id/eval-case/preview` (`schema:{ params: IdParams }`) returning
  the `FindingEvalCasePreview`; 404 on `not_found`, 422 on `no_decision` (mirror the POST). Extend
  `POST /findings/:id/eval-case` with an **optional** Zod body
  `z.object({ name: z.string().min(1).optional(), expected_output: z.array(EvalExpectedFinding).optional() }).optional()`
  and pass it as `edits` to `createCaseFromFinding`; response shape
  (`{ case, already_added }`) and the 201/200 status split are unchanged.
- **Module:** server · **Type:** backend
- **Skills to use:** `fastify-best-practices`, `client-server-communication`, `zod`
- **Owned paths:** `server/src/modules/eval/routes.ts`
- **Depends-on:** T1
- **Risk:** low
- **Known gotchas:** schema-first only — no hand-rolled `Schema.parse(req.body)`
  (`server/CLAUDE.md`). The POST body must be **optional** so the existing no-body call site keeps
  working (AC-3 one-click still valid programmatically). Preview is a GET with no LLM call → no
  extra per-route rate limit needed.
- **Acceptance:** `cd server && pnpm typecheck` passes; T3 drives both routes over HTTP and a
  malformed POST body (e.g. `expected_output: "not-an-array"`) returns `422`.

#### T3 — Server integration test: preview + create-with-edits + idempotency (`.it.test.ts`)
- **Action:** New `server/test/eval-finding-preview.it.test.ts` (testcontainers Postgres) that,
  via `app.inject`: seeds a review + accepted finding and a dismissed finding; asserts
  `GET /findings/:id/eval-case/preview` returns the derived draft (accepted → one expected
  finding; dismissed → `[]`) with `already_added:false`; asserts `POST` with an edits body
  (renamed + edited `expected_output`) creates the case with those edits **and**
  `input_meta.source_finding_id` set; asserts a second `POST` returns `already_added:true` with the
  same case id (no duplicate) and the preview then reports `already_added:true` + `existing_case`;
  asserts a no-decision finding preview → `422`.
- **Module:** server · **Type:** backend
- **Skills to use:** `backend-onion-architecture`
- **Owned paths:** `server/test/eval-finding-preview.it.test.ts`
- **Depends-on:** T2
- **Risk:** low
- **Known gotchas:** DB-backed test MUST use the `.it.test.ts` suffix (`server/CLAUDE.md`). Reuse
  the existing eval `.it.test.ts` setup helpers (see `server/test/eval-routes.it.test.ts`) for
  workspace/review/finding seeding.
- **Acceptance:** `cd server && pnpm exec vitest run test/eval-finding-preview.it.test.ts` green.

#### T4 — Client hooks: finding-preview query + edits on create-from-finding (hooks)
- **Action:** In `lib/hooks/evals.ts`, add `useFindingEvalCasePreview(findingId, enabled)`
  (`useQuery`, `GET /findings/:id/eval-case/preview`, `enabled` gated) typed to a local
  `FindingEvalCasePreview` interface matching T1's exported server interface **field-for-field**.
  Extend `useCreateCaseFromFinding` to accept `{ findingId; name?; expected_output? }` and post the
  optional body; keep its existing invalidations (`evalKeys.cases(owner_id)`,
  `agentDashboard(owner_id)`, `dashboard()`).
- **Module:** client · **Type:** ui
- **Skills to use:** `react-best-practices`, `client-server-communication`
- **Owned paths:** `client/src/lib/hooks/evals.ts`
- **Depends-on:** T2 *(shape parity — diff the local interface against `routes.ts` + the
  `service.ts` documented interface per `client/INSIGHTS.md:135`)*
- **Risk:** medium
- **Known gotchas:** `client/INSIGHTS.md:135` — do not let `api.get<T>()`/`api.post<T>()` lie about
  the runtime shape; the local `FindingEvalCasePreview` must mirror the server interface exactly
  (`owner_id`, `already_added`, `existing_case?`, `input_meta`, `input_diff`).
- **Acceptance:** `cd client && pnpm typecheck` passes; hook keys/routes reviewed against
  `server/src/modules/eval/routes.ts`.

#### T5 — Lift + generalize `CaseEditorModal`; add `"seeded"` mode (shared component)
- **Action:** Move `CaseEditorModal` to `client/src/components/evals/CaseEditorModal/`
  (`CaseEditorModal.tsx`, `styles.ts`, `index.ts`) and update the agent Evals tab import (T6-adjacent
  edit in the same task's owned agent file). Add a third `mode: "seeded"` (alongside `"new"`/`"edit"`):
  seeded mode renders the diff/files/prMeta **read-only** (pre-filled from the preview draft),
  keeps **name + expected-output editable** with the existing JSON-validation + finding-skeleton
  affordance, and on **Save** calls `useCreateCaseFromFinding({ findingId, name, expected_output })`
  (not `useCreateCase`). Add props `seed?: { findingId: string; draft: FindingEvalCasePreview }`.
  `"new"`/`"edit"` behaviour is unchanged.
- **Module:** client · **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/components/evals/CaseEditorModal/CaseEditorModal.tsx`,
  `client/src/components/evals/CaseEditorModal/styles.ts`,
  `client/src/components/evals/CaseEditorModal/index.ts`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx`
  *(import path update + delete old modal dir)*
- **Depends-on:** T4
- **Risk:** medium
- **Known gotchas:** the frozen diff stays read-only in seeded mode (R-G2-3 — preserves the
  AC-1/AC-2 freeze). Reuse the vendored `Modal` primitive (`src/vendor/ui/kit/Modal.tsx`,
  parent-controlled conditional render) — do not edit vendor. Keep expected-output Save blocked
  while JSON invalid (AC-23).
- **Acceptance:** `cd client && pnpm typecheck` passes; the agent Evals tab still renders (its
  test, updated in T7, stays green); seeded-mode Save invokes the finding-route mutation (asserted
  in T7).

#### T6 — Rewire `FindingCard` to open the seeded modal (repo/PR)
- **Action:** Replace `handleTurnIntoEvalCase`'s direct `createCase.mutate + toast` with opening
  the shared `CaseEditorModal`. On click (only when `hasDecision`): fetch the preview
  (`useFindingEvalCasePreview(f.id, open)`); if `already_added` + `existing_case` → open modal in
  `"edit"` mode against the existing case (owner = its agent); else open `"seeded"` mode from the
  draft. Keep the button disabled + `noDecisionTooltip` when `!hasDecision` (preview never fetched,
  modal never opens — R-G2-5). Preserve the "Added / Already added" confirmation, now fired on the
  modal's Save success.
- **Module:** client · **Type:** ui
- **Skills to use:** `react-best-practices`
- **Owned paths:**
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`
- **Depends-on:** T5, T4
- **Risk:** medium
- **Known gotchas:** do not fetch the preview until the user opens it (avoid an eager GET +
  `loadDiff` per finding card). `already_added` is the real cross-session idempotency signal
  (`client/INSIGHTS.md:135`), not a client-only `useState` guard — route re-clicks through the
  server, not a session boolean.
- **Acceptance:** `cd client && pnpm typecheck` passes; behaviour asserted in T7.

#### T7 — Client tests: FindingCard opens modal; seeded-mode saves via finding route
- **Action:** Update `FindingCard.test.tsx` to assert: no-decision finding → button disabled, no
  modal; a decided finding → clicking opens the modal pre-filled from the mocked preview; Save
  invokes the finding-route mutation with the edited name/expected_output. Add/extend the modal
  test (co-located under `client/src/components/evals/CaseEditorModal/`) for seeded mode
  (read-only diff, editable expected-output, Save-blocked-while-invalid-JSON). Update the agent
  `EvalsTab.test.tsx` import if the modal path moved.
- **Module:** client · **Type:** ui
- **Skills to use:** `react-testing-library`, `react-best-practices`
- **Owned paths:**
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx`,
  `client/src/components/evals/CaseEditorModal/CaseEditorModal.test.tsx`
- **Depends-on:** T5, T6
- **Risk:** low
- **Known gotchas:** this package uses `fireEvent`, not `user-event` (`client/INSIGHTS.md`
  ConfigTab entry); wrap renders in `NextIntlClientProvider` with `messages/en/evals.json`
  (mirror the existing agent `EvalsTab.test.tsx`).
- **Acceptance:** `cd client && pnpm test` green (new/updated files included).

### Phase 2 — Gap 1 backend: skill eval run semantics + owner-generic service + skill routes

#### T8 — Owner-generic run/list/dashboard/history + skill run semantics (service)
- **Action:** In `EvalService`:
  (a) extract `runCaseWithConfig(caseRow, runGroupId, opts, cfg, workspaceId)` where
  `cfg = { systemPrompt; skills?: string[]; provider: Provider; model: string;
  strategy?: ReviewStrategy; ownerVersion: number | null; sessionLabel: string }`; the existing
  agent `runCase(agent, …)` becomes a thin wrapper that builds `cfg` from the `AgentRow`
  (systemPrompt = `agent.systemPrompt`, **no** skills, resolve via
  `resolveFeatureModelWithFallback(…, 'eval_runner', { provider: agent.provider, model: agent.model })`,
  `ownerVersion = agent.version`) — **byte-identical agent behaviour**.
  (b) add a skill cfg builder: `systemPrompt = GENERAL_REVIEWER_PROMPT` (import from
  `db/seed-prompts.ts`), `skills = [skill.body]`, resolve via
  `resolveFeatureModelWithFallback(…, 'eval_runner')` (no reachable model), `ownerVersion = skill.version`.
  (c) introduce owner-generic privates `runAllForOwner(ws, ownerKind, ownerId)`,
  `listCasesForOwnerDto`, `authorCaseForOwner`, `ownerDashboard(ws, ownerKind, ownerId)`,
  `runHistoryForOwner` (reusing the already-owner-generic repository methods); keep the existing
  agent-named public methods as thin wrappers over them.
  (d) add public skill methods `listSkillCases`, `authorSkillCase`, `runAllForSkill`,
  `skillRunHistory`, `skillDashboard` that resolve the skill via a `SkillsRepository`
  (`new SkillsRepository(this.container.db)`, exactly as `run-executor.ts` does) and 404-equivalent
  (`undefined`) when the skill is not in the workspace.
  (e) **remove** the `runSingleCase` skill guard at `service.ts:452-454`
  (`"Only agent-owned eval cases can be run…"`); branch on `caseRow.ownerKind` to build the agent
  or skill cfg, then `runCaseWithConfig`.
- **Module:** server · **Type:** backend + core-adjacent (consumes reviewer-core)
- **Skills to use:** `backend-onion-architecture`
- **Owned paths:** `server/src/modules/eval/service.ts`
- **Depends-on:** T1 *(same file; sequence after Gap 2's service edits to avoid an intra-file
  rebase)*
- **Risk:** high
- **Known gotchas:** keep the agent path unchanged — existing agent eval tests
  (`test/eval-service.it.test.ts`, `test/eval-routes.it.test.ts`, `run-path.test.ts`) must stay
  green. `resolveFeatureModelWithFallback` with no reachable model falls back to the registry
  default `openai/gpt-4.1`, which throws `ConfigError` for a workspace with no OpenAI key
  (`server/INSIGHTS.md:112`) — that error surfaces via the route/mutation, which is correct;
  offline tests inject the mock LLM via container override (`server/INSIGHTS.md:45`). Attribute the
  run to `skill.version` in `eval_runs.agent_version` (reused field — no contract change).
- **Acceptance:** `cd server && pnpm typecheck` passes; `cd server && pnpm exec vitest run .it.test`
  keeps all pre-existing eval agent tests green; skill-run behaviour asserted by T10/T11.

#### T9 — Skill eval routes (list / author / run-all / history / dashboard) (routes)
- **Action:** In `eval/routes.ts` add, schema-first + workspace-scoped via `getContext`, mirroring
  the agent routes:
  `GET /skills/:id/eval-cases` · `POST /skills/:id/eval-cases` (body `AuthorCaseBody`) ·
  `POST /skills/:id/eval-runs` (rate-limited `{ max:10, timeWindow:'1 minute' }`, like the agent
  run route) · `GET /skills/:id/eval-runs` · `GET /skills/:id/eval-dashboard`. Update/delete/
  run-single **reuse the existing owner-agnostic** `PUT /eval-cases/:id`, `DELETE /eval-cases/:id`,
  `POST /eval-cases/:id/eval-runs` — no new routes. Do **not** add skill compare/promote/run-all-
  agents (A3).
- **Module:** server · **Type:** backend
- **Skills to use:** `fastify-best-practices`, `client-server-communication`, `zod`
- **Owned paths:** `server/src/modules/eval/routes.ts`
- **Depends-on:** T8, T2 *(same file as T2; sequence after)*
- **Risk:** low
- **Known gotchas:** the LLM-triggering `POST /skills/:id/eval-runs` MUST carry the same per-route
  rate limit as the agent run routes to cap cost. Schema-first (`AC-19`) — reuse the module's
  `IdParams`/`AuthorCaseBody`.
- **Acceptance:** `cd server && pnpm typecheck` passes; T11 drives every skill route over HTTP;
  invalid body (e.g. missing `name` on author) returns `422`.

#### T10 — Extend the hermetic run-path test to cover a skill run (`verify:l06`)
- **Action:** In `server/src/modules/eval/run-path.test.ts` add a case that drives the **real**
  `reviewPullRequest` with `systemPrompt: GENERAL_REVIEWER_PROMPT` + `skills: ['<skill body>']`
  over the mock reviewer (`createMockReviewerLLM`) and scores with the pure scorer — proving the
  skill run path makes zero real LLM calls, is grounded, and scores deterministically (AC-11/AC-12/
  AC-21 extended to skills, R-G1-8). No DB/testcontainers (plain `*.test.ts`).
- **Module:** server · **Type:** backend
- **Skills to use:** `backend-onion-architecture`
- **Owned paths:** `server/src/modules/eval/run-path.test.ts`
- **Depends-on:** T8
- **Risk:** low
- **Known gotchas:** keep it a plain `.test.ts` (no DB) so it stays inside `verify:l06`'s glob
  (`vitest run src/modules/eval/scoring src/modules/eval/run-path.test.ts`). Injecting a skill body
  must not change the mock reviewer's deterministic findings (it keys off the diff), so the metric
  assertions stay stable.
- **Acceptance:** `cd server && pnpm verify:l06` green **with no keys/network**, including the new
  skill-run assertion.

#### T11 — Server integration test: skill create → run → dashboard → history (`.it.test.ts`)
- **Action:** New `server/test/eval-skill.it.test.ts` (testcontainers) that, over `app.inject`
  with a container-wide mock LLM override (`overrides:{ llm:{ openai: createMockReviewerLLM(diff,
  'baseline') } }` — `server/INSIGHTS.md:45`): seeds a skill; authors a skill eval case
  (`POST /skills/:id/eval-cases`); runs it (`POST /skills/:id/eval-runs`); asserts a persisted run
  attributed to `skill.version` and defined (non-`NaN`) aggregates from
  `GET /skills/:id/eval-dashboard`; asserts run history (`GET /skills/:id/eval-runs`); asserts the
  **empty-set** dashboard (skill with zero cases) returns defined metrics (R-G1-7); asserts
  `POST /eval-cases/:id/eval-runs` runs a single skill case (no longer throws — the removed guard).
- **Module:** server · **Type:** backend
- **Skills to use:** `backend-onion-architecture`
- **Owned paths:** `server/test/eval-skill.it.test.ts`
- **Depends-on:** T9
- **Risk:** medium
- **Known gotchas:** `.it.test.ts` suffix required. Skill seeding: insert a `skills` row directly
  (mirror `db/seed-evals.ts` case seeding) or via the skills route. The run is offline only because
  of the container LLM override — never rely on real keys.
- **Acceptance:** `cd server && pnpm exec vitest run test/eval-skill.it.test.ts` green.

#### T12 — (Optional, demo data) Seed a demo skill's eval cases
- **Action:** Extend `server/src/db/seed-evals.ts` (`seedEvalCases`) to also insert ≥3 skill-owned
  eval cases for a demo skill — both `must_find` and `must_not_flag` represented — so a freshly
  seeded workspace shows a **populated** Skill Evals tab (the `skill-evals` artboard's populated
  state; design doc §Full artboard inventory). Follow the existing agent-case seeding block
  (`ownerKind`, `expectedOutput`, `inputDiff`, `inputMeta`).
- **Module:** server · **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`
- **Owned paths:** `server/src/db/seed-evals.ts`
- **Depends-on:** none *(independent; not a migration — appends seed rows only)*
- **Risk:** low
- **Known gotchas:** seed only — never a migration/schema edit. Idempotent seed (guard on existing
  rows, like the current `seedEvalCases` existence check).
- **Acceptance:** `cd server && pnpm db:migrate && pnpm db:seed` runs clean; a demo skill then has
  ≥3 eval cases visible via `GET /skills/:id/eval-cases`.

### Phase 3 — Gap 1 client: owner-generic hooks + skill Evals tab + tab wiring + i18n

#### T13 — Owner-generic + skill eval hooks (hooks)
- **Action:** In `lib/hooks/evals.ts`:
  (a) add skill query keys `evalKeys.skillCases/skillRuns/skillDashboard(skillId)`.
  (b) add `useSkillEvalCases`, `useSkillEvalDashboard`, `useSkillEvalRuns`, `useRunAllSkillEvals`
  (mirroring the agent hooks, hitting the `/skills/:id/...` routes, typed to the existing
  `EvalCase` / `EvalDashboard` / `EvalRunGroup` contracts — the `agent_id`/`agent_version` fields
  carry the skill's id/version).
  (c) generalize the shared mutation hooks (`useCreateCase`, `useUpdateCase`, `useDeleteCase`,
  `useRunSingleCase`) to take an `owner: { kind: "agent" | "skill"; id: string }` instead of
  `agentId`, deriving the create route (`/agents/:id/...` vs `/skills/:id/...`) and the
  invalidation keys (agent vs skill) from it; update/delete/run-single keep hitting the owner-
  agnostic `/eval-cases/:id...` routes and only switch invalidation targets.
- **Module:** client · **Type:** ui
- **Skills to use:** `react-best-practices`, `client-server-communication`
- **Owned paths:** `client/src/lib/hooks/evals.ts`
- **Depends-on:** T9, T4 *(same file as T4; sequence after)*
- **Risk:** medium
- **Known gotchas:** `client/INSIGHTS.md:135` — the skill hook response types must match the server
  routes/`service.ts` shapes field-for-field. Changing the mutation-hook input signature
  (`agentId` → `owner`) ripples to the agent Evals tab, the (lifted) modal, and FindingCard's
  edit-mode open — update those call sites in their owning tasks (T5/T6/T15).
- **Acceptance:** `cd client && pnpm typecheck` passes across all call sites.

#### T14 — Owner-aware `CaseEditorModal` (shared component)
- **Action:** Change the shared `CaseEditorModal` prop from `agentId: string` to
  `owner: { kind: "agent" | "skill"; id: string }`, threading it into the generalized create/
  update/delete/run-single hooks (T13). Seeded mode (T5) still saves via the finding route with
  `owner.kind==='agent'`. `"new"`/`"edit"` now work for either owner.
- **Module:** client · **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/components/evals/CaseEditorModal/CaseEditorModal.tsx`
- **Depends-on:** T13, T5
- **Risk:** medium
- **Known gotchas:** the agent Evals tab passes `owner={{ kind:'agent', id: agent.id }}` (edit in
  T15's agent-file owned path or here — keep owned paths non-overlapping by doing the agent-tab
  call-site edit in T15). Do not regress seeded-mode read-only diff.
- **Acceptance:** `cd client && pnpm typecheck` passes; agent + seeded modal tests green.

#### T15 — Skill Evals tab component + agent-tab call-site update (skill UI)
- **Action:** Add `client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/`
  (`EvalsTab.tsx`, `styles.ts`, `index.ts`) mirroring the agent
  `EvalsTab.tsx`: metric strip (RECALL / PRECISION / CITATION ACCURACY via `MetricCard` +
  Traces passed), "Eval cases" header with `{pass}/{ran} passing` + `{total} cases` badges +
  "Run all evals" + "New eval case", per-case rows (status icon, mono name, expected summary
  badge, run/edit/delete), and the shared `CaseEditorModal` with `owner={{kind:'skill', id: skill.id}}`.
  Use `useSkillEvalCases` / `useSkillEvalDashboard` / `useRunAllSkillEvals` and the generalized
  case mutations. **Omit** the agent tab's "View full dashboard →" link (the `/evals`
  cross-owner dashboard is agent-only — A3). Also update the **agent** `EvalsTab.tsx` call site to
  pass `owner={{kind:'agent', id: agent.id}}` to the modal.
- **Module:** client · **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`, `next-best-practices`
- **Owned paths:**
  `client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/EvalsTab.tsx`,
  `client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/styles.ts`,
  `client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/index.ts`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx`
- **Depends-on:** T14
- **Risk:** medium
- **Known gotchas:** metric colour convention (design §Design tokens): recall = `--accent`,
  precision = `--ok`, citation = `--warn` (invariant). This mirror inherits the agent tab's
  existing `MetricCard` presentation (the agent tab's known metric-colour/layout deviations noted
  in the design doc are **not** in scope to fix here — parity with the mirror source is the
  acceptance). Empty state: reuse `EmptyState` (design's empty skill-evals). `FlaskConical` icon
  is valid in the UI kit; `"GitCompare"` is NOT (`client/INSIGHTS.md:86`) — not needed here.
- **Acceptance:** `cd client && pnpm typecheck` passes; renders one row per skill eval case with
  correct expected-summary badges and pass/fail/never-run status icons; asserted by T17.

#### T16 — Wire the Evals tab into the Skill editor shell + tab routing + i18n label
- **Action:** In `SkillEditor/constants.ts` add `{ key:"evals", labelKey:"tabs.evals",
  icon:"FlaskConical" }` to `TABS` (drops into `VALID_SKILL_TABS` automatically); update the
  stale "later lesson" comment. In `SkillEditor.tsx` render `tab === "evals" && <EvalsTab
  skill={skill} />`. Add `"evals"` under `tabs` in `client/messages/en/skills.json`. The page
  (`skills/[id]/page.tsx`) and `SkillsWorkspace.tsx` already fall back to `"config"` for unknown
  tabs via `VALID_SKILL_TABS.includes(tab)` — no change needed there beyond the constant.
- **Module:** client · **Type:** ui
- **Skills to use:** `next-best-practices`, `ui-frontend-architecture`
- **Owned paths:**
  `client/src/app/skills/[id]/_components/SkillEditor/constants.ts`,
  `client/src/app/skills/[id]/_components/SkillEditor/SkillEditor.tsx`,
  `client/messages/en/skills.json`
- **Depends-on:** T15
- **Risk:** low
- **Known gotchas:** intra master/detail tab navigation already passes `{ scroll:false }`
  (`client/INSIGHTS.md:18`) — nothing to add. `VALID_SKILL_TABS` is derived from `TABS`, so adding
  the descriptor is the only place the tab list changes.
- **Acceptance:** `cd client && pnpm typecheck` passes; `/skills/<id>?tab=evals` renders the new
  tab; an invalid `?tab=` still falls back to `config`.

#### T17 — Client tests + i18n for the skill Evals tab
- **Action:** Add `SkillEditor/_components/EvalsTab/EvalsTab.test.tsx` mirroring the agent
  `EvalsTab.test.tsx` (mock `useSkillEvalCases`/`useSkillEvalDashboard`; assert case rows, metric
  strip values, run-all disabled when empty, opening the modal). Add any skill-specific i18n keys
  used by the tab to `client/messages/en/evals.json` (e.g. a skill metric subtitle) — reuse the
  existing `evals` namespace keys where identical.
- **Module:** client · **Type:** ui
- **Skills to use:** `react-testing-library`, `react-best-practices`
- **Owned paths:**
  `client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/EvalsTab.test.tsx`,
  `client/messages/en/evals.json`
- **Depends-on:** T15, T16
- **Risk:** low
- **Known gotchas:** `fireEvent` (no `user-event`); wrap in `NextIntlClientProvider` with
  `messages/en/evals.json`. If the tab prints a metric value that also appears elsewhere in the
  tile, prefer `getAllByText` (`client/INSIGHTS.md:73`).
- **Acceptance:** `cd client && pnpm test` green (new file included).

## Testing strategy

- **Server (backend + core-consuming run path):**
  - `cd server && pnpm typecheck`
  - Unit / hermetic: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (includes the
    extended `run-path.test.ts`, T10).
  - Integration (testcontainers Postgres): `cd server && pnpm exec vitest run .it.test` — includes
    `test/eval-finding-preview.it.test.ts` (T3) and `test/eval-skill.it.test.ts` (T11); pre-existing
    `test/eval-*.it.test.ts` must stay green.
  - Offline run-path proof (required, `runCase` changed): `cd server && pnpm verify:l06` — green
    with **no API keys and no network**, now covering the skill run path (T10).
  - Build (type-only for reviewer-core; server type-check): `cd server && pnpm build`.
- **Client:**
  - `cd client && pnpm typecheck` (catches most wire mismatches; but per `client/INSIGHTS.md:135`
    also hand-diff each new/changed hook's local type against `server/src/modules/eval/routes.ts`
    and the `service.ts` documented interfaces — `tsc` cannot catch a lying annotation).
  - `cd client && pnpm test` — `FindingCard.test.tsx` (T7), `CaseEditorModal.test.tsx` seeded mode
    (T7), skill `EvalsTab.test.tsx` (T17), plus the unchanged agent `EvalsTab.test.tsx`.
  - `cd client && pnpm build`.
- **reviewer-core:** unchanged. Sanity: `cd reviewer-core && pnpm typecheck`.
- **End-to-end in the running app:** `./scripts/dev.sh` (boots Postgres → migrate → seed → API
  :3001 → web :3000; poll `curl :3001/health` and `curl :3000`). Then:
  - *Gap 2:* open a seeded PR (`/repos/<repoId>/pulls/482?tab=findings`), accept or dismiss a
    finding, click **Turn into eval case** → the pre-filled modal opens; edit the name/expected
    output; Save → the case appears in that agent's Evals tab; re-click the same finding → opens the
    existing case (no duplicate).
  - *Gap 1:* open a skill (`/skills/<id>?tab=evals`), author a case (or use the T12 seed), click
    **Run all evals** → metric strip + per-case status update; run a single case; delete a case.
- **Not the gate here:** the root `evals/` CLI suites (`pnpm eval:skills`, `eval:agents`, …)
  exercise the `.claude/` skills/agents, **not** this product code — they are not this feature's
  gate. The gate is server typecheck/test/build + `verify:l06` + client typecheck/test/build.

## Risks & mitigations

- **Server↔client eval wire drift** (the exact failure recorded in `client/INSIGHTS.md:135`) →
  single-agent execution mode; every new client hook type hand-diffed against `routes.ts` +
  `service.ts` documented interfaces; integration tests assert real HTTP JSON.
- **Refactoring `runCase`/`createCaseFromFinding` regresses agent behaviour** → the agent path is
  a thin wrapper preserving byte-identical inputs (no skills injected for agents; same
  `eval_runner` resolution with the agent's reachable model); existing agent eval `.it.test.ts` +
  `run-path.test.ts` + `verify:l06` are the regression guard and must stay green.
- **Skill run needs a workspace LLM key** (registry default `openai/gpt-4.1`) → surfaced as the
  mutation's error toast (correct, not a crash); all tests run offline via the container LLM
  override (`server/INSIGHTS.md:45`), never real keys.
- **Lifting `CaseEditorModal` breaks the agent import** → the move + agent-tab import update live in
  one task (T5) with the agent file in its owned paths; agent `EvalsTab.test.tsx` re-run confirms.
- **Design drift on the skill tab** → mirror the *existing agent Evals tab component* (explicit
  acceptance), inheriting its presentation; the design's known agent-tab deviations are out of
  scope, avoiding an unscoped redesign.

## Red-flags check
- [x] Every requirement (R-G1-1..10, R-G2-1..6) maps to at least one task
- [x] No specification was authored or edited — SPEC-04 taken as input; only this plan written
- [x] Execution mode is recorded (single-agent) and the plan is shaped for it (sequential DAG,
      server shapes before client hooks)
- [x] Dependencies form a DAG (no cycles): T1→T2→T3; T2→T4→T5→T6→T7; T1→T8→{T10,T9}; T9→T11;
      T2/T8→T9; T4/T9→T13→T14 (with T5)→T15→T16→T17; T12 independent
- [x] (single-agent) Owned paths still recorded per task; the only shared files (`service.ts`,
      `routes.ts`, `evals.ts`, `CaseEditorModal`, agent `EvalsTab.tsx`) are touched by
      **sequentially dependent** tasks, never concurrent ones
- [x] Every Acceptance is measurable (a command + expected result, a named test, or an observable
      render)
- [x] Contracts defined before dependents — **no shared contract change needed**; the ad-hoc
      preview/edits shapes are defined in T1/T2 before their client consumer (T4)
- [x] No edits to existing shared contracts (explicitly: none — `agent_id`/`agent_version` reused
      semantically for skill owner)
- [x] `*/src/vendor/**` is not modified in any task (Modal/MetricCard/EmptyState reused as-is)
- [x] No DB table deletions or edits to existing migrations; no new migration required (skill
      owners + soft-delete already supported); seed-only change in T12
- [x] Failure & edge states owned: first-ever vs already-added (T1/T6 preview `already_added` +
      `existing_case` → edit mode), preserve-prior-on-retry (idempotent Save, T1/T3), no-decision
      precondition (T6, R-G2-5), unavailable/empty-set skill dashboard defined-not-NaN (T11,
      R-G1-7), in-progress + navigate-away (server persists the run; client mutation cancel is
      cosmetic — noted A4), partial one-of-N per-case failure (A4: matches existing agent
      semantics, called out not silently dropped)
- [x] (design referenced) Skill Evals tab anchored to the `skill-evals` / `agent-evals` artboards
      by stable id (design doc §Full artboard inventory), visual contract = mirror of the existing
      agent Evals tab with the invariant metric colours (accent/ok/warn); demo data the populated
      state implies has an owning seed task (T12)
