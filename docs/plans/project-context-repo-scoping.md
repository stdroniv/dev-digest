# Implementation Plan: Project Context — Skill Context Tab + Same-Repository Invariant (SPEC-01 follow-up)

## Overview
SPEC-01 ("Project Context") was implemented once (`docs/plans/project-context.md`,
commit `160f2b6`). A follow-up investigation against the CURRENT spec
(`specs/SPEC-01-2026-07-01-project-context.md`, since amended) found two real gaps
that were verified against the actual code, not assumed:

- **Gap 1 (AC-11 non-conformance)** — the Skill editor never got a real sibling
  "Context" tab. `client/src/app/skills/[id]/_components/SkillEditor/constants.ts`
  `TABS` is still `config, preview, stats, versions`; "Project context to use" is a
  `DocumentsSection` embedded inside `ConfigTab`. The Agent editor DOES have a real
  `context` tab (`AgentEditor/constants.ts` `TABS`, `_components/ContextTab/`).
- **Gap 2 (AC-29…AC-32, new)** — the "same-repository invariant" has no
  implementation at all. `AgentDocumentLink`/`SkillDocumentLink` carry no
  repository identity (`server/src/vendor/shared/contracts/documents.ts`), so
  nothing anchors an attached set to the repo it was attached from, nothing gates
  attaching from a different repo, and `run-executor.ts`'s existing effective-set
  assembly (T9 of the original plan — already reads fresh content per path and
  records `documents_unavailable` for AC-24) has no repo-mismatch check at all —
  it would happily resolve an agent's attached paths against ANY reviewed PR's
  clone, which is exactly the silent-wrong-file risk AC-31 exists to prevent.

This plan covers ONLY these two gaps. It does not re-litigate or re-implement
anything already working (discovery, preview, per-doc attach/detach/reorder,
token volume, `documents_unavailable`/AC-24, the untrusted prompt block, trace
read-doc list). Verified working today by direct code reading: `server/src/modules/
documents/service.ts`, `server/src/modules/reviews/effective-documents.ts` (AC-17/
18/19), `server/src/modules/reviews/run-executor.ts` (AC-20…AC-28 wiring),
`client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/
ContextTab.tsx`, `client/src/app/skills/[id]/_components/SkillEditor/_components/
ConfigTab/_components/DocumentsSection/DocumentsSection.tsx`, `client/src/lib/
hooks/documents.ts`, and the `TraceBody.tsx` rendering of `specs_read`/
`documents_read`/`documents_unavailable`.

## Execution mode
multi-agent (parallel) — recommended. Phase 1 (contracts + migration) is a single
front-loaded dependency; Phase 2 (server enforcement + run-time exclusion) and the
client phases can then fan out, with one deliberate serialization: the new shared
client hook (T6) must land before the two tab tasks that consume it (T7, T8).

## Requirements (verified)
Source: `specs/SPEC-01-2026-07-01-project-context.md` (current version, read in full).

- **R1 — Skill Context tab** (AC-11): promote "Project context to use" from a
  `ConfigTab` section to a real sibling "Context" tab in the Skill editor, mirroring
  the Agent editor's `context` tab (tab registration, routing, layout), reusing the
  existing `DocumentsSection` logic and its `useSkillDocuments`/`useSetSkillDocuments`
  hooks rather than rewriting them.
- **R2 — Same-repository invariant, storage** (AC-29): an agent's (or skill's)
  attached document set is anchored to the single repository active when the FIRST
  document was attached; the anchor is stored positively (a `repo_id` per
  attachment row), never inferred from paths.
- **R3 — Same-repository invariant, attach-time gate** (AC-30): switching the
  active repo in the document picker never restricts browsing/previewing; it only
  gates ATTACHING a document from a newly selected repo when the agent/skill
  currently has attachments anchored to a different repo — requiring a
  user-confirmed clear before the new attachment is permitted.
- **R4 — Same-repository invariant, run-time exclusion** (AC-31): when a review
  run's PR repo differs from an attached set's anchor repo, the system excludes
  the ENTIRE attached set for that run (never resolves paths path-by-path against
  the wrong repo), surfaces this distinctly from the per-document AC-24
  "attached-but-unavailable" case, visible before/at run start, and never fails
  the run.
- **R5 — Same-repository invariant, symmetry** (AC-32): R2–R4 apply identically to
  agents and to skills.
