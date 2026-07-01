# Implementation Plan: Project Context (SPEC-01)

## Overview
Give reviewer agents access to a repository's written intent (Markdown docs under
`specs`/`docs`/`insights`) by discovering `.md` files in a repo clone, letting users
attach them (path-only, ordered) to agents and skills, and feeding their fresh on-disk
content into the review prompt's existing untrusted `## Project context` block at run
time — visibly, with per-document token volume and origin recorded in the run trace.
This is a "wire up mostly-existing scaffolding" feature (the prompt slot, injection
guard, `specs`/`specs_read` trace fields, ordered-attach precedent, tokenizer, and the
`context` i18n namespace already exist), following the L02 Skills pattern.

## Execution mode
multi-agent (parallel) — user-selected. Phase 1 front-loads the shared contract and the
reviewer-core `specs` shape change; server and client work then fan out across
non-overlapping owned paths behind an explicit DAG.

## Requirements (verified)
Every task below serves at least one of these. Source: `specs/SPEC-01-2026-07-01-project-context.md`.

- **R1 — Discovery & Project Context screen** (SPEC-01 AC-1…AC-7): recursive `.md`
  listing under configured roots in a repo clone; display by repo-relative path + origin
  root; per-doc preview; empty state; repo-not-cloned state; refresh/re-scan; search filter.
- **R2 — Configurable roots** (AC-8/AC-9): default `{specs, docs, insights}`; per-workspace
  override applied to every repo in that workspace, and an in-product way to view/edit that override.
- **R3 — Attach to agent & skill** (AC-10…AC-16): Context tab (agent) and "Project context
  to use" section (skill) listing docs with origin badge; attach/detach; persisted drag
  order; path-only storage (never inline text); in-editor preview; live attached-token
  volume; "injected as untrusted" note.
- **R4 — Run-time assembly** (AC-17…AC-24): effective set = agent docs ∪ enabled-skill
  docs; dedup by path; order agent-first then per enabled-skill (dedup keeps agent
  position); read fresh from the reviewed PR's own clone; place in the existing
  `## Project context` untrusted block labelled per-doc by path; empty set → no block
  (byte-identical to pre-feature); missing path → skip + record attached-but-unavailable,
  never fail the run.
- **R5 — Run visibility** (AC-25…AC-28): trace records read-doc paths, locally-estimated
  token volume (no model call), per-doc origin (agent vs which skill); trace UI expands the
  literal assembled untrusted block.
- **R6 — Non-functional**: zero new model calls; deterministic byte-identical block for
  fixed inputs; non-regression when nothing attached; content is untrusted data.
- **R7 — Demonstration** (Scenario): manual mid-tier-model proof (reviewer catches + cites
  an invariant); the deterministic slice AC-20/21/22/25/26 has automated coverage.

## Open questions & recommendations
- Q1 (trace contract shape) → answered: keep `specs_read: string[]` = read paths; ADD new
  structured trace fields `documents_read: {path, tokens, origin}[]`, `documents_unavailable:
  string[]`, and a `specs_tokens` stat. reviewer-core `specs` input becomes `{path, content}[]`.
  Extend the vendored `@devdigest/shared` contract and re-vendor to server/client/mcp.
- Q2 (discovery source for editors) → answered: repo picker in the Context tab, defaulting
  to the workspace's active/first cloned repo; paths stored portable, resolved at run time
  against the PR's own repo.
- Q3 (nav entry point) → answered: do NOT edit `client/src/vendor/ui/nav.ts` for the sidebar
  nav; reach `/repos/[repoId]/context` via a link on an existing repo-scoped page (next to
  Conventions) plus breadcrumbs.
- Q4 (discovery persistence) → answered: scan on-demand every request, no cache; only
  attachments persist.
- Q5 (token estimate) → answered: per-doc estimate embedded in the documents-list response,
  summed client-side for attached paths (no separate call).
- AC-9 UI gap (spec-conformance follow-up) → answered: the plan originally wired only the
  read/consume side of the per-workspace root-folders override (T4/T5) with no way for a user
  to SET it. Decision: add a Settings panel (T15) that extends the vendored `SETTINGS_SECTIONS`
  list with a "root-folders" section. This is a DELIBERATE, sanctioned exception to the
  "don't touch `src/vendor/**`" default, scoped to the `SETTINGS_SECTIONS` array in
  `client/src/vendor/ui/nav.ts` only (distinct from the Q3 sidebar-nav decision — there we
  avoided the edit; here the user explicitly asked for the UI over API-only config).
- Rec 1 (accepted): reuse the `agent_skills` ordered-attach precedent verbatim, including the
  transaction-scoped `pg_advisory_xact_lock(hashtext(id))` in the `setDocuments` methods.
- Rec 2 (accepted): reuse pre-seeded scaffolding (`context.json`, the `## Project context`
  slot, `wrapUntrusted`/`INJECTION_GUARD`).
- Rec 3 (accepted): read clone files via the existing `GitClient.readFile` / `repo.clonePath`
  pattern with `.catch(() => null)`; keep Markdown discovery separate from repo-intel.

## Affected modules & contracts
- **`@devdigest/shared` (vendored, 3 copies)** — extend `contracts/trace.ts`; add
  `contracts/documents.ts`; export from each `index.ts`. Re-vendor server → client → mcp.
