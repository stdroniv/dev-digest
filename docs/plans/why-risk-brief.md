# Implementation Plan: Why+Risk Brief (SPEC-03)

## Overview

The Why+Risk Brief is a new, **standalone** per-PR artifact that collapses five
already-computed signals — intent, blast summary, grouped diff statistics, the linked
issue, and the repo's discovered Context docs — into one glanceable card: a short *what*,
a *why/intent*, one overall colored *risk level*, a grounded *risks* list, and a
prioritized *review-focus* ("read these first") list. It is synthesized in a single
structured LLM pass **without** reading raw diff/code bodies, every file/endpoint
reference is grounded against real changed files and blast-impacted endpoints, and it is
advisory only — never a merge gate. It coexists with, and never modifies, the pre-existing
composite `pr_brief` scaffolding.

## Execution mode

**multi-agent (parallel)** — user-confirmed. The work spans reviewer-core (generator + two
pure algorithms), a vendored contract synced across packages, a Drizzle migration, server
repo/service/2 routes, a new feature-model slot, and a client hook + card (~15+ files, 3
packages). Phase 1 lands the contract + migration + slot so every downstream agent codes
against fixed signatures; Phase 2 fans out reviewer-core, server, and client on
non-overlapping Owned paths with an explicit Depends-on DAG; Phase 3 mounts + verifies.

## Requirements (verified)

Every AC below is restated from `specs/SPEC-03-2026-07-02-why-risk-brief.md` and mapped to
its owning task(s). Tasks are defined in "Phased tasks".

**Content & shape**
- R-AC1 — one brief = {what line, why/intent, exactly one risk level, risks[], review-focus[]}. → Contract T1; generator T5; card T10.
- R-AC2 — risk level on fixed 3-value scale (low|medium|high), distinct color per value. → Contract T1; card T10.
- R-AC3 — each risk = short description + one-or-more references; NO per-risk severity. → Contract T1; generator T5; grounding T6.
- R-AC4 — each review-focus item = link to a single real file in the PR. → Contract T1; grounding T6; card T10.
- R-AC5 — single structured model pass over ONLY intent, blast, grouped diff stats, linked issue, Context docs; NO raw diff/code lines. → Generator T5; service assembles inputs T7.

**Review-focus ordering**
- R-AC6 — order review-focus by reviewer priority (core-group + higher blast-impact first); never alphabetical/by filename. → Generator prompt T5; order-preserving grounding T6.

**Grounding of references**
- R-AC7 — file ref grounded only if it's a changed file; endpoint ref grounded only if a blast-impacted endpoint. → Grounding T6; oracle assembly T7.
- R-AC8 — ungrounded ref removed before returning. → Grounding T6.
- R-AC9 — risk with ≥1 grounded ref after removal is kept (with only grounded refs). → Grounding T6.
- R-AC10 — risk/review-focus item with 0 grounded refs after removal is dropped entirely. → Grounding T6.

**Generation, caching, read path**
- R-AC11 — generate request (re)computes and replaces the cached brief. → Service compute T7; repo upsert T4; POST route T8.
- R-AC12 — read returns the cached brief without recomputing. → Service get T7; GET route T8.
- R-AC13 — read before any generation → explicit "not generated" state (no generation). → Service get T7; GET route T8; card T10.
- R-AC14 — never auto-generate on page load/read; only on explicit request. → No auto-mutation on card T10; GET route never computes T8.

**Staleness**
- R-AC15 — cached brief + an input (intent/blast/smart-diff) changed since generation → read serves cache + may-be-stale indication. → Fingerprint T7; service get compares T7; card badge T10.
- R-AC16 — never auto-recompute on input change (regeneration always reviewer-initiated). → Service get never computes T7.

**Degraded & missing inputs**
- R-AC17 — intent is the only mandatory input; others are optional enrichers. → Service compute T7.
- R-AC18 — no intent → refuse to generate; read returns "not available yet". → Service compute + get T7; POST/GET routes T8; card T10.
- R-AC19 — intent present + optional inputs missing/degraded → partial brief, reduced sections, no fabrication. → Service input assembly T7; generator T5; grounding T6.
- R-AC20 — no LLM provider configured → "skipped: no model configured" state, not an error; card shows reason. → Model resolution T7; POST route T8; card T10.
- R-AC21 — no resolvable linked issue → generate without it; absence is not a failure. → Service input assembly T7.
- R-AC22 — diff-only repo (blast degraded) → still produce; endpoint risks + blast-derived focus reduced. → Service input assembly T7; grounding T6.

**Context-doc budget**
- R-AC23 — Context docs over budget → bounded, deterministic, documented selection; same PR+repo state → same selection. → Doc-budget selector T6; service supplies docs T7.
- R-AC24 — doc set truncated → indicate doc context was incomplete. → Selector `truncated` flag T6; contract T1; card T10.

**Untrusted input isolation**
- R-AC25 — all foreign text presented as untrusted data isolated from instructions; never act on embedded instructions. → Generator `wrapUntrusted` T5.

