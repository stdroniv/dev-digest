# Implementation Plan: Onboarding Generator

## Overview
Add a repo-scoped "Onboarding Tour" feature: on demand, DevDigest grounds an LLM in
a repository's deterministic index (or a README/file-tree fallback) and synthesises a
five-section guided tour (Architecture overview, Critical paths, How to run locally,
Guided reading path, First tasks). The tour is persisted per repository, shows a
per-section + total generation-cost breakdown in tokens and (when pricing is known)
dollars, and can be regenerated whole or one section at a time. Sourced verbatim from
`specs/SPEC-02-2026-07-02-onboarding-generator.md` (SPEC-02, approved).

## Execution mode
multi-agent (parallel) — chosen by the coordinator. The work spans three packages
(reviewer-core synthesis, server orchestration, client UI) across ~20 files with clean
layer boundaries, so it parallelises well behind a contracts-first DAG: shared contract
(Phase 0) → reviewer-core synthesis ‖ server grounding/persistence/service/routes
(Phase 1) → client route/nav/cards/cost panel/states (Phase 2). Owned paths are
non-overlapping; every `Depends-on` points only to earlier tasks.

## Requirements (verified)
All requirements below are SPEC-02 acceptance criteria, restated and cited by id. Each
AC is owned by at least one task (see the AC→task map in the Red-flags check).

**Navigation & discoverability**
- R-AC1 (SPEC-02 AC-1): WHILE a repo is active, present a persistent "Onboarding Tour" nav entry for it.
- R-AC2 (SPEC-02 AC-2): WHILE no repo is active, do not present the entry.
- R-AC3 (SPEC-02 AC-3): activating the entry opens the tour screen for the active repo directly.

**Empty state (pre-generation)**
- R-AC4 (SPEC-02 AC-4): with no persisted tour, show heading + explanatory body (what it produces, rough cost/time) + a single generate control.
- R-AC5 (SPEC-02 AC-5): that stated cost/time is a rough pre-estimate, distinct from the measured cost after generation (AC-20).
- R-AC6 (SPEC-02 AC-6): activating generate begins generation for the active repo.

**Generation & content**
- R-AC7 (SPEC-02 AC-7): produce exactly five sections (Architecture overview, Critical paths, How to run locally, Guided reading path, First tasks).
- R-AC8 (SPEC-02 AC-8): Architecture = prose describing the service + request flow, inline references to real repo paths, and a small architecture diagram.
- R-AC9 (SPEC-02 AC-9): Critical paths = ranked list of most-important files, each citing a real repo-relative path + one-line why-it-matters.
- R-AC10 (SPEC-02 AC-10): How to run = ordered list of shell command steps, each individually copyable.
- R-AC11 (SPEC-02 AC-11): Guided reading = ordered list of real files, each with a short why-read/why-in-this-order note.
- R-AC12 (SPEC-02 AC-12): First tasks = 2–4 starter-task cards, each with a title, a cited real repo-relative path, and a Low/Medium/High complexity badge.
- R-AC13 (SPEC-02 AC-13): First tasks derived from repo content; never create/import/round-trip GitHub Issues.

**Generated state & layout**
- R-AC14 (SPEC-02 AC-14): with a persisted tour, show a header naming the repo, a provenance line (file count generated-from + "last refreshed" from generated-at), an anchor nav of the five sections, and the five sections as collapsible cards.
- R-AC15 (SPEC-02 AC-15): activating a section anchor reveals and scrolls to that section.
- R-AC16 (SPEC-02 AC-16): the open affordance on a critical-path row / first-task card opens the file on the repo's GitHub in a new tab.
- R-AC17 (SPEC-02 AC-17): IF no GitHub URL is available, fall back to copying the cited repo-relative path.
- R-AC18 (SPEC-02 AC-18): Share link copies a stable local deep-link to the active repo's tour to the clipboard, contacting no external service.

**Cost breakdown**
- R-AC19 (SPEC-02 AC-19): while a tour exists, provide a collapsible generation-cost breakdown: five section rows + a total row.
- R-AC20 (SPEC-02 AC-20): express each section's + the total cost as a measured token count and, when the active model's pricing is known, an estimated dollar amount clearly marked approximate.
- R-AC21 (SPEC-02 AC-21): IF pricing is unknown, show tokens only + a short "no pricing available" note, not a dollar figure.
- R-AC22 (SPEC-02 AC-22): also reflect the total generation cost near the tour header.

**Regeneration**
- R-AC23 (SPEC-02 AC-23): whole-tour regenerate replaces all five sections' content, recomputes every section's cost + the total, and updates "last refreshed".
- R-AC24 (SPEC-02 AC-24): single-section regenerate replaces only that section's content + cost, recomputes the total, leaves the other four unchanged.
- R-AC25 (SPEC-02 AC-25): any regeneration persists updated content, per-section cost, and generated-at so it survives restarts.

**In-progress**
- R-AC26 (SPEC-02 AC-26): while a whole-tour generation runs, show a whole-tour progress indicator.
- R-AC27 (SPEC-02 AC-27): while a single-section regeneration runs, show a spinner on that card while the others stay readable.
- R-AC28 (SPEC-02 AC-28): IF the user navigates away mid-generation, generation continues and the completed/updated tour shows on return.

**Persistence & staleness**
- R-AC29 (SPEC-02 AC-29): persist the latest tour per repo (per-section content, per-section cost, generated-at) durably across sessions/restarts until regenerated.
- R-AC30 (SPEC-02 AC-30): IF the repo has been re-synced / its index changed since the tour was generated, show a "may be out of date" indicator + regenerate option, without auto-regenerating or discarding.

**Language scope**
- R-AC31 (SPEC-02 AC-31): WHERE the repo is one DevDigest indexes (TS/JS), ground the tour in the full deterministic index.
- R-AC32 (SPEC-02 AC-32): WHERE the repo is not indexed, still generate, grounding in README + file tree + language heuristics.

**Failure handling**
- R-AC33 (SPEC-02 AC-33): IF whole-tour generation fails, show the failure with a reason and leave any previously persisted tour intact/readable.
- R-AC34 (SPEC-02 AC-34): IF single-section regeneration fails, keep that section's previous content + cost and surface the failure for that section only.
- R-AC35 (SPEC-02 AC-35): IF the repo is not yet cloned/indexed at generate time, show a "cannot generate until the repo is available" state, not an error.