- **`reviewer-core/`** — `PromptParts.specs` / `ReviewInput.specs` become `{path, content}[]`;
  `assemblePrompt` labels each doc by path via `wrapUntrusted(path, content)`.
- **`server/`** — new `documents` module (discovery + read service, routes); new
  `agent_documents` + `skill_documents` tables + migration; per-workspace `root_folders`
  setting; ordered-attach on agents & skills modules; run-executor wiring.
- **`client/`** — new `/repos/[repoId]/context` screen; agent-editor Context tab; skill-editor
  "Project context to use" section; run-trace UI additions; a new Settings "root-folders"
  panel (with a scoped, sanctioned edit to the vendored `SETTINGS_SECTIONS` list); new hooks + i18n keys.
- Contracts: NEW `documents.ts` (`ProjectDocument`, `AgentDocumentLink`, `SkillDocumentLink`);
  EXTENDED `trace.ts` (additive fields — see T1). No existing contract field is mutated.

## Architecture changes
Onion / boundary roles of the new server module (mirror `modules/skills/`, per
`backend-onion-architecture`):
- `server/src/modules/documents/service.ts` — application layer; orchestrates against
  `Container` (`git`, `tokenizer`, settings).
- `server/src/modules/documents/helpers.ts` — pure discovery/scan helpers (hermetically testable).
- `server/src/modules/documents/routes.ts` — presentation (Fastify plugin, schema-first Zod).
- `server/src/modules/reviews/effective-documents.ts` — new pure helper for the union/dedup/order
  logic (AC-17/18/19), extracted for hermetic unit tests; consumed by `run-executor.ts`.
- Attachment tables `agent_documents` / `skill_documents` are infrastructure (Drizzle schema),
  join-owned by the agents and skills modules respectively (mirrors `agent_skills` ownership).
- Client: `client/src/app/repos/[repoId]/context/` is a repo-scoped App-Router screen (RSC
  page → client `_components/ContextWorkspace`); data access only via `lib/hooks/documents.ts`
  → `lib/api.ts` (per `ui-frontend-architecture`). The Settings root-folders panel follows the
  existing `SettingsView` section-dispatch pattern (`SettingsApiKeys`/`SettingsModels`).

## Phased tasks

### Phase 1 — Foundations (contracts, core, schema, settings)

#### T1 — Extend shared contracts (trace + documents) and re-vendor
- **Action:** In `server/src/vendor/shared/contracts/trace.ts` add, additively (do NOT change
  `specs_read`'s `z.array(z.string())` type): `documents_read: z.array(z.object({ path:
  z.string(), tokens: z.number().int().nonnegative(), origin: z.object({ type: z.enum(['agent',
  'skill']), skill_id: z.string().nullish(), skill_name: z.string().nullish() }) }))` and
  `documents_unavailable: z.array(z.string())` on the `RunTrace` object; add `specs_tokens:
  z.number().int().nullish()` to `RunStats`. Use `.default([])`/`.nullish()` so existing
  literal fixtures/builders keep parsing (see gotcha). Create `server/src/vendor/shared/contracts/
  documents.ts` with `ProjectDocument = z.object({ path, root, tokens })`, `AgentDocumentLink =
  z.object({ path, order })`, `SkillDocumentLink = z.object({ path, order })` (+ inferred types).
  Export both from `server/src/vendor/shared/index.ts`. Then re-vendor byte-aligned copies to
  `client/src/vendor/shared/` and `mcp/src/vendor/shared/` (hand-synced per repo convention).
- **Module:** server (+ client, mcp vendor copies)
- **Type:** backend
- **Skills to use:** `zod`, `client-server-communication`
- **Owned paths:** `server/src/vendor/shared/contracts/trace.ts`,
  `server/src/vendor/shared/contracts/documents.ts`, `server/src/vendor/shared/index.ts`,
  `client/src/vendor/shared/contracts/trace.ts`, `client/src/vendor/shared/contracts/documents.ts`,
  `client/src/vendor/shared/index.ts`, `mcp/src/vendor/shared/contracts/trace.ts`,
  `mcp/src/vendor/shared/contracts/documents.ts`, `mcp/src/vendor/shared/index.ts`
- **Depends-on:** none
- **Risk:** medium
- **Known gotchas:** Adding a REQUIRED (`.nullable()`) field breaks existing `contracts.test.ts`
  fixtures + client test builders — use `.default([])`/`.nullish()` (server/INSIGHTS). Vendored
  copies are the source of truth and are edited by hand per package (not byte-identical:
  comments/imports differ) — keep the field SETS in sync (server/INSIGHTS). This is an explicit,
  additive change to a shared contract — no existing field is retyped.
- **Acceptance:** `cd server && node_modules/.bin/tsc --noEmit` passes; `node_modules/.bin/vitest
  run test/contracts.test.ts` green; a `RunTrace.parse({...legacy fixture without new keys...})`
  succeeds (defaults applied); grep confirms `documents_read`/`documents_unavailable`/`specs_tokens`
  present in all three vendor copies of `trace.ts`.

#### T2 — reviewer-core `specs` shape → `{path, content}[]`, label block by path
- **Action:** Change `PromptParts.specs` (`reviewer-core/src/prompt.ts` line ~48) and
  `ReviewInput.specs` (`reviewer-core/src/review/run.ts` line ~62) from `string[]` to
  `{ path: string; content: string }[]`. In `assemblePrompt`, build `specsBlock` by mapping each
  entry to `wrapUntrusted(doc.path, doc.content)` (so the untrusted block's `source="…"` is the
  repo-relative path — AC-22) joined with `\n\n`; keep `prompt_assembly.specs` as the single joined
  string. Preserve the "empty/omitted specs → no `## Project context` block, byte-identical
  output" contract (AC-23/R6). Thread the new type through `reviewPullRequest` to `assemblePrompt`.