**Distinct artifact**
- R-AC26 — store/serve as artifact distinct from composite `pr_brief`; (re)generation must not modify it. → New table T2; new repo (never touches `pr_brief`) T4.

**Non-functional**
- R-AC27 — ≤1 model round-trip per generation. → Generator T5 (single `completeStructured`); service T7.
- R-AC28 — ≤10 generation requests/min; reject excess rather than issue further model calls. → POST route rate-limit T8.
- R-AC29 — advisory tier; cheaper model allowed; prose reproducibility not required (grounding still is). → Feature-model slot T3; model resolution T7.

**Edge cases (spec §Edge cases) — explicit owners**
- Never-generated read → "not generated" empty state + trigger. → T7/T8/T10.
- Concurrent regeneration → single cached brief; last write wins. → Repo `onConflictDoUpdate` on `prId` T4; service T7.
- All refs ungrounded → empty risks/focus rather than dead links; card shows empty-but-generated. → Grounding T6; card T10 (Rec-2).
- Zero Context docs → brief produced, nothing to truncate. → Service T7 (docs optional).

## Open questions & recommendations

- Q1 → answered: **new dedicated `why_risk_brief` feature-model slot** (independent advisory tier).
- Q2 → answered: **new `server/src/modules/why-risk-brief/` module**; both routes added to existing `reviews/routes.ts`.
- Q3 → answered: on GET, **recompute deterministic inputs (intent read + blast + smart-diff), hash, compare to stored fingerprint, set `stale:true` on mismatch; never a model call on read**.
- Q4 → answered: **grounding filter + deterministic doc-budget selector are pure functions in `reviewer-core/src/why-risk-brief/`**; server passes oracle sets + raw doc set in.
- Q5 → answered (with a forced refinement): kind-tagged ref shape. **Refinement:** because `blast.impactedEndpoints` is a flat `string[]` (no method/path split — verified in `server/src/modules/blast/types.ts`), the ref is `{ kind: 'file'|'endpoint', value: string }` (a single tagged string) rather than a `{method,path}` object; grounding matches by set membership against changed files / impacted-endpoint strings. This also keeps the structured-output schema union-free.
- Q6 → answered: **reuse the existing per-route rate-limit config** (`config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`, as on `POST /pulls/:id/intent`, `reviews/routes.ts:59-61`) on the POST. It exists — reuse, do not invent.
- Q7 → answered: **unit (reviewer-core generator + grounding + doc-budget) + DB-backed `*.it.test.ts` (repo + service + route states) + client component test; no new e2e**.
- Rec-1 → accepted: the linked issue is **input-only** — do NOT render an issue link or extend `getIssue`/`IssueMeta` (`IssueMeta` confirmed to have no `html_url`).
- Rec-2 → accepted: **"empty-but-generated"** (valid brief, grounding stripped all risks/focus) is a distinct first-class UI state from "not generated", "not available yet", and "skipped".

## Affected modules & contracts