**Non-authoritative framing & trust**
- R-AC36 (SPEC-02 AC-36): present the tour as advisory newcomer guidance; nothing downstream treats its content as authoritative.
- R-UNTRUSTED (SPEC-02 §Untrusted inputs): all repo-derived grounding (README, file contents, comments, symbol names, paths) is handled as untrusted data via the shared injection guard, never as instructions; no suggested command is ever auto-executed.
- R-NFR (SPEC-02 §Non-functional): per-section token counts are estimated locally with no extra model call solely to measure them (reusing the SPEC-01 tokenizer); the displayed "last refreshed" reflects the real generated-at timestamp.

## Open questions & recommendations
- Q1 (transport) → answered: background `jobs` task (`container.jobs`) + TanStack Query polling (`refetchInterval` while a job is active); NOT SSE. Satisfies AC-28.
- Q2 (LLM granularity) → answered: one LLM call per section (whole-tour = 5 section calls, per-section regen = 1). One section-level code path serves AC-19/20/24/27/34.
- Q3 (diagram) → answered: structured `{ nodes, edges }` Zod graph grounded in repo-intel's import graph + a lightweight client SVG renderer matching the mockup (box-and-arrow, colour-outlined nodes). NOT Mermaid.
- Q4 (route/nav collision) → answered: route segment `tour` at `client/src/app/repos/[repoId]/tour/`; nav key `onboarding-tour`; tighten `activeKeyFor` so `/tour` matches before the `/onboarding` (Add-Repo wizard) branch. Collision called out in T10.
- Q5 (i18n) → answered: new namespace `tour` (`client/messages/en/tour.json`); do not extend the existing `onboarding` namespace (used by the Add-Repo wizard).
- Q6 (placement of synthesis) → answered: reviewer-core = pure synthesis; server = grounding assembly, persistence, jobs, routes, pricing, staleness.
- Q7 (persistence) → answered: reuse the existing `onboarding` table (`repoId` PK, `json jsonb`, `generatedAt`); store the whole tour as a Zod-defined `json` payload. No new migration. Per-section regen mutates one section in the blob.
- Q8 (un-mocked design additions) → approved as proposed: "Generation cost" = a 6th collapsible card below the five section cards + a 6th anchor-nav entry + total chip beside the header controls; per-section regenerate = a small refresh icon in each section card header. **Flagged for review** — not drawn in the mockups.
- Q9 (staleness/provenance) → answered: use repo-intel `getIndexState(repoId)`. Confirmed fields: `IndexState` exposes `filesIndexed`, `indexerVersion`, `lastIndexedSha`, `updatedAt`. Provenance file count = `filesIndexed` (indexed) or file-tree count (fallback); staleness = current `{indexerVersion, lastIndexedSha}` ≠ stored.
- Q10 (dollars) → answered: persist measured tokens per section; compute $ at view time from the active model's pricing (client `src/lib/cost.ts` / `feature-models.ts`); unknown pricing → tokens only + note (AC-20/21).
- Rec 1 (adopted): reuse the existing `onboarding` table, no migration.
- Rec 2 (adopted): one section-level generation code path; whole-tour = fan-out over 5 sections.
- Rec 3 (adopted): diagram grounded in repo-intel's import graph, not free-form LLM edges.

## Affected modules & contracts
- **reviewer-core** — new pure `onboarding/` synthesis module (`generateOnboardingSection`), mirroring `brief/risks.ts`. Barrel export added.
- **server** (`@devdigest/api`) — new `modules/onboarding/` (grounding assembler, repository over the existing `onboarding` table, service + job handler, routes). Registered in `modules/index.ts`. New container singleton getter in `platform/container.ts`. Reuses `container.repoIntel`, `container.tokenizer`, `container.jobs`, `PriceBook`, `model-router`. **No DB migration** (reuses the existing empty `onboarding` table).
- **client** (`@devdigest/web`) — new route `app/repos/[repoId]/tour/`, TanStack hooks (`lib/hooks/onboarding.ts`), nav entry + `activeKeyFor` tightening, new i18n namespace `tour`.
- **Contracts** (new file, hand-mirrored across all vendor copies): `vendor/shared/contracts/onboarding-tour.ts` in `server/`, `client/`, and `mcp/`, each registered in that package's `vendor/shared/index.ts`. NOTE — a legacy generic `Onboarding` schema already exists in `contracts/knowledge.ts`; the new contract uses distinct names (`OnboardingTour`, `TourSection`, …) to avoid the export collision and must NOT edit `knowledge.ts`.