- **Module:** reviewer-core
- **Type:** core
- **Skills to use:** `typescript-expert`, `zod`
- **Owned paths:** `reviewer-core/src/prompt.ts`, `reviewer-core/src/review/run.ts`,
  `reviewer-core/test/prompt.test.ts`
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** reviewer-core is pure — no I/O, no tokenizer here; it only receives the
  already-read `{path, content}` (token estimation stays server-side). The `specs` slot is
  correctly `wrapUntrusted`-fenced (untrusted foreign text) — do NOT move it to the trusted
  `skills` join (reviewer-core/INSIGHTS: skills are trusted, specs/diff/PR body are not).
- **Acceptance:** `cd reviewer-core && node_modules/.bin/vitest run test/prompt.test.ts` — new
  cases assert (a) two docs render as `<untrusted source="specs/a.md">…</untrusted>` and
  `<untrusted source="docs/b.md">…</untrusted>` inside a single `## Project context` section in
  path order; (b) empty `specs` → assembled `user` message contains no `## Project context`
  substring (byte-identical to pre-change). `node_modules/.bin/tsc --noEmit` passes.

#### T3 — DB schema + migration for `agent_documents` and `skill_documents`
- **Action:** Create `server/src/db/schema/documents.ts` defining `agentDocuments` (`agent_id`
  uuid FK→`agents.id` cascade, `path` text notNull, `order` integer notNull default 0, composite
  PK `(agent_id, path)`) and `skillDocuments` (`skill_id` uuid FK→`skills.id` cascade, `path`,
  `order`, PK `(skill_id, path)`) — mirroring `agent_skills`. Add `export * from './documents.js'`
  to the barrel `server/src/db/schema.ts`. Generate the migration via `cd server && pnpm
  db:generate` (produces `0013_*.sql` + `meta/0013_snapshot.json`); do NOT hand-edit prior
  migrations.
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `postgresql-table-design`
- **Owned paths:** `server/src/db/schema/documents.ts`, `server/src/db/schema.ts`,
  `server/src/db/migrations/` (new `0013_*.sql` + `meta/` snapshot only)
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** These are NEW tables (no existing `documents` table — `context.ts` is
  code-intel, `knowledge.ts` is memory/conventions); append a new migration, never edit old ones
  (CLAUDE.md). Migrations are not applied on boot — run `pnpm db:migrate` before DB-backed tests.
- **Acceptance:** `cd server && pnpm db:generate` emits exactly one new `0013_*.sql` creating both
  tables; `pnpm db:migrate` applies clean against a fresh DB; `node_modules/.bin/tsc --noEmit`
  passes with the new schema exported from the barrel.

#### T4 — Per-workspace `root_folders` setting (default specs/docs/insights)
- **Action:** Add `server/src/modules/settings/root-folders.ts` exporting `getRootFolders(container,
  workspaceId): Promise<string[]>` — reads the `settings` row `key='root_folders'` for the
  workspace and `zod.safeParse`es a `z.array(z.string().min(1))`, falling back to
  `['specs','docs','insights']` (AC-8) — mirroring `getFeatureModelOverride`/`resolveFeatureModel`
  in `modules/settings/feature-models.ts`. Ensure the existing `GET/PUT /settings` route + `rowsToSettings`
  fold round-trips the `root_folders` key (add it to the settings value shape if the PUT body is
  schema-restricted), so T15's panel can read and write it.
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `zod`, `fastify-best-practices`
- **Owned paths:** `server/src/modules/settings/root-folders.ts`,
  `server/src/modules/settings/routes.ts`, `server/src/modules/settings/helpers.ts`
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** `settings` is a workspace-scoped key/value jsonb store, unique on
  `(workspace_id, user_id, key)`; use the existing upsert (`onConflictDoUpdate`) pattern. Value read
  must value-import the Zod schema, not `import type` (server/INSIGHTS runtime-safeParse gotcha).
- **Acceptance:** `cd server && node_modules/.bin/vitest run test/root-folders.test.ts` (hermetic,
  pure fold+parse+default) asserts default when unset and the parsed override when set;
  `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run test/settings*.it.test.ts` green
  (PUT then GET returns the custom roots).

### Phase 2 — Server services, routes, run-time wiring