- **reviewer-core** (`@devdigest/reviewer-core`) — NEW pure module `src/why-risk-brief/`: single-pass generator, grounding filter, deterministic Context-doc selector. Re-exported from `src/index.ts`. No I/O (only the injected `LLMProvider`).
- **server** (`@devdigest/api`) — NEW module `src/modules/why-risk-brief/` (service + repository + pure input builders + fingerprint). TWO new routes added to the existing `src/modules/reviews/routes.ts`. NEW Drizzle table + migration. NEW feature-model slot `why_risk_brief`.
- **client** (`@devdigest/web`) — NEW hooks in `src/lib/hooks/brief.ts`; NEW component folder `PrBriefCard/`; NEW i18n namespace `whyRiskBrief`; mounted in `OverviewTab.tsx`. Client-runtime feature-model mirror updated.
- **Contracts** (NEW file `contracts/why-risk-brief.ts`, hand-vendored byte-identical into `server/`, `client/`, `mcp/` `src/vendor/shared/`; reviewer-core resolves via server's copy; e2e has no copy):
  - `WhyRiskLevel = enum('low','medium','high')` (AC-2).
  - `BriefRef = { kind: enum('file','endpoint'), value: string }` — kind-tagged flat string (see Q5 refinement). Grounding: `kind:'file'` → `value ∈ changedFiles`; `kind:'endpoint'` → `value ∈ impactedEndpoints`.
  - `WhyRiskItem = { description: string, refs: BriefRef[] }` — NO per-risk severity (AC-3).
  - `WhyRiskFocusItem = { path: string }` — a single real file link (AC-4).
  - `WhyRiskBrief = { what, why, risk_level: WhyRiskLevel, risks: WhyRiskItem[], review_focus: WhyRiskFocusItem[] }` (AC-1) — BOTH the LLM structured-output schema AND the stored grounded payload.
  - `WhyRiskBriefState` (read/generate envelope, discriminated on `status`): `{status:'not_available'}` (AC-18) | `{status:'not_generated'}` (AC-13) | `{status:'skipped', reason:'no_model'}` (AC-20) | `{status:'ready', brief: WhyRiskBrief, stale: boolean, docs_truncated: boolean, generated_at: string}` (AC-11/12/15/24). Both routes return this envelope with HTTP 200 (honours "never throw" on degraded/missing inputs).
- **Feature-model registry** (`FeatureModelId` enum + `FEATURE_MODELS`): add `why_risk_brief` additively — no existing contract member changed.

## Architecture changes

- `reviewer-core/src/why-risk-brief/generate.ts` — pure inner-core generator (depends only on injected `LLMProvider` + `@devdigest/shared`).
- `reviewer-core/src/why-risk-brief/grounding.ts`, `.../select-docs.ts` — pure functions, no I/O.
- `reviewer-core/src/index.ts` — public re-exports (owned by T5).
- `server/src/modules/why-risk-brief/{service,repository,input,fingerprint}.ts` — Application (service) + Infrastructure (repository/Drizzle) + pure helpers. Presentation = the two routes in `reviews/routes.ts`.
- `server/src/db/schema/reviews.ts` (+ `schema.ts` barrel) — new `why_risk_brief` table; new append-only migration under `src/db/migrations/`.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/` — `"use client"` component mirroring `IntentCard`.

## Phased tasks

### Phase 1 — Contracts, storage, slot (foundation; complete before any Phase 2 task)

T1/T2/T3 are mutually independent (disjoint files) and MAY run in parallel, but ALL must
complete before Phase 2 begins — every downstream agent codes against their fixed signatures.

#### T1 — Add the `why-risk-brief` shared contract (vendored ×3)
- **Action:** Create `contracts/why-risk-brief.ts` defining `WhyRiskLevel`, `BriefRef`, `WhyRiskItem`, `WhyRiskFocusItem`, `WhyRiskBrief`, and `WhyRiskBriefState` (shapes above). Add byte-identically into `server/`, `client/`, `mcp/` `src/vendor/shared/contracts/`, and export the symbols from each package's `src/vendor/shared/index.ts`. Do NOT touch `reviewer-core` (aliases `@devdigest/shared` → server's copy) or `e2e` (no alias).
- **Module:** server + client + mcp (vendored contract)
- **Type:** core
- **Skills to use:** `zod`, `client-server-communication`
- **Owned paths:** `server/src/vendor/shared/contracts/why-risk-brief.ts`, `server/src/vendor/shared/index.ts`, `client/src/vendor/shared/contracts/why-risk-brief.ts`, `client/src/vendor/shared/index.ts`, `mcp/src/vendor/shared/contracts/why-risk-brief.ts`, `mcp/src/vendor/shared/index.ts`
- **Depends-on:** none
- **Risk:** medium
- **Known gotchas:** No vendor sync script — the three copies are hand-maintained and MUST be byte-identical (root `INSIGHTS.md`; verify with `md5`). Keep it a pure Zod module (value exports, not `import type`) so `.safeParse` works downstream (server `INSIGHTS.md`). Use **snake_case** fields (`risk_level`, `review_focus`, `docs_truncated`, `generated_at`) to match the dominant convention — `api.ts` does zero key remapping, so client↔server keys must match verbatim (root `INSIGHTS.md` mixed-naming note).
- **Acceptance:** `node_modules/.bin/tsc --noEmit` passes in `server/`, `client/`, `mcp/`; the three `why-risk-brief.ts` copies have identical `md5`; `WhyRiskBrief.safeParse({what:'x',why:'y',risk_level:'low',risks:[],review_focus:[]}).success === true`.

#### T2 — Add the `why_risk_brief` table + migration
- **Action:** Add a `whyRiskBrief` Drizzle table to `server/src/db/schema/reviews.ts` and export it via the `server/src/db/schema.ts` barrel. Columns: `prId` uuid PK → `pull_requests(id)` `onDelete:'cascade'` (one brief per PR → last-write-wins on conflict); `brief` jsonb (grounded `WhyRiskBrief`); `docsTruncated` boolean not-null default false; `degradedInputs` jsonb nullable (which optional inputs were missing/degraded, AC-19/22 display); `inputsFingerprint` text not-null (AC-15); `model` text nullable; `costUsd` numeric nullable; `tokensIn`/`tokensOut` integer nullable; `generatedAt` timestamptz not-null default now(). Generate with `cd server && pnpm db:generate`, apply with `pnpm db:migrate`.
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `postgresql-table-design`
- **Owned paths:** `server/src/db/schema/reviews.ts`, `server/src/db/schema.ts`, `server/src/db/migrations/**` (new file only), `server/src/db/rows.ts` (optional row type)
- **Depends-on:** none
- **Risk:** medium
- **Known gotchas:** Migrations are NOT applied on boot and existing migrations are append-only — never edit an old one, only add the newly-generated file (root + server `CLAUDE.md`). This NEW table sidesteps the four-block `PrBrief.safeParse` trap entirely — do NOT reuse/extend `pr_brief` (server `INSIGHTS.md`). Do not delete or alter any existing table.
- **Acceptance:** the new migration file exists under `src/db/migrations/`; `pnpm db:migrate` completes clean on a fresh DB; `tsc --noEmit` passes with the table in the barrel; `\d why_risk_brief` shows the columns above.

#### T3 — Register the `why_risk_brief` feature-model slot
- **Action:** Add `'why_risk_brief'` to the `FeatureModelId` enum and a matching `FEATURE_MODELS` entry (id/label/description/`defaultProvider`/`defaultModel`) in `server/`, `client/`, `mcp/` vendored `contracts/platform.ts` (byte-synced), plus the client runtime mirror `client/src/lib/feature-models.ts`. Choose a **cheap advisory-tier** default model (AC-29) — not a premium tier.
- **Module:** server + client + mcp (vendored) + client runtime
- **Type:** backend
- **Skills to use:** `zod`, `client-server-communication`
- **Owned paths:** `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/platform.ts`, `mcp/src/vendor/shared/contracts/platform.ts`, `client/src/lib/feature-models.ts`
- **Depends-on:** none
- **Risk:** medium
- **Known gotchas:** The registry is triplicated + a 4th client runtime mirror with NO sync script — all four edits must be identical in shape (root `INSIGHTS.md`). `feature_models` validation is `z.record(FeatureModelId, …)`, so extending the enum auto-extends settings — no separate validation file. `SettingsModels.tsx` iterates `FEATURE_MODELS` and picks up the new slot automatically once the runtime mirror is edited.
- **Acceptance:** `tsc --noEmit` passes in `server/`, `client/`, `mcp/`; `defaultFeatureModel('why_risk_brief')` returns the chosen cheap provider+model; the three vendored `platform.ts` enum/registry blocks are identical.

### Phase 2 — Engine, storage, service, routes, client (fan-out)

reviewer-core chain (T6 → T5), server chain (T4, then T7 → T8), and client chain
(T9 → T10) run concurrently on disjoint Owned paths.

#### T4 — Why+Risk Brief repository (server)
- **Action:** Create `server/src/modules/why-risk-brief/repository.ts` with `getWhyRiskBrief(db, prId)` (reads the row, `WhyRiskBrief.safeParse` the `brief` jsonb, returns row-with-parsed-brief or `undefined`) and `upsertWhyRiskBrief(db, prId, data)` (`onConflictDoUpdate` on `prId` → **last-write-wins** for concurrent regen, AC-11 + concurrent-regeneration edge case). Mirror `getIntent`/`upsertIntent`.
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `backend-onion-architecture`
- **Owned paths:** `server/src/modules/why-risk-brief/repository.ts`, `server/src/modules/why-risk-brief/repository.it.test.ts`
- **Depends-on:** T1, T2
- **Risk:** low
- **Known gotchas:** Import `WhyRiskBrief` as a **value** (`import { WhyRiskBrief } from '@devdigest/shared'`), never `import type` — the latter strips the runtime object and `.safeParse` throws (server `INSIGHTS.md`). Repositories must NOT throw domain errors — return `undefined`/data (server `INSIGHTS.md`). Use the `@devdigest/shared` alias, never a deep `../../vendor/...` path.
- **Acceptance:** `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run src/modules/why-risk-brief/repository.it.test.ts` green: (a) `undefined` when no row; (b) round-trip preserves `brief`/`docsTruncated`/`inputsFingerprint`; (c) two sequential upserts for one `prId` leave exactly one row with the **latest** payload.

#### T6 — reviewer-core grounding filter + Context-doc selector (pure)
- **Action:** `reviewer-core/src/why-risk-brief/grounding.ts` exporting `groundBriefRefs(brief, oracle: { changedFiles: Set<string>; impactedEndpoints: Set<string> }): WhyRiskBrief` — per risk drop refs whose `value ∉` its oracle (AC-7/8); keep a risk iff ≥1 grounded ref remains, with only those refs (AC-9); drop 0-grounded risks (AC-10); drop `review_focus` items whose `path ∉ changedFiles` (AC-4/10); **removal only — never reorder** so AC-6 order survives. And `reviewer-core/src/why-risk-brief/select-docs.ts` exporting `selectContextDocs(docs: {path;root;tokens}[], budgetTokens): { selected: {path;root;tokens}[]; truncated: boolean }` — a **documented deterministic total ordering** (root priority `specs > docs > insights`, then `tokens` asc, then `path` asc) greedily filling the budget; `truncated=true` iff any doc excluded (AC-23/24). Budget = a named constant.
- **Module:** reviewer-core
- **Type:** core
- **Skills to use:** `typescript-expert`, `backend-onion-architecture`
- **Owned paths:** `reviewer-core/src/why-risk-brief/grounding.ts`, `reviewer-core/src/why-risk-brief/grounding.test.ts`, `reviewer-core/src/why-risk-brief/select-docs.ts`, `reviewer-core/src/why-risk-brief/select-docs.test.ts`
- **Depends-on:** T1
- **Risk:** low
- **Known gotchas:** Stay pure — no DB/HTTP/FS (reviewer-core `CLAUDE.md`); the selector receives `ProjectDocument`-shaped descriptors (with `tokens`) and returns which to read — it never reads files (server reads content for the selected subset). The sort must be total (tie-break to `path`) so the same input always yields the same selection (AC-23).
- **Acceptance:** `node_modules/.bin/vitest run src/why-risk-brief/grounding.test.ts src/why-risk-brief/select-docs.test.ts` green: grounding drops an ungrounded file ref (AC-8), keeps a risk retaining only its grounded ref (AC-9), drops a 0-grounded risk and a 0-grounded focus item (AC-10), grounds an endpoint ref only when in `impactedEndpoints` (AC-7); selector is idempotent on shuffled input (same output), `truncated=true` + budget respected when over, `truncated=false` when under.

#### T5 — reviewer-core single-pass generator
- **Action:** `reviewer-core/src/why-risk-brief/generate.ts` exporting `generateWhyRiskBrief(input): Promise<{ brief: WhyRiskBrief; tokensIn; tokensOut; costUsd }>`. Input carries injected `{ llm, model }` plus **plain, already-assembled** blocks (keeps reviewer-core decoupled from server-only types): `intent: Intent`, `blastBlock: string | null`, `smartDiffBlock: string | null`, `linkedIssue: {title;body?} | null`, `contextDocs: {path;content}[]`, and oracles `changedFiles: string[]`, `impactedEndpoints: string[]`. Assemble ONE user message wrapping every foreign block via `wrapUntrusted(label, content)` + `INJECTION_GUARD` (AC-25); system prompt: produce `what`/`why`/one `risk_level`/`risks` (each short description + ≥1 ref, NO per-risk severity — AC-3) / `review_focus` ordered by **reviewer priority — core-group + higher blast-impact first, never alphabetical** (AC-6); NEVER emit raw diff/code (AC-5). Make exactly ONE `llm.completeStructured<WhyRiskBrief>({ schema: WhyRiskBrief, schemaName: 'WhyRiskBrief', messages, maxRetries })` (AC-27), then apply `groundBriefRefs` (T6) before returning (AC-7–10). Re-export `generateWhyRiskBrief`, `groundBriefRefs`, `selectContextDocs` from `reviewer-core/src/index.ts`.
- **Module:** reviewer-core
- **Type:** core
- **Skills to use:** `typescript-expert`
- **Owned paths:** `reviewer-core/src/why-risk-brief/generate.ts`, `reviewer-core/src/why-risk-brief/generate.test.ts`, `reviewer-core/src/index.ts`
- **Depends-on:** T1, T6
- **Risk:** medium
- **Known gotchas:** Mirror `classifyIntent`/`generateRiskBrief` structure exactly. `wrapUntrusted` escapes BOTH label and content — pass each doc `path` as the label (attacker-influenceable) (reviewer-core `CLAUDE.md`). Cap each foreign block (reuse `MAX_PR_DESCRIPTION_CHARS`). Grounding runs INSIDE the generator so the returned brief is already clean.
- **Acceptance:** `node_modules/.bin/vitest run src/why-risk-brief/generate.test.ts` green with `MockLLMProvider` (`structuredBySchema: { WhyRiskBrief: fixture }`): exactly one `completeStructured` call (AC-27); the user message contains `<untrusted` wrappers for doc/issue/blast blocks (AC-25) and no raw `+`/`-` diff lines (AC-5); refs absent from the supplied oracles are stripped from the returned brief (AC-8/10 via T6).

#### T7 — Why+Risk Brief service (compute + get) + input builders + fingerprint
- **Action:** Create `server/src/modules/why-risk-brief/service.ts` (`WhyRiskBriefService` — deliberately NOT `BriefService`, which the composite owns), `input.ts` (pure `buildBlastBlock(blast)`, `buildSmartDiffBlock(smartDiff)`, changed-file extraction, and `resolveReachableModel(container)` mirroring `BlastSummaryService.resolveCheapLlm`), and `fingerprint.ts` (`fingerprintInputs(intent, blast, smartDiff): string` — canonical stringify + `node:crypto` sha256; pure, deterministic).
  - `compute(workspaceId, prId, {logger}) → WhyRiskBriefState`: `getPull` (404 if PR absent) → `getIntent`; null ⇒ `{status:'not_available'}`, NO model call (AC-17/18). Probe providers via `resolveReachableModel`; none ⇒ `{status:'skipped', reason:'no_model'}`, persist nothing (AC-20). Resolve model via `resolveFeatureModelWithFallback(container, workspaceId, 'why_risk_brief', reachable)` (override → reachable cheap → registry default — handles non-OpenAI-only workspaces, server `INSIGHTS.md`). Gather optional enrichers best-effort, each degrading to null without throwing: `BlastService.getBlast` (diff-only/degraded OK, AC-22), `SmartDiffService.get`, linked issue via `container.github().getPullRequest` in try/catch (AC-21, mirror `IntentService`), Context docs via `DocumentsService.discover(repo)` → `selectContextDocs(docs, BUDGET)` → `readContent` for the selected subset only. Build oracles: `changedFiles` from `getPrFiles`, `impactedEndpoints` from `blast.impactedEndpoints` (`[]` when degraded). Call `generateWhyRiskBrief` (single round-trip, AC-27). Compute `inputsFingerprint = fingerprintInputs(intent, blast, smartDiff)`. `upsertWhyRiskBrief` (AC-11). Return `{status:'ready', brief, stale:false, docs_truncated, generated_at}`.
  - `get(workspaceId, prId) → WhyRiskBriefState`: `getPull` (404 if absent) → `getWhyRiskBrief`. No row: `getIntent` null ⇒ `{status:'not_available'}` (AC-18) else `{status:'not_generated'}` (AC-13); NEVER computes (AC-14). Row present: recompute intent + `getBlast` + `SmartDiff.get`, `fingerprintInputs`, compare to `row.inputsFingerprint` → `stale`; return `{status:'ready', brief: row.brief, stale, docs_truncated: row.docsTruncated, generated_at: row.generatedAt}`. NEVER calls the LLM on read (AC-16).
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`, `fastify-best-practices`, `security`
- **Owned paths:** `server/src/modules/why-risk-brief/service.ts`, `server/src/modules/why-risk-brief/input.ts`, `server/src/modules/why-risk-brief/fingerprint.ts`, `server/src/modules/why-risk-brief/fingerprint.test.ts`, `server/src/modules/why-risk-brief/service.it.test.ts`
- **Depends-on:** T1, T2, T3, T4, T5
- **Risk:** high
- **Known gotchas:** Adapters only via the DI `Container` — never call GitHub/LLM directly (server `CLAUDE.md`). To simulate "no provider", inject `MockSecretsProvider({})` and omit the `github` override (server `INSIGHTS.md`). `DocumentsService.readFromClone` has a known symlink-escape gap — pass only repo-relative paths from `discover()` (server `INSIGHTS.md` / `security`). Recomputing blast + smart-diff on every GET is deterministic and model-free (Q3) — acceptable, and must never trigger generation.
- **Acceptance:** `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run src/modules/why-risk-brief/service.it.test.ts` green: no-intent ⇒ `compute` and `get` return `not_available` (AC-18); no provider (`MockSecretsProvider({})`) ⇒ `compute` returns `skipped/no_model`, no row persisted (AC-20); happy path ⇒ `compute` `ready` + persisted, `get` `ready` (AC-11/12); `get` before `compute` (intent present) ⇒ `not_generated` (AC-13); after `compute`, mutate stored intent then `get` ⇒ `stale:true` returning the SAME cached brief (AC-15/16). Plus `vitest run src/modules/why-risk-brief/fingerprint.test.ts`: identical inputs → identical hash; any changed input → different hash.

#### T8 — POST + GET `/pulls/:id/why-risk-brief` routes
- **Action:** In `server/src/modules/reviews/routes.ts`, instantiate `WhyRiskBriefService` and add `POST /pulls/:id/why-risk-brief` (`schema: { params: IdParams }`, `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`, AC-28) → `service.compute(workspaceId, id, {logger: req.log})`; and `GET /pulls/:id/why-risk-brief` (`schema: { params: IdParams }`, default rate limit) → `service.get(workspaceId, id)`. Both return the `WhyRiskBriefState` envelope; GET must never invoke compute (AC-14).
- **Module:** server
- **Type:** backend
- **Skills to use:** `fastify-best-practices`, `client-server-communication`
- **Owned paths:** `server/src/modules/reviews/routes.ts`, `server/src/modules/reviews/why-risk-brief-routes.it.test.ts`
- **Depends-on:** T7
- **Risk:** medium
- **Known gotchas:** Schema-first only — declare `params: IdParams` via the `ZodTypeProvider`; no hand-rolled `req.body` parsing (server `CLAUDE.md`). `reviews/routes.ts` is a shared existing file owned solely by this task in this plan. Per-route rate limits are effectively off under `NODE_ENV=test`, so assert the config is present at source level rather than forcing a runtime 429.
- **Acceptance:** `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run src/modules/reviews/why-risk-brief-routes.it.test.ts` green: `GET` before generate → 200 `not_generated` (intent present) / `not_available` (no intent); `POST` → 200 `{status:'ready',…}` and persists; subsequent `GET` → 200 `ready`; the registration carries `rateLimit: { max: 10, timeWindow: '1 minute' }` (AC-28).

#### T9 — Client data hooks
- **Action:** Add to `client/src/lib/hooks/brief.ts`: `useWhyRiskBrief(prId)` — `useQuery({ queryKey: ["why-risk-brief", prId], queryFn: () => api.get<WhyRiskBriefState>(\`/pulls/${prId}/why-risk-brief\`), enabled: prId != null })` (NO auto-generate — read only, AC-14); and `useGenerateWhyRiskBrief(prId)` — `useMutation({ mutationFn: () => api.post<WhyRiskBriefState>(\`/pulls/${prId}/why-risk-brief\`), onSuccess: (data) => qc.setQueryData(["why-risk-brief", prId], data) })`. Import `WhyRiskBriefState` from `@devdigest/shared`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `client-server-communication`
- **Owned paths:** `client/src/lib/hooks/brief.ts`
- **Depends-on:** T1
- **Risk:** low
- **Known gotchas:** Query keys are inlined per-hook (not centralized); `["why-risk-brief", prId]` is confirmed collision-free against all existing keys. Body-less POST (`api.post` with no body), mirroring `useRecalculateIntent`. `brief.ts` already hosts the intent/risks/smart-diff hooks — append; it is owned solely by this task.
- **Acceptance:** `node_modules/.bin/tsc --noEmit` passes in `client/`; hooks compile against the shared `WhyRiskBriefState` type and the query never fires a POST.

#### T10 — `PrBriefCard` component + i18n
- **Action:** Create `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/` (`PrBriefCard.tsx`, `styles.ts`, `index.ts` barrel, `PrBriefCard.test.tsx`) plus i18n `client/messages/en/whyRiskBrief.json` (new namespace `whyRiskBrief`, used via `useTranslations("whyRiskBrief")`). Props `{ prId: string; repoFullName: string; prNumber: number }`. Uses `useWhyRiskBrief` + `useGenerateWhyRiskBrief`. Render by `status`: `isLoading` → `Skeleton` (mirror IntentCard); `not_available` → "compute intent first" empty state (no Generate button); `not_generated` → empty state + a **Generate** button wired to the mutation (AC-13/14); `skipped` → show the "no model configured" reason (AC-20); `ready` → the colored `risk_level` header (distinct color per low/medium/high, AC-2), the `risks` list (each `description` + refs: `kind:'file'` refs and `review_focus` rendered as **`MonoLink` + `githubPrFileUrl(repoFullName, prNumber, path)`** — the `FindingCard` pattern, NOT the inert-`<span>` `RiskAreas` pattern; `kind:'endpoint'` refs rendered as mono text) in the model's order (AC-4/6), a **stale** badge when `stale` (AC-15), a **doc-context-incomplete** note when `docs_truncated` (AC-24), and a distinct **empty-but-generated** message when `ready` with empty `risks` AND `review_focus` (Rec-2). Never auto-fire the mutation on mount (AC-14).
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `next-best-practices`, `ui-frontend-architecture`, `react-testing-library`
- **Owned paths:** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx`, `.../PrBriefCard/styles.ts`, `.../PrBriefCard/index.ts`, `.../PrBriefCard/PrBriefCard.test.tsx`, `client/messages/en/whyRiskBrief.json`
- **Depends-on:** T1, T9
- **Risk:** medium
- **Known gotchas:** File links MUST use `MonoLink` + `githubPrFileUrl` (the `FindingCard` pattern) — the co-located `RiskAreas.tsx` renders refs as inert `<span>`s; do NOT copy that. `messages/en/*.json` filename = namespace, auto-merged by `i18n/request.ts` — no index to edit. `"use client"` required (hooks + interactivity). Loading/empty/regenerate states mirror `IntentCard`.
- **Acceptance:** `node_modules/.bin/vitest run` (client) for `PrBriefCard.test.tsx` green: `not_generated` renders the Generate button and does NOT auto-POST on mount (AC-14); clicking Generate calls the mutation; `ready` renders the `risk_level` with its color (AC-2) and file refs as anchors with an `href` (MonoLink), not inert spans (AC-4); `stale` shows the stale badge (AC-15); `docs_truncated` shows the incomplete-context note (AC-24); `ready` with empty risks+focus shows the empty-but-generated message (Rec-2). `tsc --noEmit` passes.

### Phase 3 — Mount & verify

#### T11 — Mount `PrBriefCard` in the PR Overview
- **Action:** In `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`, import `PrBriefCard` (near line 6) and mount `<PrBriefCard prId={prId} repoFullName={repoFullName} prNumber={number} />` inside the brief grid (`s.briefGrid`, ~line 40-47) — e.g. stacked under `<IntentCard prId={prId} />` in the left cell. Source `prNumber` from the route/props already in scope (`repoFullName` is at line 21).
- **Module:** client
- **Type:** ui
- **Skills to use:** `next-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/styles.ts` (only if a new grid cell style is needed)
- **Depends-on:** T10
- **Risk:** low
- **Known gotchas:** `OverviewTab.tsx` is a shared existing file owned solely by this task. Confirm the PR `number` is available in this scope (route param `[number]` / existing props); if only `prId` is present, thread `number` down from the page component rather than fabricating it.
- **Acceptance:** `node_modules/.bin/vitest run` (client) for the existing OverviewTab test still green and, if extended, asserts `PrBriefCard` renders; `tsc --noEmit` passes; manual: the card appears on the PR Overview alongside Intent.

#### T12 — Cross-package verification gate
- **Action:** After T1–T11 land, run the full typecheck + targeted test suites per package (commands in Testing strategy). Fix only integration seams surfaced here (imports, barrels) — no new scope.
- **Module:** server + client + reviewer-core + mcp
- **Type:** backend
- **Skills to use:** (none — verification)
- **Owned paths:** none (read/run only; any fix is reported back for the owning task)
- **Depends-on:** T8, T11
- **Risk:** low
- **Known gotchas:** Use package-local binaries (`node_modules/.bin/tsc`, `node_modules/.bin/vitest`) — `pnpm test`/`pnpm exec` trip a deps-status precheck that fails offline (root + server `INSIGHTS.md`). `.it.test.ts` need `TESTCONTAINERS_RYUK_DISABLED=true` and the Bash sandbox disabled to reach Docker.
- **Acceptance:** `tsc --noEmit` green in all four packages; reviewer-core, server (unit + `.it.test`), and client suites green.

## Testing strategy

- **reviewer-core (hermetic, `MockLLMProvider`):** `node_modules/.bin/vitest run src/why-risk-brief/` — generator (single round-trip, untrusted wrapping, no raw diff), grounding (AC-7–10), doc-budget determinism (AC-23/24).
- **server unit (hermetic):** `node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` — `fingerprint.test.ts`, any `input.ts` builder tests.
- **server integration (DB-backed):** `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run .it.test` — `repository.it.test.ts`, `service.it.test.ts` (all envelope + staleness states), `why-risk-brief-routes.it.test.ts`.
- **client:** `node_modules/.bin/vitest run` — `PrBriefCard.test.tsx` (states, links, stale/truncated/empty-but-generated) + `tsc --noEmit`.
- **No new e2e** (Q7) — advisory, model-gated read surface; `e2e/` is deterministic/no-LLM.

## Risks & mitigations

- **Discriminated union in structured output** could be brittle across providers → mitigated by the flat `{kind, value}` ref shape (union-free) and `groundBriefRefs` post-filtering regardless of model output. → T1/T5/T6.
- **GET staleness recompute cost** (blast + smart-diff on every read) → acceptable per Q3 (deterministic, model-free); if it ever bites, a coarser intent-`updated_at` signal is a drop-in fallback. → T7.
- **Vendored-copy drift** (contract + feature-model slot in 3–4 places, no sync script) → each affected task lists all copies as Owned paths and asserts `md5`/shape parity in Acceptance. → T1/T3.
- **Non-OpenAI-only workspace** would break a naive registry-default resolve → `resolveReachableModel` + `resolveFeatureModelWithFallback` three-tier (server `INSIGHTS.md` note 106). → T7.
- **Model resolution for a standalone POST** (no reviewer-run to borrow a reachable model from) → probe configured providers directly; none ⇒ `skipped/no_model` (AC-20) rather than a ConfigError throw. → T7.
- **Cross-agent whole-repo red** during concurrent Phase 2 → verify each task against its own Owned paths + targeted `vitest`, not a whole-repo gate mid-flight (root `INSIGHTS.md`). → all Phase 2.

## Red-flags check

- [x] Every requirement (AC-1…AC-29 + edge cases) maps to at least one task (see Requirements section).
- [x] No specification was authored or edited — SPEC-03 taken as input; only `docs/plans/why-risk-brief.md` written.
- [x] Execution mode recorded (multi-agent) and the plan is shaped for it (Phase 1 foundation → Phase 2 fan-out on disjoint paths).
- [x] Dependencies form a DAG: T1/T2/T3 (roots) → T4(T1,T2), T6(T1) → T5(T1,T6) → T7(T1,T2,T3,T4,T5) → T8(T7); T9(T1) → T10(T1,T9) → T11(T10); T12(T8,T11). No cycles.
- [x] Concurrent tasks have non-overlapping Owned paths (reviewer-core `index.ts` only T5; client `brief.ts` only T9; `reviews/routes.ts` only T8; `OverviewTab.tsx` only T11; schema files only T2; `platform.ts`/`feature-models.ts` only T3; contract file only T1).
- [x] Every Acceptance is measurable (named test file + command, or a concrete source/`md5` assertion).
- [x] Contracts defined before dependents (T1 + T3 in Phase 1, ahead of all consumers).
- [x] No edits to existing shared contracts without callout — all contract/registry changes are **additive** (new file T1; new enum/array members T3); explicitly noted.
- [x] `*/src/vendor/**` is modified ONLY for the additive new contract file (T1) and the additive slot (T3), hand-synced across copies — no existing vendored logic changed.
- [x] No DB table deletions or edits to existing migrations — T2 adds a new table + a new append-only migration only.
- [x] Failure & edge states covered: first-ever vs prior-artifact failure (compute returns `skipped`/`not_available` and persists nothing when it can't produce — a prior good row is only replaced on a successful `ready` via last-write-wins upsert, T4/T7); partial/one-of-N isolation (optional enrichers degrade to null independently without aborting the brief, AC-19/21/22, T7); preserve-prior-on-retry (a `skipped`/`not_available` compute never nulls the stored row — it writes nothing, T7); in-progress + navigate-away (generation is a server round-trip persisted on completion; on return GET serves the cached row or `not_generated`, T7/T10); unavailable-precondition (`not_available` when intent absent is distinct from `not_generated`, AC-18 vs AC-13, T7/T10).