## Architecture changes
- **reviewer-core/src/onboarding/** — pure synthesis (Application-pure layer): no DB/FS/HTTP, only the injected `LLMProvider`. Consumed by the server as TypeScript source.
- **server/src/modules/onboarding/** — an onion-layered feature module:
  - `grounding.ts` (Infrastructure/Application): assembles per-section grounding from `container.repoIntel` (indexed) or a README/file-tree scan (fallback).
  - `repository.ts` (Infrastructure): Drizzle read/write of the `onboarding` table `json` blob.
  - `service.ts` + `job-handler.ts` (Application): orchestration, job fan-out, tokenizer/pricing, staleness.
  - `routes.ts` (Presentation): schema-first Fastify plugin (`fastify-type-provider-zod`).
  - `OnboardingService` exposed as a container singleton (getter in `platform/container.ts`) so its job handler registers at bootstrap (mirrors `repoIntel`/`repos`).
- **client/src/app/repos/[repoId]/tour/** — RSC page (thin) delegating to a `"use client"` `TourWorkspace`; all server state via TanStack Query hooks; all copy via `useTranslations("tour")`.

## Phased tasks

### Phase 0 — Contracts (blocking; defined first)

#### T1 — Shared `onboarding-tour` Zod contract (hand-mirrored)
- **Action:** Create `vendor/shared/contracts/onboarding-tour.ts` and register it (`export * from './contracts/onboarding-tour.js'`) in `vendor/shared/index.ts` — in **all three** packages (`server/`, `client/`, `mcp/`), byte-identical (no sync script exists; copies are hand-synced). Define, with distinct names to avoid the legacy `Onboarding` collision in `knowledge.ts`:
  - `TourSectionKind = z.enum(['architecture','critical_paths','how_to_run','reading_path','first_tasks'])`; `Complexity = z.enum(['low','medium','high'])`.
  - Diagram: `ArchNode { id, label, kind?, outlineColor? }`, `ArchEdge { from, to, label? }`, `ArchitectureGraph { nodes, edges }`.
  - Per-kind content: `ArchitectureContent { prose, refs: string[], diagram: ArchitectureGraph }`; `CriticalPathsContent { rows: { path, why }[] }`; `HowToRunContent { steps: { command, comment? }[] }`; `ReadingPathContent { steps: { path, reason }[] }`; `FirstTasksContent { tasks: { title, path, complexity: Complexity }[] }` (declare `.min(2).max(4)` on `tasks`).
  - `SectionStatus = z.enum(['ready','generating','failed'])`; `SectionCost { tokensIn, tokensOut }` (ints, nonneg).
  - `TourSection { kind, status, content: <content-union|null>, cost: SectionCost|null, error: string|null, generatedAt: string.datetime|null }`.
  - `TourProvenance { fileCount, indexed: boolean, indexerVersion, lastIndexedSha, model, githubUrl: string|null }`.
  - `OnboardingTour { repoId, sections: TourSection[] (5), provenance, generatedAt }` — the persisted `json` payload shape.
  - API wire shapes: `TourJob { id, kind: z.enum(['whole','section']), sectionKind: TourSectionKind|null, status: z.enum(['queued','running','failed','done']), error: string|null, failedSectionKinds: z.array(TourSectionKind) }` — `error` carries the job-level failure reason (AC-33) and `failedSectionKinds` lists which sections failed; both default null/`[]` on success; `TourAvailability = z.enum(['unavailable','empty','ready'])`; `GetTourResponse { availability, tour: OnboardingTour|null, stale: boolean, job: TourJob|null }` (`job` is the LATEST job row for the repo — active OR most-recent terminal — so a failed job's `error` stays displayable).
- **Module:** server + client + mcp (vendored contract)
- **Type:** core
- **Skills to use:** `zod`, `client-server-communication`, `typescript-expert`
- **Owned paths:** `server/src/vendor/shared/contracts/onboarding-tour.ts`, `server/src/vendor/shared/index.ts`, `client/src/vendor/shared/contracts/onboarding-tour.ts`, `client/src/vendor/shared/index.ts`, `mcp/src/vendor/shared/contracts/onboarding-tour.ts`, `mcp/src/vendor/shared/index.ts`
- **Depends-on:** none
- **Risk:** medium
- **Known gotchas:** Vendored shared has no sync script (root + server `INSIGHTS.md`) — the three copies must be edited by hand and kept byte-aligned; `reviewer-core` aliases `@devdigest/shared` → server's copy, and mcp re-resolves server source's `@devdigest/shared` to its own copy, so drift breaks builds. Do NOT edit the existing `Onboarding`/`OnboardingSection` exports in `contracts/knowledge.ts` (barrel rule: extend with new files).
- **Acceptance:** `cd server && pnpm typecheck` and `cd client && pnpm typecheck` and `cd mcp && pnpm typecheck` all pass; `git grep -c "onboarding-tour.js" server/src/vendor/shared/index.ts client/src/vendor/shared/index.ts mcp/src/vendor/shared/index.ts` returns 1 for each; the three `onboarding-tour.ts` files are byte-identical (`diff` reports no differences).

### Phase 1 — Engine + Server (parallel after T1)

#### T2 — reviewer-core onboarding synthesis (pure)
- **Action:** Create `reviewer-core/src/onboarding/generate.ts` exporting `generateOnboardingSection(input: GenerateOnboardingSectionInput): Promise<GenerateOnboardingSectionResult>`, mirroring `brief/risks.ts`. `GenerateOnboardingSectionInput = { llm: LLMProvider; model: string; kind: TourSectionKind; grounding: OnboardingGrounding }` where `OnboardingGrounding` (declared here, imported by the server) carries plain strings assembled by the server: `{ repoName; repoMapText; topFiles: string[]; criticalChains: string[][]; importGraph: { nodes; edges }; readme?: string|null; fileTree?: string[]; languageHints?: string[] }`. For each `kind`, build a section-specific system prompt ending with `INJECTION_GUARD`, wrap ALL repo-derived grounding with `wrapUntrusted('onboarding-grounding', …)`, and call `input.llm.completeStructured<T>({ model, schema: <the kind's content schema from @devdigest/shared>, schemaName, messages, maxRetries: 2 })`. Return `{ data, tokensIn, tokensOut, costUsd }`. Add `export * from './onboarding/generate.js'` to `reviewer-core/src/index.ts`. Architecture-diagram edges must be constrained by the prompt to nodes/paths present in the provided import graph (Rec 3). First-tasks prompt must enforce 2–4 tasks with real cited paths (AC-12/13) and never reference GitHub Issues.
- **Module:** reviewer-core
- **Type:** core
- **Skills to use:** `zod`, `security`, `typescript-expert`
- **Owned paths:** `reviewer-core/src/onboarding/generate.ts`, `reviewer-core/src/onboarding/prompts.ts`, `reviewer-core/src/onboarding/generate.test.ts`, `reviewer-core/src/index.ts`
- **Depends-on:** T1
- **Risk:** medium
- **Known gotchas:** `wrapUntrusted(label, content)` escapes BOTH arguments — pass repo-derived text as `content`, keep the label a fixed literal (reviewer-core `CLAUDE.md`/`INSIGHTS.md`). Stay pure: no DB/FS/HTTP imports. This synthesis does NOT pass through the findings `grounding.ts` gate — that gate is diff-line citation for review findings, not relevant here; do not import it.
- **Acceptance:** `cd reviewer-core && pnpm test` passes, including a new `generate.test.ts` that, with a `MockLLMProvider`, asserts (a) each `kind` returns content validating against its `@devdigest/shared` schema, (b) the user message contains the untrusted fence wrapper, (c) `firstTasks` rejects <2/>4 via the schema, (d) returned `tokensIn/tokensOut` propagate from the mock; `cd reviewer-core && pnpm typecheck` passes.

#### T3 — Server persistence repository (onboarding table)
- **Action:** Create `server/src/modules/onboarding/repository.ts` — `OnboardingRepository` (constructed with the DI `db`) with: `get(repoId): Promise<OnboardingTour | null>` (reads `onboarding.json`, validates with the `OnboardingTour` Zod schema, returns null when absent), `upsertWhole(repoId, tour): Promise<void>` (writes the full blob + bumps `generatedAt`), `patchSection(repoId, kind, section): Promise<OnboardingTour>` (reads the blob, replaces exactly one `TourSection` with the fully-formed `section` the caller passes, writes back, returns the updated tour). `patchSection` does NOT invent field values — it writes whatever `TourSection` it is given; the SERVICE (T5) is responsible for constructing that object, including carrying forward the prior `content`/`cost`/`generatedAt` when it writes a `failed` status (AC-34), so a failed regen never nulls prior content. Use the existing `onboarding` table (`server/src/db/schema/context.ts`) — no migration.
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `backend-onion-architecture`, `postgresql-table-design`
- **Owned paths:** `server/src/modules/onboarding/repository.ts`
- **Depends-on:** T1
- **Risk:** low
- **Known gotchas:** Do NOT add a migration or alter the `onboarding` table — per-section content/cost/status live inside the `json` blob (root `CLAUDE.md`: unused tables are reserved, migrations are append-only). `patchSection` must be a read-modify-write of the single blob row so AC-24 leaves the other four sections' bytes untouched.
- **Acceptance:** `cd server && pnpm typecheck` passes; covered end-to-end by the DB-backed tests in T7 (`patchSection` changes exactly one section and leaves the other four sections' bytes untouched — including when the written section carries a preserved-content `failed` status; `get` returns null when no row). No standalone command here — verified via T7's `.it.test.ts`.

#### T4 — Server grounding assembler
- **Action:** Create `server/src/modules/onboarding/grounding.ts` — `assembleGrounding(repo, kind?): Promise<OnboardingGrounding>` producing the `OnboardingGrounding` shape reviewer-core expects (T2). For an indexed repo (AC-31): pull `container.repoIntel.getRepoMap(repoId, budget)`, `getTopFilesByRank(repoId, n, { exclude })`, `getCriticalPaths(repoId)`, `getSymbolsInFiles(...)`, and derive the import-graph `{ nodes, edges }` for the diagram from repo-intel. For a non-indexed repo (AC-32): scan the clone for README + a bounded file tree + language heuristics (extension histogram) via the git/FS adapters — never fail. Include `provenance` inputs (`filesIndexed` or file-tree count, `indexerVersion`, `lastIndexedSha`) so the service can build `TourProvenance`. Determine `indexed` vs fallback from `container.repoIntel.getIndexState(repoId)` (`degraded`/`status`). Keep all repo text as data (it is wrapped untrusted downstream in reviewer-core).
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`, `security`
- **Owned paths:** `server/src/modules/onboarding/grounding.ts`, `server/src/modules/onboarding/language-heuristics.ts`, `server/src/modules/onboarding/grounding.test.ts`
- **Depends-on:** T1
- **Risk:** medium
- **Known gotchas:** repo-intel returns a DEGRADED contract — array reads return `[]` when degraded and the status/reason is only observable via `getIndexState()` (`repo-intel/types.ts`); treat `getIndexState().degraded === true` (or `status` of `degraded`/`failed`) as the trigger for the README/file-tree fallback, not an empty array alone. Guard file-tree/README reads against path escapes (reuse the `RepoRelativePath`/join-safety pattern from `modules/documents/path-safety.ts`).
- **Acceptance:** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' src/modules/onboarding/grounding.test.ts` passes, asserting (with a mocked `repoIntel`) that a non-degraded state yields index-grounded fields and a degraded state yields README/file-tree/language-hint fields; `cd server && pnpm typecheck` passes.

#### T5 — Server service, job handler, container wiring, pricing & staleness
- **Action:** Create `server/src/modules/onboarding/service.ts` (`OnboardingService`, constructed with the DI `container`) and `server/src/modules/onboarding/job-handler.ts`. In the constructor, register two job kinds on `container.jobs` following the repo-intel/repos pattern: `onboarding.generate` (whole-tour) and `onboarding.regenerate-section` (single `kind`). Both share ONE section-level pipeline: assemble grounding (T4) → resolve the feature model via `model-router` → call `generateOnboardingSection` (T2) via `container.llm` → measure `tokensIn/tokensOut` (prefer provider usage; fall back to `container.tokenizer.count` over the grounding/output per SPEC-01 local estimation, no extra model call) → build a `ready` `TourSection` → `patchSection` (T3). **Content-preservation rule (AC-33/AC-34):** when a section is marked `generating` at the start of a run, and when a section FAILS, the service must PRESERVE that section's prior `content`, `cost`, and `generatedAt` (spread the existing `TourSection`) and only change `status` (`generating`/`failed`) and `error` — it must never null prior content. For a first-ever section (no prior success) the preserved content is simply `null`. On success it replaces content/cost/`generatedAt` and clears `error`. **Job-level failure reason (AC-33):** when a whole-tour job finishes with ≥1 failed section, set the job row's `status:'failed'`, `failedSectionKinds` to the failed kinds, and `error` to a single synthesized summary (e.g. "Generation failed for N of 5 sections (architecture, first_tasks): <first section reason>"); a per-section job that fails sets `status:'failed'`, `sectionKind`, and `error` to that section's reason. Public methods: `getTour(repo): Promise<GetTourResponse>` — reads the persisted tour (T3) and computes `availability`: `'unavailable'` when `getIndexState` shows the repo is not cloned/indexed (AC-35); else `'empty'` when there is no persisted row OR **no section has non-null `content`** (this is how a first-ever generation — whether still in progress or already failed — is distinguished from a real tour, per the spec edge case that a first-ever failure leaves the empty state + a reason); else `'ready'`. It also computes `stale` by comparing stored `provenance.{indexerVersion,lastIndexedSha}` to the current `getIndexState()` (AC-30), and returns `job` = the LATEST job row for the repo (active OR most-recent terminal) so a failed job's `error` remains displayable (T1). `startWhole(repo)` and `regenerateSection(repo, kind)` enqueue the respective job and return the `TourJob`. Add a lazy singleton getter `get onboarding()` to `server/src/platform/container.ts` so the handler registers at bootstrap. Persist measured tokens only; the $ is derived client-side (T11). Because `availability` keys off real per-section content, a first-ever whole-tour failure yields `availability:'empty'` (empty state + the failed job's reason), while a whole-tour failure when a prior tour exists keeps `availability:'ready'` with every prior section's content intact plus the failed job's reason as a banner (AC-33).
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`, `typescript-expert`, `security`
- **Owned paths:** `server/src/modules/onboarding/service.ts`, `server/src/modules/onboarding/job-handler.ts`, `server/src/modules/onboarding/constants.ts`, `server/src/modules/onboarding/service.test.ts`, `server/src/platform/container.ts`
- **Depends-on:** T2, T3, T4
- **Risk:** high
- **Known gotchas:** Job handlers must be registered at bootstrap, not lazily per request — register in the service constructor and expose the service as a container singleton getter (mirror `repos/service.ts` + `repo-intel/service.ts`, which `this.container.jobs.register(KIND, …)` in their constructors). `container.ts` is a shared platform file — this task is its ONLY editor in this plan. AC-28 falls out for free because the job runs server-side and status is persisted; the client just polls. AC-23/24: whole vs section share one section-level pipeline (Rec 2); a whole-tour run supersedes and replaces all five, a section run touches only its `kind`. **Do NOT derive `availability:'ready'` merely from the existence of a persisted row** — a first-ever run persists a row with all sections `generating`/`failed` and `content:null`; `ready` requires ≥1 section with non-null `content`, otherwise a first-ever failure would wrongly render five failed cards instead of the empty state + reason. **A failed regen must spread the prior `TourSection`** (content/cost/generatedAt) and change only `status`/`error`; never construct a `failed` section with `content:null` over an already-populated one (AC-34).
- **Acceptance:** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' src/modules/onboarding/service.test.ts` passes, asserting (with mocked `jobs`, `repoIntel`, `llm`, `tokenizer`, and the T3 repository) that: whole-tour marks 5 sections and persists 5; a single-section run patches only its `kind` and recomputes cost (AC-24); a failing section is `failed` with a reason while others succeed (AC-34); `getTour` returns `unavailable` when the index state reports not-cloned (AC-35) and `stale:true` when stored index identity differs (AC-30). Named failure cases: (i) **`first-ever whole-tour generation that fails`** → no section has non-null content → `getTour` returns `availability:'empty'` (NOT `'ready'`) with a `job` of `status:'failed'` carrying a synthesized `error` reason and `failedSectionKinds` (AC-33 first-ever/empty edge case); (ii) **`whole-tour failure with a prior tour present`** → `availability:'ready'`, every prior section's `content`/`cost` unchanged, and the failed `job.error` present (AC-33); (iii) **`regenerate an already-populated section that fails`** → that section keeps its prior `content`, `cost`, and `generatedAt` with `status:'failed'`+`error`, and the other four sections are byte-identical to before (AC-34). `cd server && pnpm typecheck` passes.

#### T6 — Server routes + module registration
- **Action:** Create `server/src/modules/onboarding/routes.ts` (default-exported Fastify plugin, `withTypeProvider<ZodTypeProvider>()`, `new OnboardingService(app.container)` — or `app.container.onboarding` singleton) with schema-first endpoints: `GET /repos/:id/tour` → `GetTourResponse` (availability + tour + stale + job); `POST /repos/:id/tour/generate` → `{ job: TourJob }` (202); `POST /repos/:id/tour/sections/:kind/regenerate` (params validated against `TourSectionKind`) → `{ job: TourJob }`. Reuse `getContext`, `IdParams`, and the workspace-scoped repo lookup pattern from `modules/documents/routes.ts`. Register the module in `server/src/modules/index.ts` (one import + one entry). Apply a tighter per-route rate limit on the two generate endpoints (expensive), consistent with server conventions.
- **Module:** server
- **Type:** backend
- **Skills to use:** `fastify-best-practices`, `client-server-communication`, `zod`, `security`
- **Owned paths:** `server/src/modules/onboarding/routes.ts`, `server/src/modules/index.ts`
- **Depends-on:** T5
- **Risk:** medium
- **Known gotchas:** Schema-first only — declare Zod `params`/`body` via `fastify-type-provider-zod`; never hand-roll `Schema.parse` (server `CLAUDE.md`). `modules/index.ts` is a static registry (server `CLAUDE.md`); this task is its only editor here. Generate endpoints return immediately with a `TourJob` (202) — they must not block on the 30–60s generation (AC-28 handled by the job runner + client polling).
- **Acceptance:** covered by T7's `.it.test.ts`; standalone: `cd server && pnpm typecheck` passes and the route appears in the registered plugin set (asserted in T7).

#### T7 — Server integration tests (DB-backed)
- **Action:** Create `server/src/modules/onboarding/routes.it.test.ts` (testcontainers Postgres): boot the app with mocked `llm`/`repoIntel` overrides (via `ContainerOverrides`), exercise `POST …/generate` → poll `GET …/tour` until the job completes → assert five ready sections persisted with per-section token costs; `POST …/sections/critical_paths/regenerate` changes only that section (AC-24) and leaves others' bytes unchanged; `GET …/tour` for an unavailable repo returns `availability:'unavailable'` (AC-35); a persisted tour with a stale index identity returns `stale:true` (AC-30). Assert persistence survives a fresh repository read (AC-29). Named failure cases: (i) **first-ever generation fails** (mock `llm` throws for all kinds) → `GET …/tour` returns `availability:'empty'` with `job.status:'failed'` + a non-empty `job.error` (NOT a `ready` tour of five failed cards) (AC-33 first-ever/empty edge case); (ii) **whole-tour regenerate fails when a prior tour is already persisted** → `availability:'ready'`, every prior section's `content`/`cost` byte-identical to before, plus `job.error` present (AC-33); (iii) **regenerate an already-populated section that then fails** (seed a ready tour, mock `llm` to throw for `critical_paths`) → that section keeps its prior `content`/`cost`/`generatedAt` with `status:'failed'`+`error`, and the other four sections plus the total are unchanged (AC-34).
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`, `fastify-best-practices`
- **Owned paths:** `server/src/modules/onboarding/routes.it.test.ts`
- **Depends-on:** T6
- **Risk:** medium
- **Known gotchas:** DB-backed tests MUST use the `.it.test.ts` suffix (root `CLAUDE.md`); swap externals via `src/adapters/mocks.ts` / `ContainerOverrides`, never call real LLM/GitHub. Poll the job to completion via `container.jobs.onIdle()` or the `GET /tour` job field rather than a fixed sleep.
- **Acceptance:** `cd server && pnpm exec vitest run .it.test src/modules/onboarding/routes.it.test.ts` passes all assertions above.

### Phase 2 — Client (after routes; parallel within the phase)

#### T8 — i18n messages (new `tour` namespace)
- **Action:** Create `client/messages/en/tour.json` with all Onboarding-Tour copy so no string is hard-coded (client `CLAUDE.md`). Include the exact designed copy: empty-state heading "Generate onboarding tour", body "DevDigest indexes the repo and writes a guided tour: architecture, critical paths, how to run, a reading order, and first tasks. Takes 30-60s and ~5,000 tokens.", primary button "+ Generate onboarding tour"; the five section titles ("Architecture overview", "Critical paths", "How to run locally", "Guided reading path", "First tasks"); header/provenance patterns ("Onboarding for {repo}", "Generated from index of {count} files - last refreshed {time}"); controls "Regenerate", "Share link", per-section "Regenerate section"; the "Generation cost" panel labels (section rows, "Total", "~${amount} (approx)", "No pricing available for {model}"); state copy for "may be out of date" (+ regenerate), in-progress, whole-tour/section failure, and the not-cloned/unavailable state; complexity badge labels ("Low complexity"/"Medium complexity"/"High complexity"); row affordances "Open"/"Copy path"/copy-command. No `request.ts` edit needed — `loadMessages` auto-globs every `messages/en/*.json`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `next-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/messages/en/tour.json`
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** Use the new namespace `tour` (Q5) - do NOT touch `messages/en/onboarding.json` (owned by the Add-Repo wizard). `loadMessages` derives the namespace from the filename, so the file MUST be named `tour.json`.
- **Acceptance:** `cd client && pnpm typecheck` passes; `node -e "JSON.parse(require('fs').readFileSync('client/messages/en/tour.json','utf8'))"` exits 0; the designed empty-state/heading/button strings above are present verbatim (asserted by the T14 component tests via `useTranslations("tour")`).

#### T9 — TanStack Query hooks
- **Action:** Create `client/src/lib/hooks/onboarding.ts` with: `useOnboardingTour(repoId)` → `GET /repos/:id/tour` (key `["onboarding-tour", repoId]`), `refetchInterval: (q) => { const j = q.state.data?.job; return j && (j.status === 'queued' || j.status === 'running') ? 1500 : false; }` so an in-progress job polls until it reaches a terminal status then STOPS — the returned `job` may now be a terminal `failed` job (so its `error` stays displayable, per T1/Gap 1), so polling must key off `status`, not mere presence (AC-26/27/28); `useGenerateTour(repoId)` → `POST /repos/:id/tour/generate`, invalidates the tour query on success; `useRegenerateSection(repoId)` → `POST /repos/:id/tour/sections/:kind/regenerate`, invalidates the tour query. All fetches go through `src/lib/api.ts` (`api.get`/`api.post`); responses typed by `GetTourResponse`/`TourJob` from `@devdigest/shared`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `client-server-communication`, `next-best-practices`
- **Owned paths:** `client/src/lib/hooks/onboarding.ts`, `client/src/lib/hooks/onboarding.test.ts`
- **Depends-on:** T1, T6
- **Risk:** medium
- **Known gotchas:** All data access goes through `src/lib/hooks/*` → `src/lib/api.ts`; never `fetch` from a component (client `CLAUDE.md`). Stop polling once `job.status` is terminal (`failed`/`done`) — since `GET /tour` returns the latest job including a terminal failure, keying the interval off `job` presence alone would poll forever; invalidate (not manual setQueryData) so the persisted server state is the single source of truth.
- **Acceptance:** `cd client && pnpm test src/lib/hooks/onboarding.test.ts` passes (mocked `fetch`): asserts the three hooks hit the right method+path, the query key is `["onboarding-tour", repoId]`, `refetchInterval` returns a number while `job.status` is `queued`/`running` and `false` when `job` is null OR its status is terminal (`failed`/`done`), and mutations invalidate the tour query.

#### T10 — Nav entry + active-key (collision resolution)
- **Action:** Add a WORKSPACE nav entry to `client/src/vendor/ui/nav.ts`: `{ key: "onboarding-tour", label: "Onboarding Tour", icon: <honeycomb icon name>, href: "/repos/:repoId/tour", gKey: <free key>, repoScoped: true }` (mirrors the `context` entry; `repoScoped:true` gives AC-1/AC-2 via `Sidebar`'s repo filter). In `client/src/components/app-shell/helpers.ts`, add `if (pathname.includes("/tour")) return "onboarding-tour";` BEFORE the existing `if (pathname.includes("/onboarding"))` branch so the new repo-scoped screen resolves to `onboarding-tour` while the Add-Repo wizard at `/onboarding` keeps its current behaviour. Add matching entries to `SHORTCUTS` if a `gKey` is chosen. Pick the honeycomb glyph from the existing `@devdigest/ui` icon set (or add it there if absent, keeping the vendored icon copies aligned).
- **Module:** client
- **Type:** ui
- **Skills to use:** `ui-frontend-architecture`, `react-best-practices`
- **Owned paths:** `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/helpers.ts`, `client/src/components/app-shell/NavGating.test.tsx`
- **Depends-on:** none
- **Risk:** medium
- **Known gotchas:** COLLISION (called out): `activeKeyFor` already maps `pathname.includes("/onboarding")` → `"onboarding-tour"` for the unrelated Add-Repo wizard (`app/onboarding/`, `AddRepoView`). Because the new nav entry is `repoScoped:true` and the wizard is repo-agnostic (no active repo there), the entry is hidden on the wizard regardless; still, add the `/tour` branch first so `/repos/*/tour` never depends on the wizard branch. Editing the vendored `nav.ts` is the established SPEC-01 pattern for adding a nav entry (the `context` entry lives there) despite the general "treat vendor as generated" rule - keep any icon addition byte-aligned across vendored `@devdigest/ui` copies.
- **Acceptance:** `cd client && pnpm test src/components/app-shell/NavGating.test.tsx` passes with an added case: the "Onboarding Tour" entry renders → `/repos/repo-1/tour` when a repo is active and is hidden when `repoId` is null; a unit assertion that `activeKeyFor("/repos/x/tour") === "onboarding-tour"` and `activeKeyFor("/onboarding")` is unchanged.

#### T11 — Generation cost panel (6th card) + header total chip
- **Action:** Create `client/src/app/repos/[repoId]/tour/_components/CostPanel/` — a collapsible "Generation cost" card (styled like the section cards) listing the five sections each with tokens and a derived $ amount, plus a Total row (AC-19). Compute $ from each section's stored `cost.tokensIn/tokensOut` × the active model's pricing via the existing `client/src/lib/cost.ts` / `feature-models.ts`; when pricing is unknown, show tokens only + a "No pricing available" note (AC-20/21), marked approximate when shown. Export a small `TotalCostChip` for the header (AC-22). Copy via `useTranslations("tour")`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/app/repos/[repoId]/tour/_components/CostPanel/`
- **Depends-on:** T1, T8, T9
- **Risk:** low
- **Known gotchas:** Persisted token counts are the measured truth; $ is only ever a view-time estimate from CURRENT active-model pricing (Q10) - always label it approximate and never persist it. Pricing-unknown is a first-class branch (AC-21), not an error.
- **Acceptance:** `cd client && pnpm test client/src/app/repos/[repoId]/tour/_components/CostPanel` passes: renders five rows + a total that sums per-section tokens; shows a $ estimate when a priced model is active and tokens-only + the no-pricing note when not; the total chip mirrors the panel total.

