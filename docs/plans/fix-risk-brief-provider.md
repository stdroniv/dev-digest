# Plan: Fix RISKS card empty — risk_brief uses an unreachable provider

## Understanding
The RISKS card on the PR Overview page always shows "No notable risks flagged" even
after a review run. The brief writer (`BriefService.compute`) was wired in the
`populate-pr-brief` lesson, but it resolves the `risk_brief` feature-model slot with
`resolveFeatureModel(...)`, which falls back to the registry default `openai/gpt-4.1`
when the workspace hasn't explicitly chosen a model. For a user who configured only
OpenRouter (no OpenAI key), `container.llm('openai')` throws `ConfigError`, the
run-executor swallows the error (brief is non-fatal), and no `pr_brief` row is written —
so the read path correctly returns `null`. The goal is to make risk-brief generation
reuse a provider that is already known to work for this workspace (the reviewer agent
that just ran) when the slot is not explicitly overridden, so risks populate out of the
box for any configured provider — without touching the triplicated vendored default.

## Context loaded
- Root `INSIGHTS.md` — esp. the entry "Prefer not to touch the vendored default at all"
  (feature models are triplicated; change behavior via resolution, not the registry) and
  the `populate-pr-brief` resolution note (BriefService/upsertBrief wiring, all-four-blocks
  requirement).
- `server/INSIGHTS.md` — `PrBrief` must persist all four blocks or `getBrief.safeParse`
  silently returns `undefined`; intent model defaults to `gpt-4.1`; value-vs-type import gotcha.
- `server/CLAUDE.md` — adapters behind the DI container; schema-first routes; `.it.test.ts` split.
- Files read: `server/src/modules/reviews/brief.service.ts`, `.../run-executor.ts`,
  `.../intent.service.ts`, `.../risks.service.ts`, `.../repository/pull.repo.ts`,
  `server/src/modules/settings/feature-models.ts`,
  `server/src/vendor/shared/contracts/platform.ts`, `server/src/platform/container.ts`,
  `reviewer-core/src/brief/risks.ts`, `server/src/db/rows.ts`,
  `server/src/adapters/mocks.ts` (`MockSecretsProvider`),
  `server/test/brief-populate.it.test.ts`, `server/test/settings-models.it.test.ts`.
- Skills considered: `backend-onion-architecture` (service/resolution layering — the fix
  lives in the `reviews` service + the `settings` resolver, no new ports), `zod` (the slot
  contract). Not read in full — the change is small and the existing override/default
  pattern is already in `feature-models.ts`; no schema or wire-contract change is needed.
- Deliberately skipped: `client/*`, `docs/architecture.md`, `e2e/` — the read path
  (`RisksService → GET /pulls/:id/risks → RisksCard`) is confirmed correct end-to-end by
  `server/INSIGHTS.md`; this is a server-side writer/resolution bug, no UI change.

## Root cause
- `BriefService.compute` (`brief.service.ts:48-53`) calls
  `resolveFeatureModel(container, workspaceId, 'risk_brief')`. `resolveFeatureModel`
  (`feature-models.ts:51-57`) returns the workspace override **or** `DEFAULTS['risk_brief']`,
  which is `{ provider: 'openai', model: 'gpt-4.1' }` (`platform.ts:59-65`).
- It then calls `container.llm('openai')`. With no OpenAI key, `buildLlm`
  (`container.ts:173-177`) throws `ConfigError('OPENAI_API_KEY is not configured')`.
- The run-executor wraps the whole brief step in try/catch (`run-executor.ts:182-191`) and
  only logs `risk brief: generation failed (...) — continuing`. No `pr_brief` row is written,
  so `getBrief` → `RisksService.get` → `GET /pulls/:id/risks` returns `null` and the card
  shows the empty state.
- **Why Intent still appears while risks don't (asymmetry resolved):** there is *no*
  special fallback for intent. `IntentService.compute` (`intent.service.ts:79-84`) resolves
  the **separate** `review_intent` slot the same way. Intent shows up only because that slot
  reaches a working provider for this user — either they set a `review_intent` override in
  Settings, or they have an OpenAI key. The `risk_brief` slot is left at the registry default
  and is never reachable. (Confirmed: there is no `sharedProvider` and no workspace-level
  "default LLM" — each agent carries its own `provider`/`model` on `AgentRow`
  (`db/rows.ts:12`, used at `run-executor.ts:147,217,225`), and the only other "default LLM"
  knobs are the per-feature slots in `feature_models`.)
- The reviewer agents that just ran *did* reach a working provider (the review succeeded and
  findings were persisted), so **an agent's `provider`/`model` is a known-good fallback** for
  the brief when the `risk_brief` slot is unset.

## Approach & tradeoffs
Use the already-existing `getFeatureModelOverride` vs `resolveFeatureModel` split. The
resolver file documents exactly this pattern (`feature-models.ts:30-35`): "Callers that keep
their own dynamic default … use [`getFeatureModelOverride`] directly so that default is
preserved." So:

1. `BriefService.compute` reads the **explicit** `risk_brief` override via
   `getFeatureModelOverride`. If set, honor it (the user's deliberate choice — unchanged).
2. If unset (the bug case), fall back to a **caller-supplied known-good** provider/model —
   the provider/model of a reviewer agent that just ran successfully in this batch — instead
   of the unreachable registry default.
3. As a last resort (no successful agent, e.g. brief computed outside a run), keep the
   registry default via `defaultFeatureModel('risk_brief')`.

The run-executor already loops the agents and knows which succeeded, so it passes the
fallback down. We use the agent's **own model** (not just its provider), because the model
must be valid for that provider — `gpt-4.1` is not a valid OpenRouter model id, so swapping
only the provider would still fail.

Rejected alternatives:
- **Reuse the resolved `review_intent` provider/model for `risk_brief`.** Couples two
  unrelated slots and is less robust — intent itself can fail/degrade (it's wrapped in the
  same non-fatal try/catch, `run-executor.ts:135-137`), so it is not a guaranteed-working
  source. The agent that produced persisted findings is a stronger signal.
- **Catch `ConfigError` in `BriefService` and probe other providers.** Hacky: there is no
  correct model to pair with a guessed provider, and it hides genuine misconfiguration.
- **Edit the vendored `risk_brief` default in `platform.ts`.** Forbidden by root `INSIGHTS.md`
  ("Prefer not to touch the vendored default at all"); the registry is triplicated across
  three files and any value there is still wrong for non-OpenAI users.

## Implementation steps

1. **Resolve risk_brief as override → caller fallback → registry default** —
   `server/src/modules/reviews/brief.service.ts`
   - Change type: modify
   - What:
     - Swap the import on line 5 from `{ resolveFeatureModel }` to
       `{ getFeatureModelOverride, defaultFeatureModel }` (both already exported from
       `feature-models.ts:26,36`).
     - Extend the `opts` parameter of `compute` with an optional
       `fallbackModel?: { provider: string; model: string }`.
     - Replace the resolution block (`brief.service.ts:47-53`):
       ```ts
       const override = await getFeatureModelOverride(this.container, workspaceId, 'risk_brief');
       const { provider, model } =
         override ?? opts?.fallbackModel ?? defaultFeatureModel('risk_brief');
       const llm = await this.container.llm(provider as 'openai' | 'anthropic' | 'openrouter');
       ```
     - Update the success log (`brief.service.ts:76-79`) to include `provider` and the
       resolution source (e.g. `source: override ? 'override' : opts?.fallbackModel ? 'agent-fallback' : 'default'`)
       so the Live Log shows which provider was used.
   - Verify: `cd server && ./node_modules/.bin/tsc --noEmit` passes; `resolveFeatureModel`
     is no longer imported here (`rg "resolveFeatureModel" server/src/modules/reviews/brief.service.ts`
     returns nothing).

2. **Pass a known-good fallback from the run-executor** —
   `server/src/modules/reviews/run-executor.ts`
   - Change type: modify
   - What:
     - In the agent loop (`run-executor.ts:144-177`), after a successful `runOneAgent`
       (the `try` branch that pushes to `finishedRunIds`, ~line 156), capture the first
       successful agent's provider/model into a `briefFallback` variable, e.g.
       `briefFallback ??= { provider: agent.provider, model: agent.model };` declared
       before the loop as `let briefFallback: { provider: string; model: string } | undefined;`.
     - In the brief block (`run-executor.ts:182-188`), pass it through:
       `await briefService.compute(workspaceId, pull.id, diff, { ...(sharedIntent ? { intent: sharedIntent } : {}), ...(briefFallback ? { fallbackModel: briefFallback } : {}), logger });`
   - Verify: `cd server && ./node_modules/.bin/tsc --noEmit` passes; manual read confirms the
     fallback is only set on the success path (so a brief still uses the registry default if
     every agent failed).

3. **Add a regression integration test reproducing the OpenRouter-only setup** —
   `server/test/brief-populate.it.test.ts`
   - Change type: modify (add one `it` block; reuse the file's fixtures + `setupRepoAndPr`)
   - What: add a test "populates risks when only OpenRouter is configured and risk_brief is
     unset" that builds the app with:
     - `secrets: new MockSecretsProvider({ OPENROUTER_API_KEY: 'or-test' })` — crucially **no**
       `OPENAI_API_KEY`, so `container.llm('openai')` throws `ConfigError` (reproduces the bug).
     - `llm: { openrouter: new MockLLMProvider('openrouter', { structuredBySchema: { Review: REVIEW_FIXTURE, Risks: RISKS_FIXTURE } }) }`
       — note **no** `openai` mock, so the only reachable provider is openrouter.
     - `git: new MockGitClient({ diff: DIFF })`, `github: new MockGitHubClient()`,
       `embedder: new MockEmbedder()` (as the existing tests do).
     - Create an agent with `provider: 'openrouter'`, `model: 'deepseek/deepseek-v4-flash'`.
     - POST `/pulls/:id/review`, `waitForPrRuns(..., { expected: 1 })`.
     - Assert: the run status is `done`; `getBrief(db, pr.id)` is defined and
       `brief.risks.risks` has length 1; `GET /pulls/:id/risks` returns non-null risks.
     - (Intent will degrade to `EMPTY_INTENT` because `review_intent` defaults to openai and
       throws — that's expected and proves risks no longer depend on the OpenAI key.)
   - Verify: `cd server && TESTCONTAINERS_RYUK_DISABLED=true ./node_modules/.bin/vitest run test/brief-populate.it.test.ts`
     — the new test passes; it **fails** against the pre-fix code (brief is `undefined`),
     proving it is a real regression guard.

4. **Confirm the resolver-level test is unaffected** —
   `server/test/settings-models.it.test.ts`
   - Change type: none (verification only)
   - What: `settings-models.it.test.ts:54` asserts `resolveFeatureModel(..., 'risk_brief')`
     still equals `{ provider: 'openai', model: 'gpt-4.1' }`. We did **not** change
     `resolveFeatureModel` or the registry, so this must stay green (it documents that the
     registry default is intentionally untouched).
   - Verify: `cd server && TESTCONTAINERS_RYUK_DISABLED=true ./node_modules/.bin/vitest run test/settings-models.it.test.ts` passes unchanged.

## Acceptance criteria
- `cd server && ./node_modules/.bin/tsc --noEmit` is clean.
- `cd server && TESTCONTAINERS_RYUK_DISABLED=true ./node_modules/.bin/vitest run test/brief-populate.it.test.ts test/settings-models.it.test.ts`
  passes — including the new OpenRouter-only regression test from step 3 and the two
  existing brief-populate tests (happy path + non-fatal failure).
- End-to-end behavioral check (the user-visible fix): in a workspace configured with **only**
  an OpenRouter key and an OpenRouter reviewer agent, and **no** `risk_brief` override in
  Settings, running a review on a PR writes a `pr_brief` row and `GET /pulls/:id/risks`
  returns a non-null `{ risks: [...] }`, so the RISKS card renders the risks instead of
  "No notable risks flagged." The Live Log shows `risk brief: model=<openrouter-model>`
  (source `agent-fallback`) rather than `risk brief: generation failed (... OPENAI_API_KEY ...)`.

## Risks / out of scope / open questions
- Risks:
  - The fallback uses the reviewer agent's model, which may be a heavier/pricier model than a
    dedicated risk-brief model. This is acceptable (it is known-working and the user can still
    pin a cheaper model via the Settings → Models `risk_brief` override, which now takes
    precedence). Note it in the success log so cost is visible.
  - `agent.provider` is a DB string cast to the provider union — consistent with the existing
    cast in `brief.service.ts:53` and `run-executor.ts:225` (`as Provider`). No new validation
    is added; an invalid persisted provider would still throw and be caught non-fatally.
  - Keep the brief step non-fatal — do not let a fallback miss (e.g. all agents failed, brief
    falls back to the registry default and throws) fail the review run; the existing
    try/catch at `run-executor.ts:182-191` must remain.
- Out of scope:
  - No change to the vendored registry defaults (`platform.ts` and its two client mirrors) —
    forbidden and unnecessary.
  - No client/UI change; the RISKS card and `GET /pulls/:id/risks` read path are correct.
  - No change to `blast`/`history` blocks — `EMPTY_BLAST`/`EMPTY_HISTORY` placeholders stay
    load-bearing so `PrBrief.safeParse` keeps passing (per `server/INSIGHTS.md`).
  - Not changing how `review_intent` resolves; intent's own reachability is a separate concern.
- Open questions / assumptions:
  - **Assumption:** the user's report stems from a `risk_brief` slot left at the registry
    default while a working provider (OpenRouter) exists via their reviewer agent. If instead
    they *did* set a `risk_brief` override to an unconfigured provider, that override is
    honored as-is (intentional) and the fix would not change it — that is correct behavior
    (respect explicit choice), and the empty card then signals genuine misconfiguration.
  - **Assumption:** picking the *first* successful agent's provider/model is sufficient. In a
    multi-agent run the agents typically share one provider in a single-provider workspace; if
    they differ, the first successful one is a reasonable, deterministic choice.
  - After implementing, append a `server/INSIGHTS.md` entry (via the `engineering-insights`
    skill) recording that `risk_brief` (and any future system-LLM slot) should resolve via
    `getFeatureModelOverride` + a known-good fallback rather than `resolveFeatureModel`, so
    the registry default never strands non-OpenAI workspaces.