#### T5 — Markdown discovery + read service (new `documents` module)
- **Action:** Create `server/src/modules/documents/{service.ts,helpers.ts,constants.ts}`.
  `DocumentsService` (constructor takes `container`) exposes: `discover(repo, roots):
  Promise<ProjectDocument[]>` — for each configured root that exists under the clone, recursively
  walk for `.md` files at any depth (pure walk in `helpers.ts`), returning `{ path (repo-relative),
  root, tokens }` where `tokens = container.tokenizer.count(content)` computed during the scan
  (AC-1/2, AC-15/26 estimate source, Q5); `readContent(repo, path): Promise<string | null>` —
  fresh read via `GitClient.readFile(repo, path)` / `join(repo.clonePath, path)` returning `null`
  on ENOENT (AC-20/24); `preview(repo, path)` for the UI (AC-3/14). Resolve roots via
  `getRootFolders(container, repo.workspaceId)` (T4). Gate on clone presence: if `!repo.clonePath`
  or the dir is absent, signal "not cloned" distinctly (AC-5).
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`, `security`
- **Owned paths:** `server/src/modules/documents/service.ts`,
  `server/src/modules/documents/helpers.ts`, `server/src/modules/documents/constants.ts`
- **Depends-on:** T1, T4
- **Risk:** medium
- **Known gotchas:** Do NOT use `RepoIntel.getConventionSamples` (drops config/markdown via
  `isJunkPath`; TS/JS-only) — read directly from the clone (server/INSIGHTS). Resolve the clone via
  the persisted `repo.clonePath`, not a cwd-derived `clonePathFor`, to stay correct outside the API
  process (server/INSIGHTS cwd-divergence). Constrain the walk to under each root and normalise to
  repo-relative POSIX paths; guard against path traversal in the later preview endpoint (`security`).
  Markdown content is untrusted — this service only reads/estimates, never interprets.
- **Acceptance:** `cd server && node_modules/.bin/vitest run test/documents-discovery.test.ts`
  (hermetic, pure `helpers.ts` walk over a temp fixture tree) asserts recursive `.md` collection
  under multiple roots, per-root origin tagging, and exclusion of non-`.md`; a DB-less service test
  with an injected fake `git`/`tokenizer` asserts `readContent` returns `null` for a missing path.

#### T6 — Documents module routes (list + preview) and registration
- **Action:** Create `server/src/modules/documents/routes.ts` (schema-first, `ZodTypeProvider`):
  `GET /repos/:id/documents` → `{ documents: ProjectDocument[] }` plus a discriminated `state`
  (`ready` | `not_cloned` | `empty`) so the client renders AC-4/AC-5 distinctly (each doc carries
  `tokens` — Q5); `GET /repos/:id/documents/content` with `?path=` query (Zod-validated) →
  `{ path, content }` for preview (AC-3/14). Resolve workspace via `getContext`. Register the module
  in `server/src/modules/index.ts` (one import + one record entry).
- **Module:** server
- **Type:** backend
- **Skills to use:** `fastify-best-practices`, `client-server-communication`, `zod`
- **Owned paths:** `server/src/modules/documents/routes.ts`, `server/src/modules/index.ts`
- **Depends-on:** T5
- **Risk:** low
- **Known gotchas:** Declare `params`/`querystring` via Zod in the route `schema`; never
  hand-roll `Schema.parse` in the handler (CLAUDE.md). Validate/sanitise the `path` query to
  prevent `..` traversal before it reaches `readContent` (`security`). Import shared types via the
  `@devdigest/shared` alias, never a deep relative vendor path (server/INSIGHTS).
- **Acceptance:** `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run
  test/documents-routes.it.test.ts` — asserts `GET /repos/:id/documents` returns discovered docs
  with token estimates for a seeded cloned-fixture repo, `state:'not_cloned'` when `clone_path` is
  null (AC-5), `state:'empty'` when roots have no `.md` (AC-4), and preview returns file content;
  an out-of-tree `?path=../../etc` returns 400/422, not file contents.

#### T7 — Agent document attachments (ordered attach + routes)
- **Action:** In `server/src/modules/agents/repository.ts` add `linkedDocuments(agentId):
  Promise<AgentDocumentLink[]>` (`orderBy(asc(order))`) and `setDocuments(agentId, paths: string[])`
  — dedupe `[...new Set(paths)]`, then in a transaction `SELECT pg_advisory_xact_lock(hashtext(
  ${agentId}))` → delete-all → insert with `order = index` (mirror `setSkills`). Add `AgentsService`
  passthrough. Add routes `GET /agents/:id/documents` and `POST /agents/:id/documents` (body
  `{ paths: string[] }`, wholesale replace+reorder) in `agents/routes.ts` (AC-10/12/13).
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `fastify-best-practices`, `backend-onion-architecture`
- **Owned paths:** `server/src/modules/agents/repository.ts`, `server/src/modules/agents/service.ts`,
  `server/src/modules/agents/routes.ts`
- **Depends-on:** T1, T3
- **Risk:** medium
- **Known gotchas:** The transaction-scoped advisory lock is LOAD-BEARING — plain delete+insert
  deadlocks/duplicate-keys under the concurrent double-fire (server/INSIGHTS advisory-lock note).
  Verify with a TRULY concurrent `Promise.all` burst, not sequential awaits. Never interpolate a JS
  array into raw `sql\`= ANY(${arr})\`` — use `inArray` (server/INSIGHTS). Store only the path
  (never inline content — AC-13).