#### T12 — Architecture section + SVG diagram renderer
- **Action:** Create `client/src/app/repos/[repoId]/tour/_components/ArchitectureSection/` and `.../ArchitectureDiagram/`. Render the architecture prose with inline code chips for `refs` paths (AC-8) and a lightweight, dependency-free SVG box-and-arrow diagram from `ArchitectureGraph.{nodes,edges}` matching the mockup (rounded node boxes, directed arrows, colour-outlined nodes via `outlineColor`). NOT Mermaid (Q3).
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/app/repos/[repoId]/tour/_components/ArchitectureSection/`, `client/src/app/repos/[repoId]/tour/_components/ArchitectureDiagram/`
- **Depends-on:** T1, T8, T9
- **Risk:** medium
- **Known gotchas:** Diagram data is untrusted repo-derived content (node labels are file paths) - render as text/attributes only, never as `dangerouslySetInnerHTML`. Lay out deterministically (e.g. simple layered/columnar positioning) so the SVG is stable across renders.
- **Acceptance:** `cd client && pnpm test client/src/app/repos/[repoId]/tour/_components/ArchitectureSection` passes: renders one `<rect>`/node per `ArchitectureGraph.node`, an arrow per edge, applies `outlineColor`, and renders each `ref` as an inline code chip.

#### T13 — Section cards shell + four section renderers + cited-file affordances
- **Action:** Create `client/src/app/repos/[repoId]/tour/_components/SectionCard/` (collapsible card with leading icon, title, chevron toggle, a per-section Regenerate refresh icon (AC-24 trigger via `useRegenerateSection`), a per-section spinner while that section is `generating` (AC-27), and a section-scoped failure banner (AC-34)) plus `.../sections/` renderers for Critical paths (rows: mono path + "— why", right-aligned Open), How to run (numbered mono command lines each with a copy icon, AC-10), Guided reading path (numbered path + muted reason, AC-11), and First tasks (row of 2–4 cards: title, muted cited path, colour-coded complexity badge, AC-12). Create `.../affordances.ts`: `openOrCopyCited(path, githubUrl)` opens `{githubUrl}/blob/HEAD/{path}` in a new tab when a GitHub URL exists (AC-16) else copies the path (AC-17); `copyCommand(text)`; `copyShareLink(repoId)` copies a local deep-link `"{origin}/repos/{repoId}/tour"` (AC-18, no network).
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/app/repos/[repoId]/tour/_components/SectionCard/`, `client/src/app/repos/[repoId]/tour/_components/sections/`, `client/src/app/repos/[repoId]/tour/_components/affordances.ts`
- **Depends-on:** T1, T8, T9
- **Risk:** medium
- **Known gotchas:** Cited paths, commands, and task titles are untrusted tour output (AC-36 / §Untrusted inputs) - render as text, open GitHub in a new tab with `rel="noopener noreferrer"`, and NEVER auto-run a command (copy only). Per-section regenerate must target only its `kind` so AC-24/AC-34 stay section-scoped.
- **Acceptance:** `cd client && pnpm test client/src/app/repos/[repoId]/tour/_components/SectionCard client/src/app/repos/[repoId]/tour/_components/sections` passes: Open uses the GitHub URL when present and copies the path when absent; a command copy writes to the clipboard and never executes; First tasks renders 2–4 cards with the correct complexity badge; a `generating` section shows a spinner while siblings stay readable; a `failed` section shows its banner without affecting others.