- **R6 — Non-functional carry-overs**: zero new model calls; determinism; the
  invariant is enforced positively (DB/service layer), never by re-parsing paths
  (spec's Non-functional "Same-repository invariant" bullet); non-regression for
  existing attachments where feasible (see Open questions — legacy-row handling).

## Open questions & recommendations
- **Q1 (duplicate attach/detach/reorder logic across the two editors)** —
  `ContextTab.tsx` (agent) and `DocumentsSection.tsx` (skill) are ~90% identical
  (hydration effect, `toggling` double-fire guard, drag-reorder, token sum, preview
  toggle). Gap 2 adds non-trivial NEW logic (repo-mismatch detection + a
  confirm-and-clear flow) that both editors need identically (R5/AC-32). Writing
  it twice risks drift between agent and skill behavior — exactly the kind of
  duplication the codebase's `lib/hooks/*` convention exists to avoid.
  **Recommendation (accepted):** extract a single reusable hook,
  `client/src/lib/hooks/use-document-attachment.ts`, encapsulating ALL of the
  state logic (not UI) from both existing components plus the new repo-mismatch
  confirm state machine. Both `AgentEditor/_components/ContextTab` and the new
  `SkillEditor/_components/ContextTab` become thin JSX wrappers around it. This
  directly satisfies R1's "reuse existing logic/hooks... rather than rewriting"
  instruction (the hook literally IS the extracted `DocumentsSection` logic) and
  gives R5 (AC-32 symmetry) a single implementation instead of two.
- **Q2 (legacy attachment rows with no repo anchor)** — Commit `160f2b6` may
  already have live `agent_documents`/`skill_documents` rows (course seed data,
  or a real prior session) attached before `repo_id` existed. There is no reliable
  way to backfill their true origin repo from a path alone (that's precisely the
  risk AC-31 exists to avoid) — a guessed backfill would violate R6 non-regression
  by risking a WRONG anchor. **Recommendation (accepted):** make `repo_id`
  NULLABLE. A `NULL` anchor means "not yet anchored" (pre-migration or fully
  cleared): (a) the client's repo-mismatch gate does not fire against a `NULL`
  anchor (attaching from any repo silently establishes it, matching AC-29's "the
  repo active when the FIRST document was attached" — for legacy rows, `next`
  edit IS effectively their first anchored edit); (b) the run-executor's
  wholesale-exclusion check (R4) treats `NULL` as "no exclusion" (preserves
  today's behavior for untouched legacy attachments — a deliberate, documented
  exception, not silent scope creep). The FIRST `setDocuments` write after this
  ships naturally stamps `repo_id` on every row (wholesale delete+insert), so the
  system self-heals without a data migration script.
- **Q3 (FK `ON DELETE` behavior for the new `repo_id` column)** — CASCADE would
  silently mass-delete an agent's/skill's attachments the moment its anchor repo
  row is removed (e.g. workspace repo cleanup), which is surprising and
  irreversible. **Recommendation (accepted):** `ON DELETE SET NULL` — the
  attachment rows (and their paths) survive; the anchor just reverts to the "not
  yet anchored" state from Q2, and the next attach re-anchors normally.
- **Q4 (where the AC-31 invariant check runs, and the TOCTOU risk)** — the
  attach-time check (R3) and the transaction-scoped advisory lock
  (`pg_advisory_xact_lock`, reused from `setSkills`/original T7/T8) both apply to
  the SAME `agentId`/`skillId`. If the anchor check runs in the service layer
  BEFORE the transaction, two concurrent `setDocuments` calls (the Checkbox
  double-fire precedent) could both pass the check against a stale anchor and
  race. **Recommendation (accepted):** move the anchor check INSIDE the same
  transaction as the existing delete+insert, after the advisory lock is
  acquired — in the repository method, not the service. This is a deliberate,
  documented exception to the usual "domain errors thrown from the service layer"
  shape, justified by needing atomicity with the lock (see T3 Known gotchas).
- **Q5 (AC-31 "visible before or at run start")** — a full pre-flight check in the
  run-QUEUEING route (before any run starts) would touch `reviews/routes.ts` and
  widen this plan's surface well beyond the two identified gaps. The existing
  per-agent execution in `run-executor.ts` already computes the effective set
  near the very start of `runOneAgent` (before the per-path read loop, before the
  LLM call) and streams `RunLogger` events live over SSE to the client's Live Log
  as the run proceeds. **Recommendation (accepted, scoped):** satisfy "before/at
  run start" by (a) logging the exclusion as one of the first events in
  `runOneAgent` (before the read loop) via `runLog.info` (never `.error` — a
  mismatch is never a hard failure, mirroring the AC-24 precedent) and (b)
  recording it as a distinct, structured `RunTrace` field the completed-run UI
  renders prominently (T9). A pre-run warning in the "Run on PR" trigger dialog is
  flagged as a reasonable follow-up but is explicitly OUT of scope here.

## Affected modules & contracts
- **`@devdigest/shared` (vendored, 3 copies)** — extend `contracts/documents.ts`
  (`repo_id` on `AgentDocumentLink`/`SkillDocumentLink`) and `contracts/trace.ts`
  (new `DocumentsRepoExclusion` + `RunTrace.documents_repo_excluded`). Re-vendor
  server → client → mcp.
- **`server/`** — `db/schema/documents.ts` (+ migration); `modules/agents/
  {repository,service,routes}.ts` and `modules/skills/{repository,service,
  routes}.ts` (anchor storage + enforcement); `modules/reviews/
  effective-documents.ts` (wholesale-exclusion logic) and `run-executor.ts`
  (wiring + trace + log).
- **`client/`** — `lib/hooks/documents.ts` (repo_id-aware mutations); new
  `lib/hooks/use-document-attachment.ts` (shared logic); Agent editor
  `ContextTab` (adopts the shared hook); new Skill editor `ContextTab` (Gap 1,
  built on the same shared hook); `SkillEditor/constants.ts` +
  `SkillEditor.tsx`; `ConfigTab.tsx` (drop the embedded section);
  `RunTraceDrawer/_components/TraceBody` (render the new exclusion distinctly).
- Contracts: EXTENDED `documents.ts` (`repo_id` — additive to two existing
  object schemas) and `trace.ts` (new type + one new `RunTrace` field, both
  additive). No existing field is retyped or removed.

## Architecture changes
- The anchor-enforcement check is placed in the REPOSITORY method (`setDocuments`),
  inside the same transaction as the existing advisory lock — a deliberate,
  narrow exception to putting domain validation in the service layer, required
  for atomicity (Q4). The service layer still owns translating a thrown
  `ConflictError` into the HTTP response (already handled generically by
  `app.setErrorHandler`, per `server/src/app.ts`) — no new error-mapping code
  needed.
- `effective-documents.ts` remains a pure, hermetically-testable module (no I/O);
  it grows a THIRD input (the reviewed PR's `repoId`) and a second output
  (`excludedByRepoMismatch`), still consumed only by `run-executor.ts`.
- Client: `use-document-attachment.ts` lives in `lib/hooks/` (data/state logic,
  per `ui-frontend-architecture`'s "data access only via lib/hooks" rule) even
  though it manages local UI state as well as mutations — it is parameterized by
  the caller's own `links`/`setDocuments` hook results, so it stays domain-agnostic
  (agent vs skill) and framework-idiomatic (a hook, not a component), matching
  this codebase's existing `lib/hooks/*` shape.

## Phased tasks

### Phase 1 — Foundations (contracts, schema)

#### T1 — Extend shared contracts (documents `repo_id` + trace exclusion) and re-vendor
- **Action:** In `server/src/vendor/shared/contracts/documents.ts`, add
  `repo_id: z.string().uuid().nullable()` to `AgentDocumentLink` and
  `SkillDocumentLink` (additive; nullable per Q2 — legacy/unanchored rows). In
  `server/src/vendor/shared/contracts/trace.ts`: extract the existing inline
  `DocumentRead.origin` object into a named `DocumentOrigin` schema (pure
  refactor, same wire shape) and reuse it; add
  `export const DocumentsRepoExclusion = z.object({ origin: DocumentOrigin, paths:
  z.array(z.string()) })` (+ inferred type); add
  `documents_repo_excluded: z.array(DocumentsRepoExclusion).default([])` to
  `RunTrace` (default `[]` so legacy traces still parse, mirroring the
  `documents_read`/`documents_unavailable` precedent). Re-vendor byte-aligned
  copies to `client/src/vendor/shared/` and `mcp/src/vendor/shared/`.
- **Module:** server (+ client, mcp vendor copies)
- **Type:** backend
- **Skills to use:** `zod`, `client-server-communication`
- **Owned paths:** `server/src/vendor/shared/contracts/documents.ts`,
  `server/src/vendor/shared/contracts/trace.ts`, `server/src/vendor/shared/index.ts`
  (only if a new export needs adding — `DocumentsRepoExclusion`/`DocumentOrigin`),
  `client/src/vendor/shared/contracts/documents.ts`,
  `client/src/vendor/shared/contracts/trace.ts`, `client/src/vendor/shared/index.ts`,
  `mcp/src/vendor/shared/contracts/documents.ts`,
  `mcp/src/vendor/shared/contracts/trace.ts`, `mcp/src/vendor/shared/index.ts`
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** `repo_id` MUST be `.nullable()` not `.optional()` on the
  server response side — existing rows will genuinely persist `NULL`, not an
  absent key (server/INSIGHTS runtime-safeParse gotcha: value-import, not
  `import type`, when a Zod schema is used at runtime). Vendored copies are
  hand-synced, not byte-identical (comments/imports differ) — keep field SETS in
  sync across all three.
- **Acceptance:** `cd server && node_modules/.bin/tsc --noEmit` passes;
  `node_modules/.bin/vitest run test/contracts.test.ts` green; a
  `RunTrace.parse({...legacy fixture without documents_repo_excluded...})`
  succeeds (default `[]` applied); grep confirms `repo_id` present on both link
  types and `documents_repo_excluded` present in all three `trace.ts` vendor
  copies.

#### T2 — DB migration: `repo_id` on `agent_documents` / `skill_documents`
- **Action:** In `server/src/db/schema/documents.ts`, add to both tables:
  `repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'set null' })`
  (nullable — Q2/Q3). Add an index on each (`agent_documents_repo_idx` /
  `skill_documents_repo_idx`) per `postgresql-table-design` (FK columns should be
  indexed). Import `repos` from `./repos`. Generate the migration via
  `cd server && pnpm db:generate` (produces `0014_*.sql` + `meta/0014_snapshot.json`);
  do NOT hand-edit prior migrations.
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `postgresql-table-design`
- **Owned paths:** `server/src/db/schema/documents.ts`,
  `server/src/db/migrations/` (new `0014_*.sql` + `meta/` snapshot only)
- **Depends-on:** T1 (field name parity: contract `repo_id` ↔ column `repo_id`)
- **Risk:** low
- **Known gotchas:** This is an ADD-COLUMN migration on existing tables (not a
  new table) — `pnpm db:generate` must emit `ALTER TABLE ... ADD COLUMN repo_id`,
  not a table drop/recreate; verify the generated SQL before accepting it.
  Migrations are not applied on boot — `pnpm db:migrate` before any DB-backed test.
- **Acceptance:** `cd server && pnpm db:generate` emits exactly one new
  `0014_*.sql` adding a nullable `repo_id` column (+ FK `ON DELETE SET NULL`) to
  both tables; `pnpm db:migrate` applies clean against the existing dev DB
  (including any pre-existing `agent_documents`/`skill_documents` rows, which
  must survive with `repo_id = NULL`); `node_modules/.bin/tsc --noEmit` passes.

### Phase 2 — Server enforcement + run-time exclusion

#### T3 — Anchor storage + attach-time enforcement (agents + skills)
- **Action:** In `server/src/modules/agents/repository.ts`: `linkedDocuments`
  selects `repoId` alongside `path`/`order`; `setDocuments(agentId, paths,
  repoId: string | null)` — INSIDE the existing transaction, after
  `pg_advisory_xact_lock(hashtext(agentId))` is acquired: if `paths.length > 0`,
  re-read the current rows' `repo_id`; if any existing row has a non-null
  `repo_id` different from the incoming `repoId`, throw `ConflictError('Attached
  documents are anchored to a different repository — clear existing attachments
  before attaching from a new repository', { existing_repo_id, requested_repo_id
  })` (aborts the transaction, no partial write). Otherwise delete-all + insert
  with `repoId` stamped on every row (this is what naturally re-anchors/self-heals
  legacy `NULL` rows — Q2). If `paths.length === 0`, delete-all unconditionally
  (clearing never requires/uses `repoId`). Mirror identically in
  `server/src/modules/skills/repository.ts`. Thread `repoId` through
  `AgentsService.setDocuments`/`SkillsService.setDocuments` (service layer stays a
  passthrough — the check lives in the repository per Q4). Update
  `SetDocumentsBody` in both `routes.ts` to `z.object({ paths:
  z.array(RepoRelativePath), repo_id: z.string().uuid().optional() }).refine((b)
  => b.paths.length === 0 || b.repo_id !== undefined, { message: 'repo_id is
  required when attaching documents' })`.
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `fastify-best-practices`,
  `backend-onion-architecture`, `zod`
- **Owned paths:** `server/src/modules/agents/repository.ts`,
  `server/src/modules/agents/service.ts`, `server/src/modules/agents/routes.ts`,
  `server/src/modules/skills/repository.ts`,
  `server/src/modules/skills/service.ts`, `server/src/modules/skills/routes.ts`
- **Depends-on:** T1, T2
- **Risk:** high
- **Known gotchas:** The anchor check MUST run after the advisory lock is
  acquired and inside the same transaction as the delete+insert, or two
  concurrent `setDocuments` calls (Checkbox double-fire precedent, server/
  INSIGHTS) can both read a stale anchor and race past the check (Q4) — verify
  with a genuinely concurrent `Promise.all` burst mixing a legitimate same-repo
  write with a cross-repo write, not sequential awaits. A `ConflictError` thrown
  mid-transaction must still leave existing rows untouched (transaction rolls
  back) — assert the pre-conflict state is unchanged, not just that the call
  rejected. `/skills/*` routes resolve the DEFAULT workspace via `getContext` (no
  ws param) — route-level it-tests only see seeded-default-workspace skills
  (server/INSIGHTS).
- **Acceptance:** `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run
  test/agent-documents.it.test.ts test/skill-documents.it.test.ts` (extend the
  existing files) — new cases assert: (1) first attach with `repo_id=A` stamps
  `A` on all rows and `GET` returns it; (2) a second attach attempt with
  `repo_id=B` while rows still anchored to `A` returns 409 and leaves the `A`-anchored
  rows unchanged; (3) clearing (`paths: []`) succeeds unconditionally and drops
  the anchor; (4) attaching with `repo_id=B` after a clear succeeds and re-anchors
  to `B`; (5) a row seeded with `repo_id=NULL` (simulating a legacy row) accepts
  an attach with any `repo_id` and re-anchors without a 409; (6) a concurrent
  `Promise.all` burst (one same-repo call, one cross-repo call) produces exactly
  one success and one 409, never a deadlock/duplicate-key, and the final DB state
  matches whichever call is deterministically last per the lock ordering.

#### T4 — Run-time wholesale exclusion (effective-documents + run-executor)
- **Action:** In `server/src/modules/reviews/effective-documents.ts`: change
  `computeEffectiveDocuments(agentDocs, enabledSkillDocs, pullRepoId: string)` to
  return `{ documents: EffectiveDocument[]; excludedByRepoMismatch:
  DocumentsRepoExclusion[] }`. Internally: if `agentDocs.length > 0` and
  `agentDocs[0].repoId != null && agentDocs[0].repoId !== pullRepoId`, exclude
  ALL agent docs from `documents` and push `{ origin: { type: 'agent' }, paths:
  agentDocs.map(d => d.path) }` onto `excludedByRepoMismatch` — otherwise include
  them as today (AC-17/18/19 unchanged). Apply the identical per-skill check
  before folding each enabled skill's docs into the union (a `NULL` anchor is
  never excluded — Q2). In `run-executor.ts` `runOneAgent`: pass `repo.id` (the
  PR's own repo — already a parameter) as the third argument; before the existing
  per-path read loop, if `excludedByRepoMismatch.length`, emit one
  `runLog.info('⚠️ Excluding N project-context document(s) — attached documents
  are anchored to a different repository than this PR')` per exclusion entry
  (never `.error` — mirrors the AC-24 precedent, a mismatch is never a hard
  failure); set `trace.documents_repo_excluded = excludedByRepoMismatch`. Set the
  same field to `[]` in `traceFromBuffer` so failure/cancel traces still parse.
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`, `security`
- **Owned paths:** `server/src/modules/reviews/effective-documents.ts`,
  `server/src/modules/reviews/run-executor.ts`
- **Depends-on:** T1, T3
- **Risk:** high
- **Known gotchas:** This check must run BEFORE the existing per-path
  `readContent`/`documents_unavailable` loop (R4/AC-31 — never resolve a
  mismatched-repo path against the wrong clone, not even to discover it's
  "unavailable"). A path that happens to exist at the same relative location in
  BOTH repos must never be silently read from the wrong one — the exclusion is
  by ORIGIN (whole agent-level or whole skill-level set), never by re-checking
  individual paths. Keep the `NULL`-anchor pass-through (Q2) so legacy/never-yet-
  re-saved attachments keep behaving exactly as before this change (non-
  regression). Do not touch the AC-17/18/19 dedup/order logic for docs that pass
  the repo check.
- **Acceptance:** (1) `cd server && node_modules/.bin/vitest run
  test/effective-documents.test.ts` (extend) — new cases: agent docs anchored to
  repo A are entirely excluded (with the right `excludedByRepoMismatch` entry)
  when `pullRepoId = B`; a skill's docs are excluded independently of the
  agent's (one mismatched, one matching, both present in the same run); a
  `NULL`-anchored set is never excluded; disabled skills still contribute
  nothing (existing AC-17 behavior unchanged). (2) `TESTCONTAINERS_RYUK_DISABLED=
  true node_modules/.bin/vitest run test/run-executor-documents.it.test.ts`
  (extend) with a `MockLLMProvider` — an agent whose attached docs are anchored
  to a different repo than the reviewed PR produces a run that (a) completes
  successfully (never fails), (b) has an EMPTY `## Project context` block for
  those docs (or omits the block entirely if nothing else contributed), (c)
  `trace.documents_repo_excluded` lists the exclusion with the full path set,
  and (d) `trace.documents_unavailable` does NOT also list those paths (they
  were never individually resolved).

### Phase 3 — Client: shared attach logic

#### T5 — Client data hooks: thread `repo_id` through the attach mutations
- **Action:** In `client/src/lib/hooks/documents.ts`: `useSetAgentDocuments`/
  `useSetSkillDocuments` mutation functions change from `(paths: string[])` to
  `({ paths, repoId }: { paths: string[]; repoId?: string })`, POSTing `{ paths,
  repo_id: repoId }` (omit `repo_id` from the body when clearing — `paths: []`
  needs no repo). Types (`AgentDocumentLink`/`SkillDocumentLink`) already carry
  `repo_id` after T1's re-vendor; no new type needed here.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `client-server-communication`
- **Owned paths:** `client/src/lib/hooks/documents.ts`
- **Depends-on:** T1
- **Risk:** low
- **Known gotchas:** Every existing CALLER of these two mutations (today's
  `ContextTab.tsx` and `DocumentsSection.tsx`) breaks its call signature — this
  task alone will not typecheck the client until T6/T7/T8 land; land T5+T6
  together if running single-agent, or accept a transient red build if
  multi-agent (the DAG below sequences T6 immediately after).
- **Acceptance:** `cd client && node_modules/.bin/tsc --noEmit` (expected to fail
  only on the two NOT-YET-migrated call sites, which T7/T8 fix — confirm the
  failures are exactly those two files and nothing else); a hook unit test
  asserts `useSetAgentDocuments` POSTs `{ paths, repo_id }` when attaching and
  `{ paths: [] }` (no `repo_id` key) when clearing.

#### T6 — Shared `useDocumentAttachment` hook (attach/detach/reorder/preview/repo-mismatch confirm)
- **Action:** Create `client/src/lib/hooks/use-document-attachment.ts`. Extract
  the logic (not JSX) currently duplicated in `ContextTab.tsx` and
  `DocumentsSection.tsx`: repo-catalog/link hydration (`initialOrder`), `order`/
  `attached` state, the `toggling` double-fire guard, `toggle`/`onDrop`/
  `togglePreview`, `attachedTokens`. ADD the new repo-mismatch confirm state
  machine: track `anchorRepoId` (derived from `links?.[0]?.repo_id ?? null`); on
  `toggle(path, true)` when `repoId !== anchorRepoId && anchorRepoId != null`,
  instead of attaching immediately, set `pendingAttach = path` (surfaces a
  confirm-modal request to the caller) rather than calling `persist`; expose
  `confirmClear()` (calls `setDocuments.mutate({ paths: [] })`, then on success
  attaches `pendingAttach` via `setDocuments.mutate({ paths: [pendingAttach],
  repoId })`, then clears `pendingAttach`) and `cancelClear()` (clears
  `pendingAttach`, checkbox stays unchecked). Detach and reorder are never gated
  (only NEW attachments from a different repo need confirmation — AC-30). Return
  everything the two call sites need: `{ order, attached, toggle, onDrop,
  previewPath, togglePreview, preview, attachedTokens, pendingAttach,
  confirmClear, cancelClear, anchorRepoId }`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`
- **Owned paths:** `client/src/lib/hooks/use-document-attachment.ts`
- **Depends-on:** T5
- **Risk:** medium
- **Known gotchas:** Reuse the EXACT `toggling` ref-guard pattern from the
  existing components (client/INSIGHTS: the vendored `Checkbox` double-fires
  `onChange`) — do not regress that fix while extracting. `persist` must always
  send the FULL current ordered path list on reorder/detach (wholesale replace,
  unchanged contract) but only `paths.length===1` on the confirm-then-attach
  step (T6's own new call is deliberately narrow: after a clear, only the ONE
  pending doc is what the user asked for — not a merge with the old, now-cleared
  set). `repoId` passed into the hook is the CURRENTLY BROWSED repo (from the
  picker), independent of `anchorRepoId` — never conflate the two.
- **Acceptance:** `cd client && node_modules/.bin/vitest run
  src/lib/hooks/use-document-attachment.test.ts` (new, hook test via
  `@testing-library/react`'s `renderHook` + a `QueryClientProvider` wrapper) —
  asserts: attaching when `anchorRepoId` is null or matches `repoId` calls
  `setDocuments.mutate` directly (no `pendingAttach`); attaching a path from a
  different repo while `attached.size > 0` sets `pendingAttach` and does NOT
  call `setDocuments.mutate` yet; `confirmClear()` calls it twice in sequence
  (clear, then the single pending path with the new `repoId`); `cancelClear()`
  clears `pendingAttach` without any mutation call; detach/reorder always call
  `setDocuments.mutate` immediately regardless of `anchorRepoId`.

### Phase 4 — Client: apply to both editors

#### T7 — Agent editor `ContextTab`: adopt the shared hook + confirm-clear UI
- **Action:** Rewrite `client/src/app/agents/[id]/_components/AgentEditor/
  _components/ContextTab/ContextTab.tsx` to call `useDocumentAttachment` (T6)
  instead of its inline duplicate logic; render a `Modal` (mirror the existing
  delete-confirmation `Modal` usage in `skills/[id]/.../ConfigTab.tsx`) when
  `pendingAttach` is set, with copy naming the anchor repo (look up its
  `full_name` from the already-fetched `repos` list) and the count of documents
  that will be cleared; wire its footer buttons to `confirmClear`/`cancelClear`.
  Add strings under `agents.json` (`context.repoMismatch.*`).
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:**
  `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx`,
  `client/messages/en/agents.json`
- **Depends-on:** T6
- **Risk:** medium
- **Known gotchas:** Add the `agents` namespace's new keys to the test's provider
  `messages` or it silently logs `MISSING_MESSAGE` (client/INSIGHTS). The
  existing double-fire-guard regression test (clicking an attach checkbox twice
  back-to-back calls the mutation once) must still pass unchanged post-refactor —
  it's now testing the SHARED hook via this component, not duplicate local logic.
- **Acceptance:** `cd client && node_modules/.bin/vitest run
  "src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx"`
  (use the literal path, not a `**` glob — client/INSIGHTS bracket-folder glob
  gotcha) — existing cases still pass (double-fire guard, token volume,
  drag-reorder) PLUS new cases: switching the repo picker then attaching a doc
  from the new repo while existing attachments exist opens the confirm modal
  with the correct old-repo name and count; confirming clears then attaches (one
  `setDocuments` POST with `paths:[]`, then one with the single new path +
  `repo_id`); cancelling leaves the checkbox unchecked and issues no mutation.

#### T8 — Skill editor: promote to a real "Context" tab (Gap 1) using the shared hook
- **Action:** Add `{ key: "context", labelKey: "tabs.context", icon: "FileText"
  }` to `TABS` in `client/src/app/skills/[id]/_components/SkillEditor/
  constants.ts` (mirrors `agents.json`'s `editor.tabs.context` icon choice).
  Create `client/src/app/skills/[id]/_components/SkillEditor/_components/
  ContextTab/{ContextTab.tsx,index.ts,styles.ts}` — same shape as T7's
  `ContextTab`, parameterized for skills (`useSkillDocuments`/
  `useSetSkillDocuments`), built on the SAME `useDocumentAttachment` hook (T6).
  Render it in `SkillEditor.tsx` as a sibling of `config`/`preview`/`stats`/
  `versions` (`{tab === "context" && <ContextTab skillId={skill.id} />}`).
  Remove the `<DocumentsSection skillId={skill.id} />` line and its import from
  `ConfigTab.tsx`. Delete the now-superseded
  `ConfigTab/_components/DocumentsSection/` directory (its logic lives in T6's
  hook + the new `ContextTab`; nothing else references it — grep to confirm).
  Move any `skills.json` `documents.*` strings that are still needed to a
  `tabs.context.*` / `context.*` namespace matching the new tab (or keep the
  `documents.*` keys if simpler — either is fine as long as `ConfigTab.test.tsx`
  and the new `ContextTab.test.tsx` stay in sync).
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`,
  `next-best-practices`
- **Owned paths:**
  `client/src/app/skills/[id]/_components/SkillEditor/constants.ts`,
  `client/src/app/skills/[id]/_components/SkillEditor/SkillEditor.tsx`,
  `client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/`,
  `client/src/app/skills/[id]/_components/SkillEditor/_components/ConfigTab/ConfigTab.tsx`,
  `client/src/app/skills/[id]/_components/SkillEditor/_components/ConfigTab/ConfigTab.test.tsx`
  (delete `_components/DocumentsSection/` and its test coverage moves to the new
  `ContextTab.test.tsx`), `client/messages/en/skills.json`
- **Depends-on:** T6
- **Risk:** medium
- **Known gotchas:** `create` mode (`ConfigTab` with no persisted `skill` yet)
  never rendered `DocumentsSection` (`{!isCreate && skill && <DocumentsSection
  ... />}`) — the new `context` tab must be similarly unreachable/disabled until
  the skill exists (mirror however `stats`/`versions` already handle create
  mode, if they do; if the Skill editor doesn't gate tabs by create-mode today,
  match that same lack-of-gating rather than inventing new behavior). Grep the
  whole client tree for `DocumentsSection` before deleting it — confirm zero
  remaining references (including barrel `index.ts` re-exports) so the delete
  doesn't leave a dangling import. `documents` attach/detach must still bypass
  the body-only PATCH/`isDirty` gate entirely (client/INSIGHTS: attaching a
  document must never bump `skills.version`) — this is unchanged by the move,
  just re-verify it via the acceptance test below since the mutation now lives
  in a sibling tab, not inside the Config form.
- **Acceptance:** `cd client && node_modules/.bin/vitest run
  "src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.test.tsx"`
  (new; literal path, not a glob) — mirrors T7's acceptance (attach/detach/
  reorder/preview/token-volume/repo-mismatch-confirm) for skills. `cd client &&
  node_modules/.bin/vitest run
  "src/app/skills/[id]/_components/SkillEditor/_components/ConfigTab/ConfigTab.test.tsx"`
  — updated to assert `ConfigTab` no longer renders any document row/attach UI
  and saving the Config form still issues only the body-only PATCH (no documents
  mutation). `grep -r DocumentsSection client/src` returns no matches.
  `node_modules/.bin/tsc --noEmit` passes; `/skills/:id?tab=context` renders the
  new tab.

### Phase 5 — Run-trace visibility

#### T9 — Run-trace UI: render the repo-mismatch exclusion distinctly from AC-24
- **Action:** In `TraceBody.tsx`, add a rendering block for
  `trace.documents_repo_excluded` (populated by T4), visually and textually
  DISTINCT from the existing `documents_unavailable` block (different icon/copy —
  e.g. "Excluded — different repository" vs "Attached but unavailable"), showing
  each exclusion's origin (agent vs the specific skill, reusing the existing
  origin-chip pattern already built for `documents_read`) and its excluded path
  count. Guard for legacy/empty traces (defaults to `[]`). Add strings under
  `runs.json`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:**
  `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/styles.ts`,
  `client/messages/en/runs.json`
- **Depends-on:** T1 (contract), T4 (server populates the field — this task can
  be developed against a hand-built fixture in parallel, but its acceptance test
  needs the field to exist in the type)
- **Risk:** low
- **Known gotchas:** Must be visually distinguishable from the AC-24
  `documents_unavailable` block per spec wording ("distinctly from... AC-24") —
  a shared component with only a color swap is acceptable, an unlabeled merge
  into the same list is not. Add the `runs` namespace's new keys to affected
  tests' provider `messages` (client/INSIGHTS MISSING_MESSAGE).
- **Acceptance:** `cd client && node_modules/.bin/vitest run
  "src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/**/*.test.tsx"`
  (literal-path or bare `vitest run` per client/INSIGHTS glob gotcha) — a trace
  fixture with both a non-empty `documents_unavailable` and a non-empty
  `documents_repo_excluded` renders TWO visually/textually distinct blocks
  (assert on distinguishing text/labels, not just presence); an empty/legacy
  trace (missing the key entirely, relying on the Zod default) renders without
  error.

## Testing strategy
- **server unit (hermetic):** extend `effective-documents.test.ts` for the
  wholesale-exclusion logic (T4). Run via `node_modules/.bin/vitest run`.
- **server integration (`.it.test.ts`, testcontainers):** extend
  `agent-documents.it.test.ts`, `skill-documents.it.test.ts` (T3 — anchor
  enforcement + concurrency), `run-executor-documents.it.test.ts` (T4 — the
  end-to-end mismatch-exclusion proof). Run with
  `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run
  test/<x>.it.test.ts`. A `.it.test.ts` is mandatory for T3/T4 because the
  transaction-scoped advisory-lock + concurrency proof and the real Drizzle FK
  behavior are not exercised by hermetic tests (server/INSIGHTS).
- **client (RTL):** new `use-document-attachment.test.ts` (T6, the single source
  of truth for the confirm-clear state machine — test it once here, not
  separately in both tab components); extend `ContextTab.test.tsx` (agent, T7)
  and the new skill `ContextTab.test.tsx` (T8); update `ConfigTab.test.tsx`
  (skill, T8) to assert the section is gone. Use `fireEvent` (no user-event in
  this package); wrap Query-using tests in `QueryClientProvider`; include every
  used i18n namespace in test `messages`.
- **client typecheck/build:** `node_modules/.bin/tsc --noEmit`; note T5 alone
  will not typecheck clean until T7/T8 land (see T5 Known gotchas) — sequence
  accordingly if running single-agent.
- **No new manual/model-dependent demonstration is needed** — both gaps are
  fully deterministic (UI wiring + DB-enforced invariant + pure exclusion logic),
  unlike the original plan's R7 scenario.

## Risks & mitigations
- **TOCTOU on the attach-time anchor check (T3)** → check runs inside the same
  transaction as the existing advisory lock, not before it; verified by a
  genuinely concurrent `Promise.all` burst mixing a same-repo and a cross-repo
  write.
- **Wrong-repo path silently resolved (the exact risk AC-31 targets, T4)** → the
  exclusion check runs BEFORE the per-path read loop and excludes by ORIGIN
  (whole set), never re-checking individual paths against the mismatched repo —
  explicit it-test asserts an excluded path never reaches
  `documents_unavailable` (i.e., it was never individually attempted).
- **Legacy attachment rows with no recoverable repo history (T2/T3)** → `repo_id`
  is nullable; `NULL` is treated as "unanchored" everywhere (attach-time: no
  gate; run-time: no exclusion) and self-heals on the next wholesale write — no
  lossy/guessed backfill.
- **Behavior drift between agent and skill invariant handling (AC-32, T6/T7/T8)**
  → single shared `useDocumentAttachment` hook and a single
  `effective-documents.ts` code path (applied identically per-origin) instead of
  two parallel implementations.
- **Shared-contract drift across 3 vendor copies (T1)** → single owning task;
  additive-only (`.nullable()`/`.default([])`); grep all three copies in
  acceptance.
- **Deleting `DocumentsSection` breaks a hidden reference (T8)** → explicit grep
  step in the task's Known gotchas and Acceptance before/after the delete.

## Red-flags check
- [x] Every requirement (R1–R6) maps to at least one task (R1→T8; R2→T1/T2/T3;
  R3→T6/T7/T8; R4→T4/T9; R5→T3/T4/T6/T7/T8; R6→ Q2/Q3 design + T1 additive
  contracts)
- [x] No specification was authored or edited — SPEC-01 (current version) taken
  as input, read in full before planning
- [x] Execution mode recorded (multi-agent) and the plan is shaped for it, with
  the one deliberate serialization (T6 before T7/T8) called out
- [x] Dependencies form a DAG (no cycles): T1→T2→T3→T4; T1→T5→T6→{T7,T8}; T1→T9
- [x] (multi-agent) Concurrent tasks have non-overlapping Owned paths (T7 and T8
  touch disjoint agent-editor vs skill-editor trees; T4 and T9 touch disjoint
  server vs client trees)
- [x] Every Acceptance is measurable (named test files + commands + observable
  assertions)
- [x] The two shared-contract changes (T1: `repo_id`, `documents_repo_excluded`)
  are additive; no existing field is retyped or removed
- [x] `*/src/vendor/**` is only touched in T1 (the sanctioned per-package
  re-vendor of the shared contract); no vendored UI primitive is touched by this
  plan
- [x] No DB table deletions or edits to existing migrations — only a new
  `0014_*` migration adding two nullable columns to existing tables
- [x] The product owner's recommended technical direction (positive `repo_id`
  storage, not path-inference) is followed exactly (T2/T3)
- [x] Both gaps' root causes were verified against the ACTUAL current code
  (constants.ts tab lists, DocumentsSection embedding, missing repo_id on
  contracts, missing mismatch check in run-executor) before this plan was
  written — not assumed from the gap description alone
