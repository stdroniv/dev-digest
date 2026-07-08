# Implementation Plan: Eval Runner Model Picker

## Overview
Add a per-workspace setting that selects which AI model executes agent reviews when
running eval cases, surfaced as a new picker in the existing **Settings → Feature
Models** tab. When unset (the default), behaviour is byte-identical to today — each
eval runs against the agent's own configured `provider`/`model`, preserving the
regression-test semantics. When a maintainer explicitly sets the override, every eval
case/agent run executes against that one fixed model instead.

## Execution mode
single-agent (one pass) — chosen by the user. The change is small and tightly
coupled: the shared registry entry must land identically across three vendored
`platform.ts` copies plus one hand-maintained client runtime mirror (a single logical
change that must not diverge), and the server service change, tests, and doc caveat sit
on a mostly-linear chain downstream of it. One implementer context making all the
vendored-copy edits together is the safest way to avoid drift.

## Requirements (verified)
Single user requirement (no spec; treated as agreed). Decomposed for traceability:
- **R1** — Add the ability to pick which AI model runs eval cases, surfaced as a new
  per-feature model override in **Settings → Feature Models**, alongside the existing 7
  overrides. (User's verbatim intent.)
- **R1a** — Unset (no override) MUST be byte-identical to today: each eval runs against
  the agent's own `provider`/`model`, so regression-test semantics are preserved. This
  is achieved by reusing `resolveFeatureModelWithFallback` with the agent's own
  `{provider, model}` as the `reachableModel` (assumed default — user confirmed).
- **R1b** — When the workspace explicitly sets the override, every eval case/agent run
  executes against that fixed model (assumed default — user confirmed).
- **R2** — The existing "one bad agent doesn't block the rest" isolation in
  `runAllAgents` MUST still hold once model resolution runs per-agent/per-case: a
  resolution or provider failure fails only that one agent's `runAllForAgent`, never the
  whole batch (Q3 — user confirmed: preserve existing isolation, add an acceptance
  check).
- **R3** — Ship the supporting artifacts (Task 5): extended server tests
  (`.it.test.ts`), a doc caveat in `docs/eval-pipeline.md`, and a planned (post-
  implementation) `engineering-insights` invocation.

**Explicit scope-out (Q2 — user confirmed):** do NOT add `provider`/`model` columns to
`eval_runs` and do NOT add a Drizzle migration. Which model actually produced a run is
NOT persisted or surfaced in the dashboard/Compare view; it is documented as a
deliberate caveat only (see T5). This is not "nearly free" (migration + write-path +
Compare/dashboard surfacing), so it is deferred.

## Open questions & recommendations
- **Q1 (slot naming/defaults) → answered: default accepted.** id `eval_runner`; label
  `Eval Runner`; description `Model that executes agent reviews when running eval cases.
  Leave unset to use each agent's own configured model.`; `defaultProvider: "openai"`,
  `defaultModel: "gpt-4.1"`. Reasoning: mirrors `review_intent`'s style (a "judge whether
  the agent behaves correctly" task). The registry default is effectively unreachable in
  practice — the agent's own model is always passed as `reachableModel`, which wins
  whenever there is no override — but it must still be a valid `FeatureModelChoice` for
  type-safety/consistency with the other 7 entries.
- **Q2 (record executing model on `eval_runs`) → answered: no.** Scope-out above.
- **Q3 (batch isolation) → answered: preserve today's isolation.** Encoded in R2 and
  verified by T4's isolation case.
- **Rec (accepted):** reuse `resolveFeatureModelWithFallback` (not `resolveFeatureModel`)
  with the agent's own `{provider, model}` as `reachableModel`, exactly as
  `intent.service.ts` / `file-summary` / `why-risk-brief` / `brief.service` already do.
  This is what makes the unset path byte-identical to today.
- **Rec (accepted):** assert the threaded model string via `MockLLMProvider.calls[].req.model`
  (inject the mock as `container.llm` through `ContainerOverrides.llm`, NOT via
  `opts.llmOverride`, since the mock reviewer ignores the model arg).

## Affected modules & contracts
- **shared contract (vendored, no canonical source)** — add one `eval_runner` entry to
  the `FeatureModelId` enum and the `FEATURE_MODELS` registry. Physically triplicated +
  one client runtime mirror (see Architecture changes / T1). This is the earliest task;
  everything else depends on it.
- **server** (`@devdigest/api`) — `modules/eval/service.ts`: thread `workspaceId` into the
  private `runCase` and resolve the `eval_runner` model there. Reuses the existing
  `modules/settings/feature-models.ts` application helper (no change to that file).
- **client** (`@devdigest/web`) — no component/i18n code. `SettingsModels.tsx` already maps
  generically over `FEATURE_MODELS`; adding the client-mirror registry entry makes a new
  picker row appear automatically. Labels/descriptions come from the array, not i18n.
- **mcp** (`@devdigest/mcp`) — vendored `platform.ts` copy kept byte-aligned per convention
  (mcp does not consume `FEATURE_MODELS`, but the copy must not diverge).
- **docs** — `docs/eval-pipeline.md` caveat. (Do NOT touch `specs/SPEC-04-*` or
  `docs/plans/eval-pipeline.md` — append-only historical build records.)
- **Contracts:** no NEW `@devdigest/shared` files. One additive edit to the existing
  `FeatureModelId` enum + `FEATURE_MODELS` array (a new enum member; the existing
  `Settings.feature_models = z.record(FeatureModelId, FeatureModelChoice)` accepts the new
  key automatically — no schema shape change, no migration).

## Architecture changes
No structural/onion-layer changes and no new modules. File-level roles:
- **Contract / shared registry (presentation-of-config):**
  `server/src/vendor/shared/contracts/platform.ts`,
  `client/src/vendor/shared/contracts/platform.ts`,
  `mcp/src/vendor/shared/contracts/platform.ts` — the three byte-identical vendored copies
  of the `FeatureModelId` enum + `FEATURE_MODELS` array.
  `client/src/lib/feature-models.ts` — the separate hand-maintained client runtime mirror
  (the client cannot import the vendored runtime VALUE; documented webpack limitation in
  that file's header). All four must receive the identical new entry.
  `client/src/lib/types.ts` re-exports the TYPES from `@devdigest/shared` — no edit
  (picks up the enum change automatically). `reviewer-core` aliases `@devdigest/shared` to
  server's vendored copy — no edit.
- **Application layer (server):** `server/src/modules/eval/service.ts` — the private
  `runCase` gains a `workspaceId` parameter and resolves `eval_runner` via the existing
  `resolveFeatureModelWithFallback` (settings module application helper). The three
  internal callers (`runAllForAgent`, `runSingleCase`, `runAllAgents`→`runAllForAgent`)
  already have `workspaceId` in scope and pass it down. Public method signatures and the
  eval routes are UNCHANGED.
- **Presentation (client):** `SettingsModels.tsx` unchanged — generic render over the
  registry.

## Phased tasks

### Phase 1 — Shared contract (the registry entry, all four copies together)

#### T1 — Add the `eval_runner` slot to the feature-model registry (three vendored copies + client mirror)
- **Action:** Append one entry to the `FeatureModelId` enum and to the `FEATURE_MODELS`
  array, identically, in all four locations:
  1. `server/src/vendor/shared/contracts/platform.ts`
  2. `client/src/vendor/shared/contracts/platform.ts`
  3. `mcp/src/vendor/shared/contracts/platform.ts`
  4. `client/src/lib/feature-models.ts` (runtime mirror — same id/label/description/defaults)
  Enum: add `'eval_runner'` after `'conventions'`. Registry entry (appended last):
  `{ id: 'eval_runner', label: 'Eval Runner', description: "Model that executes agent
  reviews when running eval cases. Leave unset to use each agent's own configured model.",
  defaultProvider: 'openai', defaultModel: 'gpt-4.1' }` (use single vs double quotes to
  match each file's existing style — vendor copies use single quotes; the client mirror
  uses double quotes). Do NOT edit `client/src/lib/types.ts` (type re-export picks it up)
  and do NOT edit `reviewer-core` (aliases into server's vendor copy).
- **Module:** shared (server + client + mcp vendored copies) / client
- **Type:** backend + ui (contract)
- **Skills to use:** `zod`, `client-server-communication`
- **Owned paths:** `server/src/vendor/shared/contracts/platform.ts`,
  `client/src/vendor/shared/contracts/platform.ts`,
  `mcp/src/vendor/shared/contracts/platform.ts`, `client/src/lib/feature-models.ts`
- **Depends-on:** none
- **Risk:** medium
- **Known gotchas:** Root `INSIGHTS.md` ("The vendored shared contracts have no canonical
  source or sync script in this repo") — the registry is triplicated + a fourth client
  runtime mirror; all four MUST be hand-synced or the copies desync silently. INSIGHTS
  advises preferring a per-workspace Settings override over editing the vendored
  registry, BUT that advice is about changing an existing DEFAULT; adding a genuinely NEW
  picker slot has no alternative to a registry addition. Keep all four edits in this one
  task/context (that is the whole reason for single-agent mode). `*/src/vendor/**` is
  otherwise treat-as-generated — this additive enum/registry entry is the one sanctioned
  edit; change nothing else in those files.
- **Acceptance:**
  - `cd server && pnpm typecheck` passes (enum + array compile).
  - `cd client && pnpm typecheck` passes (mirror + `FeatureModelDef` type align).
  - `cd mcp && node_modules/.bin/tsc --noEmit` passes (vendored copy stays byte-aligned).
  - Manual diff check: the `eval_runner` object literal is character-identical (modulo
    quote style) across all four files, and the enum member string `'eval_runner'` is
    present in the three vendored enums.
  - Observable: `cd client && pnpm dev`, open Settings → Feature Models — a new **Eval
    Runner** row renders with the "using default" tag and `gpt-4.1` shown (no bespoke UI
    was added; the generic `FEATURE_MODELS.map` produced it).

### Phase 2 — Server run path

#### T2 — Resolve the `eval_runner` model inside `runCase`
- **Action:** In `server/src/modules/eval/service.ts`:
  1. Import `resolveFeatureModelWithFallback` from `../settings/feature-models.js`.
  2. Add a `workspaceId: string` parameter to the private `runCase(agent, caseRow,
     runGroupId, opts)` signature (new first or last param — keep call sites explicit).
  3. Inside `runCase`, replace the current
     `const llm = opts.llmOverride ?? (await this.container.llm(agent.provider as Provider));`
     and `model: agent.model` with a resolution step:
     ```
     const resolved = await resolveFeatureModelWithFallback(
       this.container, workspaceId, 'eval_runner',
       { provider: agent.provider as Provider, model: agent.model },
     );
     const llm = opts.llmOverride ?? (await this.container.llm(resolved.provider));
     // reviewPullRequest({ ..., model: resolved.model, ... })
     ```
     Keep `opts.llmOverride` bypassing `container.llm` exactly as today (the mock reviewer
     path). Pass `resolved.model` (not `agent.model`) to `reviewPullRequest`.
  4. Update the three internal callers to pass `workspaceId`: `runAllForAgent`
     (loop `this.runCase(agent, c, runGroupId, opts)` → add `workspaceId`), `runSingleCase`
     (`this.runCase(agent, caseRow, runGroupId, opts)` → add `workspaceId`). `runAllAgents`
     already routes through `runAllForAgent(workspaceId, ...)`, so no direct `runCase` call
     there. The public method signatures and `eval/routes.ts` are UNCHANGED.
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`
- **Owned paths:** `server/src/modules/eval/service.ts`
- **Depends-on:** T1
- **Risk:** medium
- **Known gotchas:** `resolveFeatureModelWithFallback` reads `container.db` once per
  `runCase` call (once per case). This is negligible relative to the LLM call and keeps
  `runCase` the single choke point; do NOT hoist the resolution into the callers (that
  would spread the logic and re-introduce the divergence risk). With no settings row and
  no override, the resolver returns the `reachableModel` (fallback) → `{provider:
  agent.provider, model: agent.model}` → byte-identical to today (R1a). The UI writes
  overrides with `provider: "openrouter"` (see `SettingsModels.setModel`), so an active
  override typically resolves to `container.llm('openrouter')`, which requires an
  OpenRouter key — a missing key throws `ConfigError` from `container.llm`, exactly as the
  keyless agent path does today.
- **Acceptance:**
  - `cd server && pnpm typecheck` passes.
  - Unset path unchanged: the existing `eval-service.it.test.ts` cases (AC-9/AC-10, AC-25,
    AC-26, AC-16/AC-27) still pass unmodified under `opts.llmOverride` (mock reviewer),
    proving the override-less path is behaviour-preserving —
    `cd server && pnpm exec vitest run eval-service.it` is green.
  - `cd server && pnpm verify:l06` stays green (it runs `scoring` + `run-path.test.ts`,
    which do not touch `runCase`/Settings — confirms no collateral regression).

### Phase 3 — Tests

#### T3 — Resolver default/override test for `eval_runner`
- **Action:** Extend `server/test/settings-models.it.test.ts` with a case (mirroring the
  existing `onboarding` case) that asserts: (a) with no override,
  `resolveFeatureModel(container, workspaceId, 'eval_runner')` equals the registry default
  `{ provider: 'openai', model: 'gpt-4.1' }` and `getFeatureModelOverride(...)` is
  `undefined`; (b) after `PUT /settings` with
  `{ feature_models: { eval_runner: { provider: 'openrouter', model: '<some-model>' } } }`,
  `resolveFeatureModel(...)` returns that choice. Optionally add a direct
  `resolveFeatureModelWithFallback(container, workspaceId, 'eval_runner', reachableModel)`
  assertion: no override → returns the `reachableModel` with `source: 'fallback'`.
- **Module:** server
- **Type:** backend (test)
- **Skills to use:** `backend-onion-architecture`
- **Owned paths:** `server/test/settings-models.it.test.ts`
- **Depends-on:** T1
- **Risk:** low
- **Known gotchas:** DB-backed — keep the `.it.test.ts` suffix (testcontainers Postgres,
  Docker required). Follow the existing file's `buildApp({ config, db, overrides: {} })` +
  `app.inject({ method: 'PUT', url: '/settings', ... })` pattern; the suite already
  `describe.skip`s when Docker is unavailable.
- **Acceptance:** `cd server && pnpm exec vitest run settings-models.it` passes, including
  the new `eval_runner` assertions.

#### T4 — Model-threading + isolation tests in the eval service
- **Action:** Extend `server/test/eval-service.it.test.ts` with three assertions:
  1. **Unset → agent's own model executes (R1a).** Build the app with an injected LLM mock
     for the agent's provider — `overrides: { llm: { openai: mockOpenai } }` where
     `mockOpenai = new MockLLMProvider('openai', { structuredBySchema: { Review: <valid
     Review fixture> } })` — and run `runAllForAgent(workspaceId, agentId)` (or
     `runSingleCase`) WITHOUT `opts.llmOverride` and WITHOUT any `eval_runner` settings
     override. Assert the `completeStructured` call recorded on `mockOpenai.calls` has
     `req.model === 'gpt-4.1'` (the fixture agent's own model).
  2. **Override → fixed model executes (R1b).** `PUT /settings` (or seed settings) with
     `{ feature_models: { eval_runner: { provider: 'openrouter', model: 'openrouter/x' } } }`,
     build the app with `overrides: { llm: { openrouter: mockOpenrouter } }`, run without
     `opts.llmOverride`, and assert `mockOpenrouter.calls`'s `completeStructured` call has
     `req.model === 'openrouter/x'` — i.e. the override model, across the agent's case(s),
     regardless of the agent's own `gpt-4.1`.
  3. **Batch isolation under an override (R2 / Q3).** With an `eval_runner` override whose
     provider has NO configured key/mock (so `container.llm(provider)` throws), run
     `runAllAgents(workspaceId)` and assert each agent that has cases returns `ok: false`
     with its own `error`, a zero-case agent still returns `ok: true` (empty set never
     resolves/calls the LLM — AC-20), and `results.length` covers every agent (no early
     batch abort). This proves a resolution/provider failure fails only that agent's
     `runAllForAgent`, not the whole batch.
- **Module:** server
- **Type:** backend (test)
- **Skills to use:** `backend-onion-architecture`
- **Owned paths:** `server/test/eval-service.it.test.ts`
- **Depends-on:** T2
- **Risk:** medium
- **Known gotchas:** To assert the threaded model string you MUST inject the mock via
  `ContainerOverrides.llm` (`container.llm(provider)` returns it and `reviewPullRequest`
  calls `completeStructured({ model: resolved.model })`, captured in
  `MockLLMProvider.calls[].req.model`). Do NOT use `opts.llmOverride` for these two cases —
  `createMockReviewerLLM` ignores the model argument, so it cannot prove which model was
  threaded. `MockLLMProvider('openai', ...)` reports `id: 'openai'`; give it a valid
  `Review` fixture via `structuredBySchema: { Review }` or `completeStructured` throws on
  schema parse. DB-backed — keep the `.it.test.ts` suffix.
- **Acceptance:** `cd server && pnpm exec vitest run eval-service.it` passes, including the
  three new assertions.

### Phase 4 — Docs

#### T5 — Document the eval-runner override caveat
- **Action:** In `docs/eval-pipeline.md`, add a caveat under the limitations section (line
  ~143, currently `### Two accepted limitations`). Rename the heading to
  `### Accepted limitations` (count-agnostic, so future additions don't force a rename) and
  append a bullet: setting an eval-runner override decouples the model that actually
  produced a run's findings from the agent VERSION's own configured model — a deliberate
  decoupling. Make explicit that Compare's system-prompt diff still reflects real version
  differences, but the executing model is no longer implied by `agent_version` alone, and
  (per the Q2 scope-out) the executing model is NOT persisted on `eval_runs` or shown in
  the dashboard/Compare view. Optionally add a one-line note near "The idea" / dashboard
  section that the eval-runner model is selectable in Settings → Feature Models and
  defaults to each agent's own model. Do NOT touch `specs/SPEC-04-2026-07-08-eval-pipeline.md`
  or `docs/plans/eval-pipeline.md` (append-only historical records).
- **Module:** docs
- **Type:** docs
- **Skills to use:** none (documentation)
- **Owned paths:** `docs/eval-pipeline.md`
- **Depends-on:** T2
- **Risk:** low
- **Known gotchas:** `docs/eval-pipeline.md` is the LIVING reference doc — it is the only
  eval doc that may be edited; the spec and the historical plan are frozen.
- **Acceptance:** `docs/eval-pipeline.md` contains a new limitations bullet stating the
  executing-model-vs-agent-version decoupling and that the executing model is not
  persisted; heading updated; no edits to the two frozen files (`git diff --name-only`
  shows only `docs/eval-pipeline.md` under `docs/`/`specs/`).

#### T6 — Record the lesson (finishing step, post-implementation)
- **Action:** After T1–T5 land and verify green, invoke the `engineering-insights` skill to
  append a lesson to the appropriate `INSIGHTS.md` — e.g. server/root: "adding a new
  `FeatureModelId` slot requires four hand-synced edits (three vendored `platform.ts` +
  client `lib/feature-models.ts` runtime mirror); resolve it in the single `runCase` choke
  point via `resolveFeatureModelWithFallback` with the agent's own model as `reachableModel`
  to keep the unset path byte-identical." This is a per-repo finishing convention (root
  `CLAUDE.md` "Before you finish"), NOT a plan-authoring task — the actual invocation
  happens during/after implementation.
- **Module:** (meta)
- **Type:** core
- **Skills to use:** `engineering-insights` (skill invoked at finish; not a code task)
- **Owned paths:** none (skill appends to the relevant `INSIGHTS.md`)
- **Depends-on:** T5
- **Risk:** low
- **Known gotchas:** none
- **Acceptance:** the relevant `INSIGHTS.md` gains a concise, non-obvious lesson entry
  (verified by the implementer at finish; not gated by a command).

## Testing strategy
- **server (unit / hermetic):** `cd server && pnpm typecheck`; `cd server && pnpm verify:l06`
  (scoring + `run-path.test.ts`) MUST stay green — proves the `runCase` change caused no
  collateral regression in the mock-reviewer run path.
- **server (integration, DB-backed, Docker required):**
  `cd server && pnpm exec vitest run settings-models.it` (T3) and
  `cd server && pnpm exec vitest run eval-service.it` (T2 regression + T4 new assertions).
  Full integration sweep: `cd server && pnpm exec vitest run .it.test`.
- **client:** `cd client && pnpm typecheck`; visual confirmation that the new **Eval
  Runner** row renders in Settings → Feature Models (generic map — no new component test
  required; the user directed no bespoke UI).
- **mcp:** `cd mcp && node_modules/.bin/tsc --noEmit` — the vendored copy stays byte-aligned
  and compiles (mcp does not consume `FEATURE_MODELS`).
- No e2e and no new migration.

## Risks & mitigations
- **Vendored-copy drift** (the four registry copies diverge) → single-agent mode + T1 owns
  all four files in one context; acceptance includes a cross-file character-identity check
  and `typecheck` in all three packages.
- **Accidental behaviour change on the unset path** (regression-test semantics break) →
  reuse `resolveFeatureModelWithFallback` with the agent's own `{provider, model}` as
  `reachableModel`; T2 acceptance re-runs the existing `eval-service.it.test.ts` suite
  unmodified; T4 case 1 pins the threaded model to `gpt-4.1`.
- **Override provider key missing** (a set override points at a provider with no key) →
  this correctly fails runs via `container.llm(provider)` `ConfigError`; T4 case 3 proves
  the failure is isolated per-agent, not a batch abort (R2). This is expected operator
  behaviour, documented in the T5 caveat.
- **Editing a `vendor/**` file despite the "treat as generated" rule** → mitigated by
  scoping the edit to the additive enum/registry entry only (nothing else in those files
  changes) and recording the rationale in T6's INSIGHTS entry.

## Red-flags check
- [x] Every requirement (R1, R1a, R1b, R2, R3) maps to at least one task — R1/R1b→T1+T2+T4;
      R1a→T2+T4(case 1); R2→T4(case 3); R3→T3+T4+T5+T6.
- [x] No specification was authored or edited — requirements taken as input; no `specs/` edit.
- [x] Execution mode recorded (single-agent) and the plan is a lean ordered chain shaped for it.
- [x] Dependencies form a DAG: T1→T2→{T4, T5→T6}; T1→T3. No cycles.
- [x] (multi-agent) N/A — single-agent; Owned paths are still non-overlapping across tasks.
- [x] Every Acceptance is measurable (typecheck/test commands with named suites, or an
      observable UI row / cross-file identity check).
- [x] Contracts defined first — T1 (registry entry) precedes every dependent task.
- [x] No edits to existing shared contracts without an explicit callout — the only contract
      change is the additive `eval_runner` enum member + registry entry, called out in T1;
      `Settings.feature_models` shape is unchanged.
- [x] `*/src/vendor/**` is modified ONLY for the sanctioned additive registry entry (T1),
      with the rule-exception justified; no other vendored content changes.
- [x] No DB table deletions and no edits to existing migrations — no migration at all
      (Q2 scope-out).
- [x] Failure & edge states covered: first-ever/no-settings-row run → fallback path
      (R1a, T2 gotcha + T4 case 1); partial/one-of-N failure isolation → T4 case 3 (R2);
      preserve-prior-on-retry → N/A (evals persist append-only per-case rows; no prior
      artifact is nulled — the Q2 scope-out means no run-level model field to preserve);
      in-progress + navigate-away → N/A (eval runs are synchronous request/response, not a
      resumable background job in this change); unavailable-precondition → missing
      override-provider key surfaces as an isolated per-agent `ok:false` error (T4 case 3),
      distinct from an empty/zero-case run (`ok:true`, `traces_total:0`).