#### T14 — Tour page, workspace container & all screen states
- **Action:** Create `client/src/app/repos/[repoId]/tour/page.tsx` (thin RSC that renders the client `TourWorkspace`) and `.../tour/_components/TourWorkspace/` plus `.../TourHeader/` and `.../AnchorNav/`. `TourWorkspace` consumes `useOnboardingTour` and switches on `availability`/`job`/`tour`: `unavailable` → not-cloned/indexed state (AC-35); `empty` → the designed empty state (honeycomb, heading, body, "+ Generate onboarding tour" via `useGenerateTour`, AC-4/5/6), with two sub-branches on the returned `job`: (a) an active `whole` job (`queued`/`running`) → the whole-tour in-progress indicator over the empty state (AC-26, first-ever generation); (b) a terminal `failed` job → the empty state PLUS the failure reason from `job.error` and a retry via `useGenerateTour` (AC-33 first-ever/empty edge case) — this is distinct from the `ready`+banner case below; `ready` → `TourHeader` ("Onboarding for {repo}" mono, provenance line from `provenance.fileCount` + `generatedAt`, top-right "Regenerate" + "Share link", `TotalCostChip` from T11, AC-14/18/22), `AnchorNav` ("ON THIS PAGE" listing the five sections + a sixth "Generation cost" anchor, active-anchor highlight, click reveals+scrolls AC-15), the five `SectionCard`s (T12/T13) in order, then the `CostPanel` (T11). Render the whole-tour in-progress indicator while a `whole` job runs (AC-26), a "may be out of date" banner + regenerate when `stale` (AC-30), and — when a terminal `failed` `whole` job is returned alongside a `ready` tour — a whole-tour failure banner carrying `job.error` ABOVE the still-intact readable tour (AC-33). (Per-section failure banners on individual cards are owned by T13/AC-34.) Add breadcrumb `<owner>/<repo> › Onboarding Tour`. Present advisory framing per AC-36. All copy via `useTranslations("tour")`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `next-best-practices`, `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/app/repos/[repoId]/tour/page.tsx`, `client/src/app/repos/[repoId]/tour/_components/TourWorkspace/`, `client/src/app/repos/[repoId]/tour/_components/TourHeader/`, `client/src/app/repos/[repoId]/tour/_components/AnchorNav/`
- **Depends-on:** T8, T9, T10, T11, T12, T13
- **Risk:** medium
- **Known gotchas:** `page.tsx` stays thin; feature logic lives in colocated `_components` (client `CLAUDE.md`). `TourWorkspace` needs `"use client"` (it uses hooks/state); the page itself can stay an RSC. Do not fabricate the "last refreshed" time - derive it from `provenance`/`generatedAt` (AC-14, §Non-functional). Four states must stay visually distinct: `unavailable` (AC-35), plain `empty` (AC-4), `empty` + first-ever in-progress spinner (AC-26), and `empty` + first-ever failure reason (AC-33 edge case) — all keyed off `availability` plus `job.status`; a first-ever failure must NEVER render as a `ready` tour of five failed cards.
- **Acceptance:** `cd client && pnpm test client/src/app/repos/[repoId]/tour` passes: with mocked hook data it renders the empty state (heading + "+ Generate onboarding tour") when `availability:'empty'` with no job; a whole-tour spinner over the empty state when `availability:'empty'` + an active `whole` job (first-ever in progress, AC-26); the empty state PLUS the `job.error` reason + retry when `availability:'empty'` + a terminal `failed` job (first-ever failure, AC-33 edge case) — asserting it is NOT the `ready` five-card layout; the unavailable state when `'unavailable'`; the full generated layout (header, six anchors, five cards, cost panel) when `'ready'`; a whole-tour failure banner carrying `job.error` above the intact tour when `availability:'ready'` + a terminal `failed` `whole` job (AC-33); a "may be out of date" banner when `stale:true`; and clicking an anchor scrolls to its section. `cd client && pnpm typecheck` passes.