- **Acceptance:** `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run
  test/agent-documents.it.test.ts` — set → get returns paths in persisted order; reorder persists;
  a `Promise.all` of N identical `setDocuments` produces no `deadlock`/`duplicate key` and a
  consistent final set.

#### T8 — Skill document attachments (ordered attach + routes)
- **Action:** In `server/src/modules/skills/repository.ts` add `linkedDocuments(skillId)` and
  `setDocuments(skillId, paths)` (same advisory-lock delete+insert on `skill_documents`), a
  `SkillsService` passthrough, and routes `GET /skills/:id/documents` + `POST /skills/:id/documents`
  (AC-11/12/13).
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `fastify-best-practices`, `backend-onion-architecture`
- **Owned paths:** `server/src/modules/skills/repository.ts`, `server/src/modules/skills/service.ts`,
  `server/src/modules/skills/routes.ts`
- **Depends-on:** T1, T3
- **Risk:** medium
- **Known gotchas:** Same advisory-lock + concurrency verification as T7. `/skills/*` routes
  resolve the DEFAULT workspace via `getContext` (no ws param) — route-level it-tests only see
  seeded-default-workspace skills; test isolated data via the repository directly (server/INSIGHTS).
  Attaching documents must NOT bump skill body version (versioning keys on body only — server/INSIGHTS).
- **Acceptance:** `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run
  test/skill-documents.it.test.ts` — set/get/reorder round-trips; concurrent burst is deadlock-free;
  a `getStats`/version check confirms attaching does not increment `skills.version`.

#### T9 — run-executor: assemble effective docs, feed prompt, populate trace
- **Action:** Add `server/src/modules/reviews/effective-documents.ts` (pure): `computeEffectiveDocuments(
  agentDocs: AgentDocumentLink[], enabledSkillDocs: {skillId, skillName, docs: SkillDocumentLink[]}[]):
  {path, origin}[]` implementing AC-17 (union), AC-18 (dedup by path), AC-19 (agent-first in order,
  then per enabled-skill in skill order then doc order; a dedup keeps its agent-level position). In
  `run-executor.ts` `runOneAgent`: load `this.agents.linkedDocuments(agent.id)` and, for each
  enabled linked skill, its `linkedDocuments(skill.id)`; compute the effective set; for each entry
  `readContent(repo, path)` from the reviewed PR's own clone — collect `{path, content}` for present
  files and push absent paths to `documents_unavailable` (AC-24, `runLog.info('⚠️ …')` not
  `error`); pass `specs: readDocs.map(d => ({path, content}))` into `reviewPullRequest` (AC-20/21/22);
  estimate `specs_tokens = tokenizer.count(join)`; populate the trace: `specs_read` = read paths
  (AC-25), `documents_read` = `{path, tokens, origin}[]` (AC-26/28), `documents_unavailable`, and
  `stats.specs_tokens`. Set the same new fields in `traceFromBuffer` (default `[]`/`null`) so
  failure/cancel traces still parse. Empty effective set → pass no `specs` (AC-23/R6 non-regression).
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`, `security`, `drizzle-orm-patterns`
- **Owned paths:** `server/src/modules/reviews/run-executor.ts`,
  `server/src/modules/reviews/effective-documents.ts`
- **Depends-on:** T1, T2, T3, T5, T7, T8
- **Risk:** high
- **Known gotchas:** Only ENABLED skills contribute (AC-17; matches existing `linkedSkills.filter(
  l => l.skill.enabled)`). Resolve content against the PR's own clone via `repo.clonePath` /
  `readContent` — a path present in one repo may be absent in another (AC-24 edge case). Keep the
  empty-set path byte-identical to today (the reviewer-core "omitted slot → identical output"
  contract; reviewer-core/INSIGHTS). Value-import any shared Zod schema used for trace parsing. Do
  NOT read denormalized columns for anything findings-related here — out of scope.
- **Acceptance:** (1) `cd server && node_modules/.bin/vitest run test/effective-documents.test.ts`
  (hermetic) proves AC-17/18/19: union, dedup-by-path keeps agent position, agent-then-skill order,
  disabled skills excluded. (2) `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run
  test/run-executor-documents.it.test.ts` with a `MockLLMProvider` proves the deterministic slice:
  attached doc content appears in `prompt_assembly` under a `## Project context` block labelled by
  path (AC-20/21/22); `trace.specs_read` lists the path and `trace.documents_read` carries its
  token volume + origin (AC-25/26/28); a missing attached path lands in `documents_unavailable` and
  the run still completes (AC-24); with nothing attached, `prompt_assembly.specs` is null and the
  assembled prompt is unchanged (AC-23/R6).

### Phase 3 — Client (screen, editors, settings, run-trace)

#### T10 — Client data hooks for documents + attachments
- **Action:** Create `client/src/lib/hooks/documents.ts`: `useRepoDocuments(repoId)` (`GET
  /repos/:id/documents`, key `["repo-documents", repoId]`), `useDocumentPreview(repoId, path)`
  (lazy/enabled-gated), `useAgentDocuments(agentId)` + `useSetAgentDocuments(agentId)` (`POST
  /agents/:id/documents` `{paths}`, `setQueryData(["agent-documents", agentId])` +
  invalidate `["agent", agentId]`), `useSkillDocuments(skillId)` + `useSetSkillDocuments(skillId)`.
  All via `api.get/post` (never `fetch` directly). Types from `@devdigest/shared`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `client-server-communication`
