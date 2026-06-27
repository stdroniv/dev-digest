# Plan: Populate `pr_brief` during a review run (RisksCard shows real data)

## Understanding
The `pr_brief` table is never written, so `RisksCard` always renders "No notable
risks flagged." The entire read path already works end-to-end
(`getBrief` -> `RisksService.get` -> `GET /pulls/:id/risks` -> `useRisks` ->
`RisksCard`). The only missing piece is the WRITE side: a pure LLM step that
produces a `PrBrief`, a repo helper that persists it, and a call wired into the
review pipeline after findings are saved. This plan adds exactly those three
pieces, mirroring the proven Intent layer (`classifyIntent` in reviewer-core +
`IntentService.compute` + `upsertIntent`), plus a one-line client cache
invalidation so the card refreshes after a run without a manual reload.

## Context loaded
- Root `CLAUDE.md` (auto-loaded) + root `INSIGHTS.md` — "Looks greenfield, isn't"
  (mirror the pre-stubbed Intent layer, don't recreate tables/contracts); the
  `import type` Zod gotcha; `node_modules/.bin/*` test/typecheck invocations.
- `server/INSIGHTS.md` — the dedicated `pr_brief`-is-never-written entry (names the
  exact 3 missing pieces); the `@devdigest/shared` alias rule (no deep relative
  vendor paths); `MockLLMProvider.structuredBySchema` for per-schema test fixtures;
  `RunLogger` has no `warn` (use `runLog.info`, never `error`, for non-fatal notes).
- `reviewer-core/INSIGHTS.md` + `reviewer-core/CLAUDE.md` — stay pure (LLM is the
  only side effect, injected); reuse `INJECTION_GUARD` / `wrapUntrusted` for any
  prompt that consumes author-controlled PR content.
- `server/CLAUDE.md`, `client/CLAUDE.md` — schema-first routes; services delegate to
  repos; client data only via `src/lib/hooks/*`; do-not-touch `*/src/vendor/**`.
- Files read: `intent.service.ts`, `run-executor.ts`, `service.ts`, `risks.service.ts`,
  `repository/pull.repo.ts`, `intent-input.ts`, `routes.ts`, `diff-loader.ts`,
  `db/schema/reviews.ts`, `settings/feature-models.ts`, `reviewer-core/src/index.ts`,
  `reviewer-core/src/intent/classify.ts`, `vendor/shared/contracts/brief.ts`,
  `vendor/shared/contracts/platform.ts` (the `risk_brief` feature slot),
  `vendor/shared/adapters.ts` (`UnifiedDiff`, `LLMProvider.completeStructured`),
  client `page.tsx` (`onRunDone`), prior plan `docs/plans/risk-areas-card.md`.
- Skill consulted: `backend-onion-architecture` — confirms the layering used here:
  the pure LLM step lives in `reviewer-core` (domain core), orchestration in a
  module `*.service.ts` (application), persistence in `repository/*.repo.ts`
  (infrastructure). Deliberately skipped `drizzle-orm-patterns`/`postgresql-table-design`
  (no schema change — `pr_brief` already exists) and `zod` deep-dive (reusing the
  existing `PrBrief`/`Risks` contracts unchanged).

## CRITICAL constraint discovered
`getBrief` (`pull.repo.ts:72`) validates the stored row with `PrBrief.safeParse`
and returns `undefined` on failure. `PrBrief`
(`vendor/shared/contracts/brief.ts:127`) requires ALL FOUR blocks
(`intent`, `blast`, `risks`, `history`) as required (non-nullable) keys. So writing
only `{ risks }` would FAIL `safeParse` and read back as `undefined` -> the card
would still show the empty state. The writer MUST persist a complete `PrBrief`.
This plan generates `risks` via the LLM, reuses the already-computed `intent`, and
writes valid EMPTY placeholders for `blast` and `history` (those two blocks are out
of scope — see `docs/plans/risk-areas-card.md`).

## Approach & tradeoffs
Mirror the Intent layer one layer at a time so the new code matches the module's
established shape and each step is independently verifiable.

- **Pure risk generator in `reviewer-core` (mirrors `classifyIntent`).** A new
  `generateRiskBrief({ llm, model, title, body, intent, diff })` returning `Risks`
  + token/cost stats. Keeps the LLM call pure and mock-testable; the server only
  resolves the model, calls it, assembles, and persists.
  - *Rejected: generate risks inside the server service / run-executor directly.*
    That would put prompt assembly + an LLM round-trip in the application layer,
    diverging from how intent/reviews/conventions all keep the LLM step in the pure
    core, and would not be hermetically unit-testable.
- **A dedicated `BriefService.compute()` (mirrors `IntentService.compute`).**
  Resolves the `risk_brief` feature-model slot (already in `FEATURE_MODELS`,
  default `openai/gpt-4.1`), calls `generateRiskBrief`, assembles a full `PrBrief`,
  persists via `upsertBrief`. It accepts the already-loaded `UnifiedDiff` + the
  batch's shared intent rather than re-fetching from GitHub, because the executor
  has already paid that cost once for the whole run.
  - *Rejected: extend `IntentService`.* Different feature slot, different output
    contract, different cadence — a separate service keeps each single-responsibility
    and matches the one-service-per-concern shape of the `reviews` module.
- **Call once per run, after the agent loop, in `executeRuns` (not per-agent).**
  Intent is already computed once per batch there; the brief follows the same
  cadence so a multi-agent run writes the brief exactly once. "After findings are
  saved" is satisfied because every agent's `runOneAgent` has persisted its findings
  by the time the loop exits. Wrapped in a non-fatal try/catch (mirrors intent) so a
  brief failure never fails the review runs.
  - *Rejected: inside `runOneAgent` after `insertFindings`.* Would run N times for N
    agents (redundant LLM calls, last-writer-wins) and couple brief generation to a
    single agent's pass.
- **Risks derived from diff + intent + PR metadata, not from the persisted
  findings.** Mirrors intent (which also ignores findings) and keeps the generator
  pure and decoupled from multi-agent findings aggregation. Incorporating findings
  is a deliberate future enhancement (Out of scope).
- **One client cache invalidation.** `onRunDone` in the PR page currently
  invalidates active-runs / run-history / reviews but not `["risks", prId]`, so the
  card would need a reload. Add the risks key (and the sibling `intent` key) so the
  Overview tab updates live.

## Implementation steps

1. **Add the pure risk generator** — `reviewer-core/src/brief/risks.ts` (new file/dir)
   - Change type: add
   - What: mirror `intent/classify.ts`. **Value-import** the Zod schema you parse on
     (`import { Risks, type Intent } from '@devdigest/shared'`) plus
     `import type { LLMProvider, ChatMessage, UnifiedDiff } from '@devdigest/shared'`
     and `import { wrapUntrusted, INJECTION_GUARD, MAX_PR_DESCRIPTION_CHARS } from '../prompt.js'`.
     Export `interface GenerateRiskBriefInput { llm: LLMProvider; model: string;
     title: string; body?: string | null; intent?: Intent | null; diff: UnifiedDiff }`
     and `interface GenerateRiskBriefResult { risks: Risks; tokensIn: number;
     tokensOut: number; costUsd: number | null }`. Define a module-local
     `const MAX_DIFF_CHARS = 12000;` and a `RISK_SYSTEM` constant ("You are a merge-risk
     assessor… produce a JSON array of risks; each risk has `kind`, `title`,
     `explanation`, `severity` (high|medium|low), and `file_refs` citing changed
     files. Be concise and factual; report a real risk regardless of stated scope."
     ending with `+ INJECTION_GUARD`, echoing the scope-suppression invariant from
     reviewer-core/INSIGHTS). `export async function generateRiskBrief(input):
     Promise<GenerateRiskBriefResult>`: build a `parts: string[]` with PR title
     (sliced to `MAX_PR_DESCRIPTION_CHARS`), optional body, the intent summary +
     in/out-of-scope when `input.intent` is present, and the diff (`input.diff.raw.slice(0, MAX_DIFF_CHARS)`);
     send `messages = [{ role:'system', content: RISK_SYSTEM }, { role:'user', content:
     wrapUntrusted('pr-risks', parts.join('\n\n')) }]`; call
     `input.llm.completeStructured<Risks>({ model: input.model, schema: Risks,
     schemaName: 'Risks', messages, maxRetries: 2 })`; return
     `{ risks: res.data, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: res.costUsd }`.
   - Verify: `cd reviewer-core && node_modules/.bin/tsc --noEmit` passes.

2. **Export the generator from the package surface** — `reviewer-core/src/index.ts`
   - Change type: modify
   - What: add an export block next to the `classifyIntent` one:
     `export { generateRiskBrief, type GenerateRiskBriefInput, type GenerateRiskBriefResult } from './brief/risks.js';`
   - Verify: `cd reviewer-core && node_modules/.bin/tsc --noEmit` passes; the symbol
     resolves from `@devdigest/shared` consumers (server typecheck in step 4).

3. **Add `upsertBrief` repo helper** — `server/src/modules/reviews/repository/pull.repo.ts`
   - Change type: modify
   - What: under the existing `// ---- brief ----` section (next to `getBrief`), add
     `export async function upsertBrief(db: Db, prId: string, brief: PrBrief): Promise<void>`
     that does `db.insert(t.prBrief).values({ prId, json: brief }).onConflictDoUpdate({
     target: t.prBrief.prId, set: { json: brief } })`. `PrBrief` is already a value
     import at the top of this file (line 4) — no import change needed; `json` is the
     `jsonb` column (`db/schema/reviews.ts:61`).
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` passes; `upsertBrief` is
     exported and (still) unreferenced.

4. **Add `BriefService`** — `server/src/modules/reviews/brief.service.ts` (new)
   - Change type: add
   - What: mirror `intent.service.ts`. Imports (alias only, never deep vendor paths):
     `import type { BlastRadius, Intent, PrHistory, Risks, UnifiedDiff } from '@devdigest/shared'`,
     `import type { Container } from '../../platform/container.js'`,
     `import { generateRiskBrief } from '@devdigest/reviewer-core'`,
     `import { resolveFeatureModel } from '../settings/feature-models.js'`,
     `import { getPull, getIntent, upsertBrief } from './repository/pull.repo.js'`,
     `import { NotFoundError } from '../../platform/errors.js'`. Define valid empty
     placeholders so the persisted `PrBrief` passes `getBrief`'s `safeParse`:
     `const EMPTY_BLAST: BlastRadius = { changed_symbols: [], downstream: [], summary: '' };`
     `const EMPTY_HISTORY: PrHistory = { history: [] };`
     `const EMPTY_INTENT: Intent = { intent: '', in_scope: [], out_of_scope: [] };`.
     Class `BriefService { constructor(private readonly container: Container) {} }`
     with `async compute(workspaceId: string, prId: string, diff: UnifiedDiff,
     opts?: { intent?: Intent; logger?: { info: (o: unknown, m?: string) => void } }):
     Promise<{ risks: Risks; tokensIn: number; tokensOut: number; costUsd: number | null }>`.
     Body: `const pull = await getPull(this.container.db, workspaceId, prId); if (!pull)
     throw new NotFoundError(\`PR ${prId} not found\`);` resolve intent =
     `opts?.intent ?? (await getIntent(this.container.db, prId)) ?? EMPTY_INTENT;`
     resolve model `const { provider, model } = await resolveFeatureModel(this.container,
     workspaceId, 'risk_brief'); const llm = await this.container.llm(provider as
     'openai' | 'anthropic' | 'openrouter');` call `const result = await
     generateRiskBrief({ llm, model, title: pull.title, body: pull.body, intent, diff });`
     assemble `const brief: PrBrief = { intent, blast: EMPTY_BLAST, risks: result.risks,
     history: EMPTY_HISTORY };` (value-import `PrBrief` too for the type) then
     `await upsertBrief(this.container.db, prId, brief);` log
     `opts?.logger?.info(..., \`risk brief: model=${model} risks=${result.risks.risks.length}\`)`
     and `return result;`.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` passes.

5. **Wire brief generation into the run pipeline** — `server/src/modules/reviews/run-executor.ts`
   - Change type: modify
   - What: `import { BriefService } from './brief.service.js';` (top, beside the
     `IntentService` import, line 16). In `executeRuns`, AFTER the `for (const { agent,
     runId } of jobs) { … }` loop closes (after line 169) and before the method
     returns, add a once-per-run, non-fatal block (mirrors the intent try/catch at
     lines 119-136):
     `try { const briefService = new BriefService(this.container);
     await briefService.compute(workspaceId, pull.id, diff, { ...(sharedIntent ?
     { intent: sharedIntent } : {}), logger }); runLog.info(\`risk brief: persisted for
     PR ${pull.number}\`); } catch (err) { runLog.info(\`risk brief: generation failed
     (${(err as Error).message}) — continuing\`); }`. Use `runLog.info` only (never
     `runLog.error`, which would style the run as failed — see server/INSIGHTS
     `RunLogger` note).
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` passes; a real review run
     (step in Acceptance) writes a `pr_brief` row.

6. **Refresh risks (and intent) on the client after a run** — `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`
   - Change type: modify
   - What: in the `onRunDone` handler (around lines 169-173, where
     `invalidateActiveRuns()/invalidateRunHistory()/refetchReviews()` are called) add
     `if (prId) { qc.invalidateQueries({ queryKey: ["risks", prId] });
     qc.invalidateQueries({ queryKey: ["intent", prId] }); }`. Query keys per
     `client/src/lib/hooks/brief.ts` (`["risks", prId]` line 26, `["intent", prId]`
     line 14). No new hook needed — `useRisks` already exists.
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` passes; after a review run
     the RisksCard updates with no manual reload.

7. **Unit-test the pure generator** — `reviewer-core/test/risks.test.ts` (new)
   - Change type: add
   - What: mirror `reviewer-core/test/classify.test.ts`. Inject a stub `LLMProvider`
     whose `completeStructured` returns a `Risks` fixture
     (`{ risks: [{ kind:'regression', title:'…', explanation:'…', severity:'high',
     file_refs:['src/a.ts'] }] }`) with `tokensIn/tokensOut/costUsd`. Assert
     `generateRiskBrief(...)` returns those risks, and assert the assembled user
     message is `wrapUntrusted`-fenced (contains the fence label `pr-risks`) and that
     the diff text was included (capped). Add a case asserting an empty
     `{ risks: [] }` round-trips.
   - Verify: `cd reviewer-core && node_modules/.bin/vitest run test/risks.test.ts` green.

8. **Integration-test the write path end-to-end** — `server/test/brief-populate.it.test.ts` (new, `.it.test.ts` suffix = DB-backed)
   - Change type: add
   - What: mirror `server/test/intent-auto-review.it.test.ts`'s `appWith` setup but
     inject `llm: new MockLLMProvider({ structuredBySchema: { Intent: INTENT_FIXTURE,
     Review: REVIEW_FIXTURE, Risks: RISKS_FIXTURE } })` (the per-schema routing from
     server/INSIGHTS — needed because one run calls all three schemas). Seed a repo +
     PR with `pr_files` patches (so `loadDiff` reconstructs a diff with no GitHub),
     run `POST /pulls/:id/review` with `{ all: true }` (or call the executor directly),
     await run completion, then assert: (a) `getBrief(db, prId)` returns a defined
     `PrBrief` whose `risks.risks` matches `RISKS_FIXTURE`; (b) `GET /pulls/:id/risks`
     returns `{ risks: [...] }` (not `null`); (c) the persisted `pr_brief.json` passes
     `PrBrief.safeParse` (proves blast/history placeholders are valid).
   - Verify: `cd server && TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest
     run test/brief-populate.it.test.ts` green (Bash sandbox disabled for Docker).

## Acceptance criteria
- **Typecheck (all three packages):**
  `cd reviewer-core && node_modules/.bin/tsc --noEmit`,
  `cd server && node_modules/.bin/tsc --noEmit`,
  `cd client && node_modules/.bin/tsc --noEmit` each exit 0.
- **Unit + integration:**
  `cd reviewer-core && node_modules/.bin/vitest run test/risks.test.ts` and
  `cd server && TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run test/brief-populate.it.test.ts`
  both pass.
- **Live write path:** with the stack running (`./scripts/dev.sh`, DB migrated +
  seeded, an LLM key in `~/.devdigest/secrets.json`), trigger a review on a PR
  (`POST localhost:3001/pulls/<prId>/review` `{"all":true}`), wait for the run to
  finish, then `curl -s localhost:3001/pulls/<prId>/risks` returns
  `{"risks":[...]}` (was `null` before). A `pr_brief` row now exists for that PR.
- **End-to-end (UI):** open that PR's Overview tab — the Risks section lists real
  risks with high/medium/low badges, titles, explanations, and file refs (no longer
  "No notable risks flagged."), and it updates immediately after a run completes
  without a manual reload.
- (Canonical `cd <pkg> && pnpm typecheck` / `pnpm test` are the documented
  equivalents; this repo's pnpm pre-flight is broken offline, so the
  `node_modules/.bin/*` forms above are the reliable invocations — see root INSIGHTS.)

## Risks / out of scope / open questions
- **Risks / careful-with:**
  - Do NOT edit `*/src/vendor/**` — `Risks`/`PrBrief`/`BlastRadius`/`PrHistory`
    contracts and the `risk_brief` feature slot already exist there; import via
    `@devdigest/shared`, never deep-relative (server/INSIGHTS alias rule).
  - **Value-import the schemas you parse on** (`Risks`, `PrBrief`): `import type`
    erases them and `.safeParse`/`completeStructured({ schema })` throws at runtime
    (root + server INSIGHTS gotcha). Type-only symbols (`Intent`, `UnifiedDiff`,
    `BlastRadius`, `PrHistory`) stay `type`.
  - No DB migration: `pr_brief` exists; do not add/alter schema or edit old migrations.
  - The persisted JSON must be a COMPLETE `PrBrief` (all four blocks) or `getBrief`'s
    `safeParse` silently rejects it — the EMPTY_BLAST/EMPTY_HISTORY/EMPTY_INTENT
    placeholders in step 4 are load-bearing, not cosmetic.
  - Non-fatal wiring: brief generation must never fail a review run (use the
    try/catch + `runLog.info`, never `runLog.error`).
  - Default `risk_brief` model is `openai/gpt-4.1` (not cheap) — out of the box it
    needs an OpenAI key; with no key `container.llm` throws and the step degrades
    gracefully (logged, run continues, no brief written).
- **Out of scope:** the Blast radius and PR History blocks (written as empty
  placeholders only); deriving risks from persisted findings; a manual
  recompute/POST endpoint for the brief; the read path (route/service/hook/card all
  already exist and work); new locales; backfilling briefs for already-reviewed PRs
  (they populate on the next run).
- **Open questions / assumptions:**
  - **Assumption:** brief runs once per batch in `executeRuns` after the agent loop
    (not per-agent). If product wants per-agent or on-demand recompute, add a
    `POST /pulls/:id/brief` route + a `BriefService` read/recompute split later.
  - **Assumption:** EMPTY placeholders for blast/history are acceptable interim
    values until those lessons land; they satisfy the contract and the
    blast/history UI is not yet built.
  - **Assumption:** risks are derived from `diff.raw` (capped at `MAX_DIFF_CHARS`)
    + intent + title/body; if a future lesson wants findings-informed risks, extend
    `GenerateRiskBriefInput` with a findings summary and pass it from the executor
    after the loop (findings are persisted by then).