## Testing strategy
- **reviewer-core (hermetic, MockLLMProvider):** `cd reviewer-core && pnpm test` (T2) + `pnpm typecheck`.
- **server unit (hermetic):** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (T4 grounding, T5 service) + `pnpm typecheck`.
- **server integration (testcontainers Postgres, `.it.test.ts`):** `cd server && pnpm exec vitest run .it.test` (T7 routes/persistence/staleness/failure).
- **client (vitest + jsdom, `fetch` mocked):** `cd client && pnpm test` (T9 hooks; T10 nav gating; T11 cost panel; T12 diagram; T13 cards/affordances; T14 states) + `pnpm typecheck`.
- **Deterministically verifiable core (per SPEC-02 §Non-functional):** persisted per-section token counts (AC-20), tokens-only fallback (AC-21), persistence across restart (AC-29), staleness signal (AC-30), and section-scoped failure isolation (AC-34) are all covered by hermetic/DB tests above; the LLM-produced tour text itself is non-deterministic and is validated only structurally (schema-valid five sections), not by content assertions.

## Risks & mitigations
- **Vendored contract drift across server/client/mcp** (no sync script) → T1 edits all three copies byte-identically and its acceptance diffs them; downstream tasks import from `@devdigest/shared`, never redefining types.
- **Job handler not registered at boot** (lazy singleton constructed too late) → T5 mirrors the repo-intel/repos constructor-registration + container-getter pattern; T7 proves enqueue→completion end-to-end.
- **Prompt injection via repo-derived grounding** (README/paths/symbols) → reviewer-core wraps all grounding with `wrapUntrusted` under `INJECTION_GUARD` (T2); the client renders tour output as text and never auto-runs commands (T13); GitHub opens with `rel="noopener noreferrer"`.
- **Per-section regenerate corrupting the shared JSON blob** → T3 `patchSection` is a read-modify-write replacing exactly one `TourSection`; T7 asserts the other four sections' bytes are unchanged (AC-24).
- **Runaway polling** → T9 stops `refetchInterval` when `job` is null.
- **Un-mocked design additions (cost panel placement + per-section regenerate icon)** → implemented as specified (Q8) and flagged for design review; both are additive and consistent with the card language.
- **Diagram fidelity to the mockup** → T12 renders a bespoke SVG (not Mermaid) from a repo-grounded `{nodes,edges}` graph so it matches the designed box-and-arrow with colour-outlined nodes.