- **Owned paths:** `client/src/lib/hooks/documents.ts`
- **Depends-on:** T1
- **Risk:** low
- **Known gotchas:** Mirror the `useSetAgentSkills` wholesale-replace + `setQueryData`/invalidate
  pattern (client investigation). Any component using these hooks needs a `QueryClientProvider` in
  tests even when `enabled:false` (client/INSIGHTS).
- **Acceptance:** `cd client && node_modules/.bin/tsc --noEmit` passes; a hook unit test with a
  mocked `api` asserts `useSetAgentDocuments` POSTs `{ paths }` to `/agents/:id/documents` and
  updates the cache key.

#### T11 — Project Context screen (list + preview + filter + refresh + states)
- **Action:** Create `client/src/app/repos/[repoId]/context/page.tsx` (thin client entry reading
  `useParams().repoId`, wrapped in `AppShell` with the standard `padding:"24px 32px 44px"` gutter)
  and `_components/ContextWorkspace/` — list discovered docs by repo-relative path with origin-root
  badge (AC-1/2), preview pane (AC-3), search filter (AC-7), refresh button that refetches (AC-6),
  empty state (AC-4) and repo-not-cloned state (AC-5) keyed off the response `state`. Reuse the
  pre-seeded `context.json` namespace (add keys as needed). Add a link to this screen on the existing
  repo-scoped Conventions page/workspace header (Q3 — no vendored nav edit) plus breadcrumb.
- **Module:** client
- **Type:** ui
- **Skills to use:** `next-best-practices`, `ui-frontend-architecture`, `react-best-practices`
- **Owned paths:** `client/src/app/repos/[repoId]/context/page.tsx`,
  `client/src/app/repos/[repoId]/context/_components/`, `client/messages/en/context.json`,
  `client/src/app/repos/[repoId]/conventions/page.tsx`
- **Depends-on:** T10
- **Risk:** medium
- **Known gotchas:** Do NOT edit `client/src/vendor/ui/nav.ts` (vendored) for this entry. Every page
  supplies its own gutter — `AppFrame`'s `<main>` has none (client/INSIGHTS). Gate "empty" vs
  "unavailable" on the server `state`, not on list length alone (mirror the BlastRadius empty-state
  lesson). Use `router.push(..., { scroll:false })` for master/detail selection to avoid list
  scroll-reset (client/INSIGHTS). A verified icon name from the UI kit only (client/INSIGHTS).
- **Acceptance:** `cd client && node_modules/.bin/vitest run
  src/app/repos/\[repoId\]/context/_components/**/*.test.tsx` (RTL) — asserts docs render with
  origin badges and paths, filter narrows the list, empty state shows AC-4 copy when `state:'empty'`,
  unavailable state shows AC-5 copy when `state:'not_cloned'`, and selecting a doc shows its preview;
  `pnpm build`-equivalent typecheck passes.