## Red-flags check
- [x] Every requirement maps to at least one task: AC-1/2 → T10; AC-3 → T10,T14; AC-4/5/6 → T14,T8; AC-7 → T2,T5; AC-8 → T2,T4,T12; AC-9 → T2,T4,T13; AC-10 → T2,T13; AC-11 → T2,T13; AC-12/13 → T2,T13; AC-14 → T5,T14; AC-15 → T14; AC-16/17 → T13; AC-18 → T13,T14; AC-19 → T11; AC-20/21 → T5,T11; AC-22 → T11,T14; AC-23 → T5; AC-24 → T3,T5,T13; AC-25 → T3,T5; AC-26 → T9,T14; AC-27 → T9,T13; AC-28 → T5,T9; AC-29 → T3,T7; AC-30 → T5,T14; AC-31/32 → T4; AC-33 → T1,T5,T7,T14; AC-34 → T3,T5,T7,T13; AC-35 → T5,T14; AC-36 + Untrusted → T2,T13,T14; NFR (local tokens / real timestamp) → T5,T14.
- [x] No specification was authored or edited — SPEC-02 was taken as input.
- [x] Execution mode is recorded (multi-agent) and the plan is shaped for it (contracts-first DAG, non-overlapping Owned paths).
- [x] Dependencies form a DAG (no cycles): T1 → {T2,T3,T4}; {T2,T3,T4} → T5 → T6 → T7; {T1,T6} → T9; T8,T10 independent; {T1,T8,T9} → {T11,T12,T13}; {T8,T9,T10,T11,T12,T13} → T14.
- [x] Concurrent tasks have non-overlapping Owned paths (each component lives in its own folder; only T5 edits `container.ts`; only T6 edits `modules/index.ts`; only T10 edits `nav.ts`/`helpers.ts`).
- [x] Every Acceptance is measurable (named test files + exact commands + observable assertions).
- [x] Contracts (T1) are defined before any task that depends on them.
- [x] No edits to existing shared contracts — a NEW `onboarding-tour.ts` is added; the legacy `Onboarding` in `knowledge.ts` is left untouched (collision avoided by distinct names).
- [x] `*/src/vendor/**` — only the additive shared-contract files/barrels (T1) and the established `nav.ts` nav-entry pattern (T10) are touched; no other vendored file is modified.
- [x] No DB table deletions or edits to existing migrations — the existing `onboarding` table is reused; no migration is added.