#### T12 — Agent editor "Context" tab
- **Action:** Add `"context"` to `VALID_TABS` (`agents/[id]/page.tsx` line ~15) AND the editor
  `constants.ts` `TABS` array; render it in `AgentEditor.tsx`. Create `_components/ContextTab/` —
  a repo picker (default the active/first cloned repo, Q2) driving `useRepoDocuments`; per-doc rows
  with origin badge, attach/detach checkbox, native drag-reorder (mirror `SkillsTab`), in-row
  preview (AC-14), live summed token volume of attached docs (AC-15, from per-doc `tokens`), and an
  "injected into each run as an untrusted block" note (AC-16). Persist via `useSetAgentDocuments`
  (wholesale ordered set). Add strings under `agents.json`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/app/agents/[id]/page.tsx`,
  `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`,
  `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/`,
  `client/messages/en/agents.json`
- **Depends-on:** T10
- **Risk:** medium
- **Known gotchas:** The vendored `Checkbox` fires `onChange` TWICE per click → replicate
  `SkillsTab`'s per-id `toggling` `useRef<Set>` in-flight guard cleared via the mutation's
  `onSettled` (client/INSIGHTS); reorder/`onDrop` passes no `onSettled`. Add EVERY new i18n
  namespace used to any test's provider `messages` or it silently logs MISSING_MESSAGE
  (client/INSIGHTS). Store paths only (server enforces; UI never inlines text — AC-13).
- **Acceptance:** `cd client && node_modules/.bin/vitest run
  src/app/agents/\[id\]/_components/AgentEditor/_components/ContextTab/*.test.tsx` — clicking an
  attach checkbox twice back-to-back calls the set mutation ONCE (double-fire guard); token-volume
  label updates as selection changes; drag-reorder produces the reordered `paths` in the mutation.

#### T13 — Skill editor "Project context to use" section
- **Action:** Add a "Project context to use" section to the skill `ConfigTab` (before `s.actions`):
  repo picker + `useSkillDocuments`/`useSetSkillDocuments`, attach/detach, drag-order, in-row
  preview, summed token volume, and the untrusted note (AC-11/12/13/14/15/16). Add strings under
  `skills.json`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:**
  `client/src/app/skills/[id]/_components/SkillEditor/_components/ConfigTab/ConfigTab.tsx`,
  `client/src/app/skills/[id]/_components/SkillEditor/_components/ConfigTab/styles.ts`,
  `client/src/app/skills/[id]/_components/SkillEditor/_components/ConfigTab/_components/`,
  `client/messages/en/skills.json`
- **Depends-on:** T10
- **Risk:** medium
- **Known gotchas:** Document attach/detach persists via its OWN mutation (`POST /skills/:id/
  documents`) — keep it OUT of the body-only per-field-diff PATCH and `isDirty` gate (attachments
  must not bump skill version — client/INSIGHTS body-only versioning). Same `Checkbox` double-fire
  guard as T12. Add `skills` + any child namespaces to affected tests' providers.
- **Acceptance:** `cd client && node_modules/.bin/vitest run
  src/app/skills/\[id\]/_components/SkillEditor/_components/ConfigTab/*.test.tsx` — attaching a doc
  triggers the documents mutation but NOT the skill body PATCH; token volume renders; the section
  lists docs with origin badges and previews.

#### T14 — Run-trace UI: read docs, token volume, expandable untrusted block
- **Action:** In `TraceBody.tsx`: render the read-doc list from `trace.specs_read` (already wired
  at the `specsRead` Row — now populated with paths, AC-25) and, where richer detail exists, from
  `trace.documents_read` (path + per-doc origin, AC-28); render `trace.documents_unavailable` as a
  distinct "attached but unavailable" note (AC-24); pass a token-volume `badge` (from
  `stats.specs_tokens`) to the specs `PromptBlock` (AC-26); ensure the `prompt_assembly.specs`
  `PromptBlock` is expandable to its literal content, labelled untrusted (AC-27 — PromptBlock already
  supports collapse + fullscreen). Add a `PROMPT_COLORS` entry if needed and strings under
  `runs.json`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:**
  `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/styles.ts`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/constants.ts`,
  `client/messages/en/runs.json`
- **Depends-on:** T1
- **Risk:** low
- **Known gotchas:** Reuse the existing `PromptBlock` (collapse + copy + fullscreen modal + optional
  `badge`) rather than building a new expander. `specs_read` is `string[]` (paths) — render mono
  chips; guard the new arrays for legacy/empty traces (they default `[]`). Add `runs` namespace to
  affected tests' providers (client/INSIGHTS MISSING_MESSAGE).
- **Acceptance:** `cd client && node_modules/.bin/vitest run
  src/app/repos/\[repoId\]/pulls/\[number\]/_components/RunTraceDrawer/**/*.test.tsx` — a trace
  fixture with `specs_read`, `documents_read`, `documents_unavailable`, and a `prompt_assembly.specs`
  string renders: the read-doc paths, the token-volume badge, the unavailable note, and an expandable
  block showing the literal untrusted content; an empty/legacy trace renders without error.

#### T15 — Settings "root-folders" panel (view/edit the per-workspace override)
- **Action:** Give the user an in-product way to set the AC-9 override. (a) Extend the vendored
  `SETTINGS_SECTIONS` array in `client/src/vendor/ui/nav.ts` with `{ key: "root-folders", label:
  "Project Doc Roots" }` (or similar) — a DELIBERATE, sanctioned, minimal edit to this one list
  (see Open questions AC-9 note). (b) Add a `SECTION_ROOT_FOLDERS` constant to
  `SettingsView/constants.ts` and a dispatch branch in `SettingsView.tsx` rendering a new
  `_components/SettingsRootFolders/` panel (mirror `SettingsApiKeys`/`SettingsModels`). (c) The panel
  loads the current per-workspace roots and lets the user view/add/remove/reset the list, then saves
  via `PUT /settings` writing the `root_folders` key (T4's API); an empty/unset override shows the
  `specs/docs/insights` default (AC-8/AC-9). (d) Add data hooks `useRootFolders()` +
  `useSetRootFolders()` to `client/src/lib/hooks/settings.ts` (via `lib/api`), and panel strings to
  `settings.json`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/vendor/ui/nav.ts`,
  `client/src/app/settings/[section]/_components/SettingsView/SettingsView.tsx`,
  `client/src/app/settings/[section]/_components/SettingsView/constants.ts`,
  `client/src/app/settings/[section]/_components/SettingsView/_components/SettingsRootFolders/`,
  `client/src/lib/hooks/settings.ts`, `client/messages/en/settings.json`
- **Depends-on:** T4
- **Risk:** medium
- **Known gotchas:** Editing `src/vendor/ui/nav.ts` is normally forbidden (client CLAUDE.md "do not
  touch") — this is the ONE sanctioned exception, scoped to appending a `SETTINGS_SECTIONS` entry;
  do not otherwise modify the vendored file, and note there is no cross-package copy of this UI nav
  (unlike the shared contracts) so no re-vendor is needed. Follow the existing `SettingsView`
  section-dispatch pattern; the default-section fallback (`SETTINGS_SECTIONS[0]`) must be unchanged.
  Data access only via `lib/hooks → lib/api` (client CLAUDE.md). Add `settings` namespace to the
  panel test's provider `messages` (client/INSIGHTS MISSING_MESSAGE).
- **Acceptance:** `cd client && node_modules/.bin/vitest run
  src/app/settings/\[section\]/_components/SettingsView/_components/SettingsRootFolders/*.test.tsx`
  (RTL, mocked `api`) — the panel renders the current roots (default `specs`/`docs`/`insights` when
  unset), adding/removing a root and saving issues a `PUT /settings` carrying the edited
  `root_folders` list, and reset restores the default; `node_modules/.bin/tsc --noEmit` passes and
  `/settings/root-folders` deep-links to the panel.

## Testing strategy
- **reviewer-core (T2):** hermetic `node_modules/.bin/vitest run test/prompt.test.ts` — per-path
  labelling and empty-set byte-identity.
- **server unit (hermetic):** `effective-documents.test.ts` (AC-17/18/19), `documents-discovery.test.ts`
  (recursive walk), `root-folders.test.ts` (default + override). Run via `node_modules/.bin/vitest run`.
- **server integration (`.it.test.ts`, testcontainers):** `documents-routes.it.test.ts`,
  `agent-documents.it.test.ts`, `skill-documents.it.test.ts`, `run-executor-documents.it.test.ts`,
  and the settings round-trip. Run with `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest
  run test/<x>.it.test.ts` (sandbox disabled to reach Docker). These carry the AC-20/21/22/24/25/26
  deterministic proof and the concurrency (advisory-lock) proof — a `.it.test.ts` is mandatory
  because Drizzle SQL binding is not exercised by hermetic tests (server/INSIGHTS `= ANY` lesson).
- **client (RTL):** `node_modules/.bin/vitest run <path>` per component (T11–T15); use `fireEvent`
  (no user-event in this package); wrap Query-using components in `QueryClientProvider`; include all
  used i18n namespaces in test `messages`.
- **client typecheck/build:** `node_modules/.bin/tsc --noEmit`; the full client gate is
  typecheck + test + build (no ESLint exists).
- **Manual demonstration (R7 / Scenario, AC-1…AC-3 & the cite-the-invariant flow):** on a mid-tier
  model, attach an invariant spec to an agent, review a PR that violates it, confirm the reviewer
  cites the doc and the trace shows it read (path + token volume). Not a unit test (model-dependent).

## Risks & mitigations
- **Shared-contract drift across 3 vendor copies (T1)** → single owning task; additive-only
  (`.default([])`/`.nullish()`); grep all three copies in acceptance.
- **Concurrent attach deadlock/duplicate-key (T7/T8)** → transaction-scoped advisory lock + dedupe;
  verify with a concurrent `Promise.all` burst, never sequential awaits.
- **Path traversal via preview `?path=` (T6)** → Zod-validate + reject `..`/absolute paths before
  `readContent`; `security` skill review.
- **Non-regression when nothing attached (T9/R6)** → empty set passes no `specs`; explicit it-test
  asserts `prompt_assembly.specs` null and unchanged assembled prompt.
- **Clone-path resolution outside API cwd (T5)** → resolve via persisted `repo.clonePath`, not
  cwd-derived `clonePathFor` (server/INSIGHTS cwd-divergence).
- **Checkbox double-fire re-adds/reorders wrongly (T12/T13)** → replicate SkillsTab's `toggling`
  ref guard; regression test with double back-to-back clicks.
- **Sanctioned vendored edit scope-creep (T15)** → the `src/vendor/ui/nav.ts` edit is limited to
  appending one `SETTINGS_SECTIONS` entry; acceptance greps to confirm nothing else in the file changed.

## Red-flags check
- [x] Every requirement (R1–R7) maps to at least one task (R1→T5/T6/T11; R2→T4/T5/T15;
  R3→T7/T8/T12/T13; R4→T2/T9; R5→T1/T9/T14; R6→T2/T9; R7→manual demo + T9 deterministic slice)
- [x] AC-9 (set the per-workspace override) is owned end to end: T4 (storage/default/API) →
  T5 (consumption) → T15 (view/edit UI)
- [x] No specification was authored or edited — SPEC-01 taken as input
- [x] Execution mode recorded (multi-agent) and the plan is shaped for it
- [x] Dependencies form a DAG (no cycles) — all Depends-on point to earlier tasks (T15→T4)
- [x] (multi-agent) Concurrent tasks have non-overlapping Owned paths (verified within each phase;
  T15's client files are disjoint from T10–T14)
- [x] Every Acceptance is measurable (named test files + commands + observable assertions)
- [x] Contracts (T1) and the reviewer-core shape (T2) are defined before any dependent task
- [x] The one shared-contract change (T1) is additive and explicitly called out; no existing field
  is mutated
- [x] `*/src/vendor/**` is only touched in T1 (the sanctioned per-package re-vendor of the shared
  contract) and T15 (one sanctioned, scoped `SETTINGS_SECTIONS` append per the AC-9 decision);
  `client/src/vendor/ui/nav.ts`'s sidebar `NAV` list is NOT modified
- [x] No DB table deletions or edits to existing migrations — only a new `0013_*` migration + two new tables
```