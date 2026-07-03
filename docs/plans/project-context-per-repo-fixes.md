# Implementation Plan: Project Context — three fixes (CSS bug, attach-picker parity, per-repository attachment model)

## Overview
Three fixes to the already-shipped Project Context feature (SPEC-01, approved). **Fix 1** is a pure
CSS/rendering bug in the standalone Project Context screen (no acceptance criterion). **Fix 2** adds a
scoped filter input and an attached/shown count to the shared Agent/Skill Context-tab document picker
(AC-36, AC-37). **Fix 3** replaces the single-repo "anchor + confirm-clear" attachment model with an
independent ordered attachment list **per repository** for each agent and skill, bound to the globally
active repo (AC-13, AC-17, AC-29–AC-32, AC-38).

## Execution mode
multi-agent (parallel) — the coordinator confirmed multi-agent. Fix 1 and the entire Fix 3 **server**
chain run fully concurrently with the Fix 3 **client** chain. One honest refinement of "all three in
parallel": Fix 2 and Fix 3's client work edit the **same** `DocumentAttachmentPicker.tsx` and the same
two message files, so the owned-paths rule forbids running them concurrently — Fix 2 (T11) is sequenced
**after** the Fix 3 client picker rewrite (T10) as an additive layer on the final structure. Everything
else parallelises per the DAG below.

## Requirements (verified)
Verbatim AC text lives in `specs/SPEC-01-2026-07-01-project-context.md`. Each requirement below was
confirmed against current code at the cited file:line.

- **R1 (Fix 1 — NO AC maps to this; pure bug fix):** `ContextWorkspace/styles.ts` `docRow` sets the
  `border` shorthand (line 60) while `docRowActive` overrides only `borderColor` (line 68);
  `ContextWorkspace.tsx` merges them via `{...s.docRow, ...(selected ? s.docRowActive : {})}`
  (lines 109–112), so a selected row carries both `border` (React-expanded to per-side longhands) and
  `borderColor` → the "Removing a style property during rerender (borderColor) when a conflicting
  property is set (border)" warning + inverted border. Matches the known trap in `client/INSIGHTS.md`
  (lines 71–72). Confirmed the shared `DocumentAttachmentPicker/styles.ts` is **not** affected — its
  `row(attached)` (line 17) uses a single `border` shorthand per state, no shorthand/longhand mix.
- **R2 (Fix 2 → AC-36, AC-37):** The shared `DocumentAttachmentPicker.tsx` has no per-picker path
  filter and no attached/shown count. Reference pattern to mirror: `SkillsTab.tsx` (filter input lines
  105–111, `skills.enabledCount` badge lines 102–104). Keep the existing AC-15 token badge (line 72).
- **R3 (Fix 3 → AC-13, AC-17, AC-29, AC-30, AC-31, AC-32, AC-38):** Today the model is single-repo
  "anchor + confirm-clear". Verified:
  - DB PK is `(agent_id, path)` / `(skill_id, path)` — `server/src/db/schema/documents.ts` — so a path
    can be attached to one owner **only once total**; independent per-repo lists (AC-29) are impossible
    without a PK change. `repo_id` exists but is **nullable** and **not** in the key (added by
    migration `0014`; table created by `0013`). Highest migration = `0014_legal_azazel.sql`.
  - GET `/agents|skills/:id/documents` returns **all** links regardless of repo (routes lines 188 / 162).
  - POST replace deletes **all** owner rows (`DELETE WHERE agent_id = ?`, `repository.ts` ~line 326) and
    enforces the anchor via a check-then-write conflict (`SetDocumentsResult` union → `ConflictError`).
  - Run-time `computeEffectiveDocuments(agentDocs, enabledSkillDocs, pullRepoId)`
    (`server/src/modules/reviews/effective-documents.ts`) excludes an entire owner set on repo mismatch
    (`excludedByRepoMismatch`); `run-executor.ts` fetches **unscoped** `linkedDocuments(id)` (lines
    309–316) and records exclusions to the trace (line 509).
  - Client: both `ContextTab.tsx` wrappers derive their own `repoId` via `useState` +
    `repos.find(r => r.clone_path)?.id ?? repos[0].id` (agent lines 34–42; skill lines 35–43) and do
    **not** consume `useActiveRepo()`. `use-document-attachment.ts` holds the anchor/confirm-clear state
    machine (`anchorRepoId`, `pendingAttach`, `confirmClear`, `cancelClear`). The picker renders a repo
    `SelectInput` dropdown (lines 82–90) and the repo-mismatch `Modal` (lines 164–184).

Confirmed defaults (coordinator approved):
- **assumed default — user confirmed (Q1):** Migration `0015` changes each PK to `(owner_id, repo_id, path)`,
  makes `repo_id` `NOT NULL`, and **deletes** pre-existing `repo_id IS NULL` rows first (local dev DB,
  no prod data).
- **assumed default — user confirmed (Q2):** Keep the vendored `AgentDocumentLink`/`SkillDocumentLink`
  `repo_id` as `.nullable()` in the shared contract — **no** edit to the 3 vendored copies' shape;
  scope per-repo via server **route** params only.
- **assumed default — user confirmed (Q3):** Scope on the server — required `?repo_id=` on GET,
  always-required `repo_id` on POST (including clear), replace-set delete scoped by `(owner_id, repo_id)`,
  run-executor fetches links scoped to the PR's `repo.id`; `effective-documents.ts` loses its
  mismatch-exclusion branch entirely.
- **assumed default — user confirmed (Q4):** AC-38 renders when `activeRepo == null`; switching which
  repo's list is edited happens via the global nav repo switcher only.
- **assumed default — user confirmed (Q5):** `DocumentAttachmentPicker` stays presentational — the two
  `ContextTab` wrappers call `useActiveRepo()` and pass `repoId`/`repoName` down.

## Open questions & recommendations
- Q1 → answered: default accepted (migration 0015 with PK change, NOT NULL, delete NULL rows).
- Q2 → answered: default accepted (keep contract `repo_id` nullable; no vendor-shape edit).
- Q3 → answered: default accepted (server-side scoping via route params).
- Q4 → answered: default accepted (AC-38 on `activeRepo == null`; global switcher only).
- Q5 → answered: default accepted (picker stays presentational).
- Rec A → accepted: **delete** the dead `excludedByRepoMismatch` branch in `effective-documents.ts`
  once links are fetched pre-scoped; `run-executor.ts` writes `documents_repo_excluded: []` so the
  (untouched) `RunTrace` contract field simply stays empty.
- Rec B → accepted: separate new i18n keys `context.filterPlaceholder`, `context.attachedCount`,
  `context.filterShown` in both `agents.json` and `skills.json` (distinct from the AC-15 token badge).
- Rec C → accepted: the listed test files are **test-writer follow-up tasks** (T12, T13) with stated
  acceptance — not written by the planner or the implementers of T1–T11.

## Affected modules & contracts
- **client** — Fix 1 (`ContextWorkspace/styles.ts`); Fix 2 + Fix 3 client (`DocumentAttachmentPicker`,
  both `ContextTab.tsx` wrappers, `use-document-attachment.ts`, `lib/hooks/documents.ts`, two message
  files).
- **server** — Fix 3 (schema + migration `0015`, agents/skills `repository.ts`/`service.ts`/`routes.ts`,
  `reviews/effective-documents.ts`, `reviews/run-executor.ts`).
- **Contracts:** none new. **No shared-contract shape change** — `AgentDocumentLink`/`SkillDocumentLink`
  `repo_id` stays `.nullable()`; `DocumentsRepoExclusion` and the `RunTrace.documents_repo_excluded`
  field stay in the contract but are never populated after this change. The 3 vendored copies under
  `*/src/vendor/shared/**` are **not** touched.

## Architecture changes
No new modules or layers. Onion layering is preserved: DB schema (`db/schema/documents.ts`) →
Infrastructure repository (`modules/*/repository.ts`) → Application service (`modules/*/service.ts`) →
Presentation route (`modules/*/routes.ts`); the run-time assembly stays split between the pure
`reviews/effective-documents.ts` (no I/O) and its I/O caller `reviews/run-executor.ts`. On the client,
data access stays in `lib/hooks/*`; `DocumentAttachmentPicker` stays purely presentational; the
`ContextTab` wrappers become the only new consumers of `useActiveRepo()`.

## Phased tasks

### Phase 1 — Foundation & isolated fixes (T1, T2, T6, T8 run concurrently)

#### T1 — Fix 1: consolidate the doc-row border to longhands (pure bug fix, NO AC)
- **Action:** In `ContextWorkspace/styles.ts`, replace `docRow`'s `border: "1px solid transparent"`
  shorthand (line 60) with longhands `borderWidth: 1, borderStyle: "solid", borderColor: "transparent"`,
  and keep `docRowActive` overriding only `borderColor: "var(--border-strong)"`. Result: across the
  selected/unselected toggle only the `borderColor` **longhand** ever changes — no shorthand/longhand
  collision. Do **not** modify `ContextWorkspace.tsx` (its spread-merge is correct once the base style
  uses longhands). Do **not** touch `DocumentAttachmentPicker/styles.ts` (unaffected — verified).
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/app/repos/[repoId]/context/_components/ContextWorkspace/styles.ts`
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** `client/INSIGHTS.md` lines 71–72 — never pair the `border` shorthand with a
  per-render `borderColor` override; if any side color is set, set only longhands. `borderColor` alone
  (all four sides) toggling between two states is fine and does **not** trip the warning.
- **Acceptance:** toggling a row's selection produces **no** React console warning about `borderColor`/
  `border`; the selected row shows a visible `--border-strong` border and unselected shows a transparent
  one. `cd client && pnpm exec vitest run "src/app/repos/[repoId]/context/_components/ContextWorkspace/ContextWorkspace.test.tsx"` still passes; `pnpm typecheck` passes.

#### T2 — Fix 3: migration 0015 + schema (per-repo PK, repo_id NOT NULL)
- **Action:** In `server/src/db/schema/documents.ts`: make `repoId` `.notNull()` on both tables and add
  `repoId` to each `primaryKey({ columns: [...] })` → `(agentId, repoId, path)` and
  `(skillId, repoId, path)`. Keep the existing `repoIdx` index and `onDelete: 'set null'` FK reference
  (harmless once NOT NULL — a repo delete still cascades agents/skills separately). Run
  `cd server && pnpm db:generate` to emit `0015_*.sql`. In the **newly generated** migration (permitted —
  it is not an existing migration), hand-prepend, **before** the `SET NOT NULL` / PK statements:
  `DELETE FROM "agent_documents" WHERE "repo_id" IS NULL;` and
  `DELETE FROM "skill_documents" WHERE "repo_id" IS NULL;`. Verify the generated SQL drops the old PK and
  adds the new composite PK on both tables. Apply with `pnpm db:migrate`.
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `postgresql-table-design`
- **Owned paths:** `server/src/db/schema/documents.ts`,
  `server/src/db/migrations/0015_*.sql` (+ drizzle-generated `meta/_journal.json` and
  `meta/0015_snapshot.json`)
- **Depends-on:** none
- **Known gotchas:** append-only — never edit `0013`/`0014` (`server/CLAUDE.md` "Do not touch"). Migrations
  are **not** applied on boot; run `pnpm db:migrate` explicitly. Drizzle-kit will generate the PK/NOT NULL
  ALTERs but will **not** author the `DELETE ... WHERE repo_id IS NULL` — that must be hand-added ahead of
  the `SET NOT NULL`, or the migration fails on any legacy NULL row.
- **Acceptance:** `cd server && pnpm db:migrate` applies cleanly against a seeded DB; `pnpm typecheck`
  passes with the new schema types; a psql/`\d agent_documents` check shows PK `(agent_id, repo_id, path)`
  and `repo_id` `not null` (same for `skill_documents`).

#### T6 — Fix 3: simplify pure effective-set logic (remove repo-mismatch exclusion)
- **Action:** In `server/src/modules/reviews/effective-documents.ts`, drop the `pullRepoId` parameter
  and the two `*Mismatch` branches; `computeEffectiveDocuments(agentDocs, enabledSkillDocs)` returns only
  the deduped, ordered `documents` (AC-17/18/19 union+dedup+order logic unchanged). Remove
  `excludedByRepoMismatch` from `EffectiveDocumentsResult` and the `DocumentsRepoExclusion` import.
  Callers now pass links already scoped to the PR's repo (T7), so no run-time mismatch can exist (AC-31
  holds by construction).
- **Module:** server
- **Type:** core
- **Skills to use:** `typescript-expert`, `backend-onion-architecture`
- **Owned paths:** `server/src/modules/reviews/effective-documents.ts`
- **Depends-on:** none (pure function; consumed by T7)
- **Known gotchas:** keep AC-18 dedup (agent-level position wins) and AC-19 ordering exactly as-is —
  only the mismatch pre-check is removed.
- **Acceptance:** file compiles under `cd server && pnpm typecheck`; `computeEffectiveDocuments` no longer
  references `pullRepoId`/`excludedByRepoMismatch`; existing union/dedup/order behavior is preserved (a
  path at both agent and skill level appears once, at its agent-level position).

#### T8 — Fix 3: repo-scope the client document hooks
- **Action:** In `client/src/lib/hooks/documents.ts`: (a) `useAgentDocuments(agentId, repoId)` and
  `useSkillDocuments(skillId, repoId)` gain a `repoId` arg, add it to the query key
  (`["agent-documents", agentId, repoId]` / `["skill-documents", skillId, repoId]`), pass it as
  `?repo_id=${repoId}` on the GET, and set `enabled: !!id && !!repoId`. (b) `useSetAgentDocuments`/
  `useSetSkillDocuments` mutation variables become `{ paths, repoId }` with `repoId` **always** sent as
  `repo_id` in the body (drop the conditional spread); update the `onSuccess` `setQueryData` to write the
  repo-scoped key.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `client-server-communication`, `next-best-practices`
- **Owned paths:** `client/src/lib/hooks/documents.ts`
- **Depends-on:** none (written against the agreed server contract; server chain verifies end-to-end)
- **Known gotchas:** the repo-scoped query key means switching the active repo refetches the correct
  list; ensure `onSuccess` writes back to the **same** repo-scoped key it read from, or the cache and the
  UI drift.
- **Acceptance:** `cd client && pnpm typecheck` passes; the GET requests include `?repo_id=`, the POST
  body always includes `repo_id`, and query keys include the repoId. (Behavioural assertions land in T13.)

### Phase 2 — Server infra & client hook (T3 after T2; T9 after T8)

#### T3 — Fix 3: repo-scope the repositories (agents + skills)
- **Action:** In `server/src/modules/agents/repository.ts` and `server/src/modules/skills/repository.ts`:
  (a) `linkedDocuments(id, repoId)` filters by `and(eq(ownerId, id), eq(repoId, repoId))`, ordered by
  `order`. (b) `setDocuments(id, paths, repoId)` — `repoId` is now a required non-null `string`; scope the
  in-transaction delete to `and(eq(ownerId, id), eq(repoId, repoId))` (only that repo's list is replaced),
  then insert `{ ownerId, path, order: i, repoId }`. (c) Remove the anchor conflict check and the
  `SetDocumentsResult` discriminated-union return type — `setDocuments` returns the fresh scoped links (or
  void); keep the serialize-via-advisory-lock pattern used by `setSkills` (avoids the concurrent
  delete+insert PK race).
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `backend-onion-architecture`
- **Owned paths:** `server/src/modules/agents/repository.ts`, `server/src/modules/skills/repository.ts`
- **Depends-on:** T2
- **Known gotchas:** keep the advisory-lock/serialization the existing `setDocuments`/`setSkills` use — a
  plain delete+insert under concurrency trips the (now composite) PK. The scoped delete is the crux of
  AC-30: clearing/replacing repo A's list must not touch repo B's rows.
- **Acceptance:** `cd server && pnpm typecheck` passes; `linkedDocuments` and `setDocuments` are scoped by
  `(ownerId, repoId)` on both tables; the `SetDocumentsResult` union and anchor check are gone.

#### T9 — Fix 3: strip anchor/confirm-clear from the attachment hook
- **Action:** In `client/src/lib/hooks/use-document-attachment.ts`: remove `anchorRepoId`, `pendingAttach`,
  `confirmClear`, `cancelClear`, and the anchor-mismatch gate in `toggle`. `repoId` is now the active repo
  (non-null when a list is shown); `persist` always sends `{ paths, repoId }`. Update
  `UseDocumentAttachmentResult` to drop the removed fields. Keep the per-path in-flight toggle guard
  (Checkbox double-fire), the hydration effect, drag-reorder, preview, and `attachedTokens`. The hook's
  `links`/`docs` args are already the repo-scoped query results from T8.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`
- **Owned paths:** `client/src/lib/hooks/use-document-attachment.ts`
- **Depends-on:** T8
- **Known gotchas:** `client/INSIGHTS.md` lines 63 & 117–119 — the hydration `useEffect([id, links, docs])`
  and any `renderHook` args must use module-level stable references; a fresh `[]`/object literal
  re-triggers the effect and infinite-loops. Keep the `EMPTY_DOCS` sentinel discipline and the Checkbox
  double-fire `toggling` ref guard.
- **Acceptance:** `cd client && pnpm typecheck` passes; `UseDocumentAttachmentResult` no longer exposes
  `pendingAttach`/`confirmClear`/`cancelClear`/`anchorRepoId`; `persist` always includes `repoId`.

### Phase 3 — Server application & run-time (T4 after T3; T7 after T3 + T6)

#### T4 — Fix 3: repo-scope the services (agents + skills)
- **Action:** In `server/src/modules/agents/service.ts` and `server/src/modules/skills/service.ts`:
  `documentLinks(id, repoId)` forwards to `repo.linkedDocuments(id, repoId)`; `setDocuments(id, paths, repoId)`
  makes `repoId` required non-null and forwards to the scoped `repo.setDocuments`, then returns
  `documentLinks(id, repoId)`. Remove the `ConflictError` throw and the `existingRepoId`/`requestedRepoId`
  handling (the conflict outcome no longer exists). Leave the `ConflictError` import only if still used
  elsewhere in the file (name-clash paths) — otherwise remove it.
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`
- **Owned paths:** `server/src/modules/agents/service.ts`, `server/src/modules/skills/service.ts`
- **Depends-on:** T3
- **Known gotchas:** don't remove `ConflictError` from the skill service if it's still used for the
  duplicate-name check (lines ~85/106) — only drop the documents-anchor usage.
- **Acceptance:** `cd server && pnpm typecheck` passes; `setDocuments`/`documentLinks` take a required
  `repoId`; no documents-related `ConflictError` remains.

#### T7 — Fix 3: run-executor fetches links scoped to the PR's repo
- **Action:** In `server/src/modules/reviews/run-executor.ts`: fetch `this.agents.linkedDocuments(agent.id, repo.id)`
  and `skillsRepo.linkedDocuments(l.skill.id, repo.id)` (scoped to the reviewed PR's repo); call
  `computeEffectiveDocuments(agentDocs, enabledSkillDocs)` (no `pullRepoId`); delete the
  `for (const exclusion of excludedByRepoMismatch)` loop (~line 328); set `documents_repo_excluded: []`
  in the trace record (~line 509) so the untouched contract field stays present-but-empty. Empty per-repo
  lists yield an empty effective set → run proceeds normally (AC-31/AC-23).
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`
- **Owned paths:** `server/src/modules/reviews/run-executor.ts`
- **Depends-on:** T3, T6
- **Known gotchas:** `documents_read`/`documents_unavailable` behaviour (AC-24/25/26) is unchanged — only
  the repo-mismatch exclusion path is removed. Keep `documents_repo_excluded` in the written trace object
  (as `[]`) to satisfy the existing `RunTrace` type without a contract edit.
- **Acceptance:** `cd server && pnpm typecheck` passes; both `linkedDocuments` calls pass `repo.id`; the
  exclusion loop is gone and `documents_repo_excluded` is written as `[]`.

### Phase 4 — Presentation (T5 after T4; T10 after T9)

#### T5 — Fix 3: repo-scope the document routes (agents + skills)
- **Action:** In `server/src/modules/agents/routes.ts` and `server/src/modules/skills/routes.ts`:
  (a) GET `/:id/documents` gains `schema.querystring: z.object({ repo_id: z.string().uuid() })`, validates
  the repo is in the workspace (reuse `getRepoRef`), and calls `service.documentLinks(id, req.query.repo_id)`.
  (b) `SetDocumentsBody`: make `repo_id: z.string().uuid()` **required** (remove `.optional()` and the
  `.refine`), so clearing (`paths: []`) also targets a specific repo; keep the `getRepoRef` workspace
  validation; call `service.setDocuments(id, paths, repo_id)`.
- **Module:** server
- **Type:** backend
- **Skills to use:** `fastify-best-practices`, `zod`, `client-server-communication`,
  `backend-onion-architecture`
- **Owned paths:** `server/src/modules/agents/routes.ts`, `server/src/modules/skills/routes.ts`
- **Depends-on:** T4
- **Known gotchas:** schema-first only — declare the querystring/body via `fastify-type-provider-zod`,
  never hand-parse (`server/CLAUDE.md`). `repo_id` is now required even for `paths: []`; the client (T8)
  already always sends it. Note (out of scope): `mcp` boots the server in-process — if any MCP tool calls
  these endpoints it would need the new required `repo_id`; flag if T12 surfaces an MCP consumer.
- **Acceptance:** `cd server && pnpm typecheck` passes; GET without `repo_id` → `422`; POST without
  `repo_id` → `422`; `cd server && pnpm exec vitest run .it.test` compiles/runs (green after T12 updates
  the fixtures).

#### T10 — Fix 3: rewire the picker to the active repo + AC-38 (picker + both wrappers + messages)
- **Action:** (a) `DocumentAttachmentPicker.tsx`: remove the repo `SelectInput` dropdown (lines 82–90),
  the repo-mismatch `Modal` (lines 164–184), and the `repos`/`reposLoading`/`onRepoChange`/`pendingAttach`/
  `confirmClear`/`cancelClear`/`anchorRepoId` props; accept `repoId: string | null` (active repo) and
  `repoName?: string`. When `repoId == null`, render an AC-38 `EmptyState` (title/body from new keys
  `context.selectRepoTitle`/`context.selectRepoBody`) — this replaces the old `!repos` branch and is
  distinct from the AC-4 `context.empty*` state. Keep the token badge (AC-15), doc list, drag/drop,
  preview, and untrusted note. (b) Both `ContextTab.tsx` wrappers (agent + skill): delete the local
  `repoId`/`defaultRepoId`/`setRepoId` state, call `useActiveRepo()`, derive `repoId = activeRepo?.id ?? null`
  and `repoName = activeRepo?.full_name`, pass repo-scoped `useAgentDocuments(id, repoId)`/
  `useSkillDocuments(id, repoId)` (T8), and pass `repoId`/`repoName` to the picker (drop `repos`/
  `reposLoading`/`onRepoChange`). (c) Messages: in `agents.json` and `skills.json` remove
  `context.repoMismatch.*` and `context.repoLabel`, add `context.selectRepoTitle` +
  `context.selectRepoBody`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`, `next-best-practices`
- **Owned paths:** `client/src/components/DocumentAttachmentPicker/DocumentAttachmentPicker.tsx`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx`,
  `client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.tsx`,
  `client/messages/en/agents.json`, `client/messages/en/skills.json`
- **Depends-on:** T9
- **Known gotchas:** keep the picker presentational — it takes `t` as a prop (`client/INSIGHTS.md` line 54)
  and must **not** call `useActiveRepo()` itself. `activeRepo` is null only when the repo list is empty
  (Q4), so AC-38 and "no repos" coincide — that's accepted. Keep the `EMPTY_DOCS` module-level sentinel in
  the wrappers. Every namespace a mounted component uses must be in a test's provider `messages`
  (`client/INSIGHTS.md` line 95) — relevant for T13.
- **Acceptance:** `cd client && pnpm typecheck` + `pnpm build` pass; with no active repo the picker shows
  the AC-38 select-a-repository prompt; with an active repo it shows that repo's attached list; there is no
  repo dropdown and no mismatch modal; switching the global nav repo shows the other repo's list with no
  clear/confirm. (Behavioural assertions land in T13.)

### Phase 5 — Fix 2 additive UI (T11 after T10)

#### T11 — Fix 2: scoped filter input + attached/shown count (AC-36, AC-37)
- **Action:** In `DocumentAttachmentPicker.tsx`, add a path filter `TextInput` (placeholder
  `context.filterPlaceholder`) scoped to this picker and independent of the standalone screen's AC-7
  filter; filter the rendered `order` list by case-insensitive path substring (mirror `SkillsTab.tsx`
  lines 93–111). Add a count indicator: always show attached count `context.attachedCount` (`{count}`
  from `attached.size`), and **while the filter is non-empty** also show `context.filterShown`
  (`{shown} of {total} shown`, where `total` = discovered docs count, `shown` = post-filter count). Keep
  this visually/semantically distinct from the AC-15 token badge. Add the three keys to both
  `agents.json` and `skills.json` under `context.*`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/components/DocumentAttachmentPicker/DocumentAttachmentPicker.tsx`,
  `client/messages/en/agents.json`, `client/messages/en/skills.json`
- **Depends-on:** T10 (same picker + message files — additive on the post-rewrite structure; sequenced,
  never concurrent with T10)
- **Known gotchas:** AC-37 is explicitly distinct from the AC-15 token volume — do not overload the token
  badge. The filter must be scoped to this picker only (not the AC-7 `ContextWorkspace` filter). Both
  namespaces must carry identical key shape (`client/INSIGHTS.md` line 54) — add the keys to **both**
  message files.
- **Acceptance:** `cd client && pnpm typecheck` + `pnpm build` pass; typing in the filter narrows the doc
  list by path; the attached count always shows; while filtering, an "N of M shown" indicator appears and
  matches the visible row count. (RTL assertions land in T13.)

### Phase 6 — Test follow-up (test-writer; T12 after T5+T7, T13 after T11)

#### T12 — Test-writer follow-up: server (per-repo scoping + effective set)
- **Action:** Update/extend `server/src/modules/agents/agent-documents.it.test.ts`,
  `server/src/modules/skills/skill-documents.it.test.ts` (DB-backed, `.it.test.ts` suffix — testcontainers),
  and any `effective-documents` unit test to reflect: independent per-repo lists (attach the same path
  under repo A and repo B → both persist, GET `?repo_id=` returns only the queried repo's list); scoped
  clear (`paths: []` for repo A leaves repo B intact); removal of the anchor `ConflictError`; GET/POST
  `422` without `repo_id`; `computeEffectiveDocuments` no longer excludes on repo mismatch. Confirm no MCP
  consumer of these routes broke.
- **Module:** server
- **Type:** backend (tests)
- **Skills to use:** `backend-onion-architecture`
- **Owned paths:** `server/src/modules/agents/agent-documents.it.test.ts`,
  `server/src/modules/skills/skill-documents.it.test.ts`, `server/src/modules/reviews/effective-documents.test.ts`
- **Depends-on:** T5, T7
- **Known gotchas:** DB-backed tests **must** keep the `.it.test.ts` suffix (testcontainers Postgres);
  hermetic unit tests must not. Run `cd server && pnpm exec vitest run .it.test` for the integration set.
- **Acceptance:** `cd server && pnpm typecheck` and the targeted `vitest run` pass; a test proves the same
  path attached under two repos coexists and each GET returns only its repo's list.

#### T13 — Test-writer follow-up: client (per-repo UI, filter/count, AC-38, Fix 1 regression)
- **Action:** Update `AgentEditor/.../ContextTab/ContextTab.test.tsx`,
  `SkillEditor/.../ContextTab/ContextTab.test.tsx`, `lib/hooks/documents.test.tsx`, and (regression only)
  `ContextWorkspace.test.tsx`, plus any `use-document-attachment` hook test: remove anchor/confirm-clear
  expectations; assert `useActiveRepo`-driven repoId, repo-scoped query keys and always-sent `repo_id`;
  assert the AC-38 select-a-repository state when no active repo; assert the AC-36 filter narrows the list
  and the AC-37 attached/"N of M shown" counts; confirm `ContextWorkspace.test.tsx` still passes after the
  Fix 1 style change (behaviour/text unchanged).
- **Module:** client
- **Type:** ui (tests)
- **Skills to use:** `react-testing-library`
- **Owned paths:** `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx`,
  `client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.test.tsx`,
  `client/src/lib/hooks/documents.test.tsx`,
  `client/src/app/repos/[repoId]/context/_components/ContextWorkspace/ContextWorkspace.test.tsx`
- **Depends-on:** T11
- **Known gotchas:** `client/INSIGHTS.md` — mock query hooks must return **module-level stable** objects
  (lines 117–119) or the hydration effect infinite-loops/OOMs; add every used namespace to the provider
  `messages` (line 95); this package has **no** `user-event` — use `fireEvent`; App Router bracket paths
  break `**` globs — pass the literal `.test.tsx` path to vitest (line 51).
- **Acceptance:** `cd client && pnpm typecheck` and the targeted `vitest run` (literal file paths) pass;
  tests cover per-repo switching (no clear/confirm), the filter/count, and the AC-38 state.

## Testing strategy
- **Server unit:** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — covers
  `effective-documents` (T6/T12).
- **Server integration (DB-backed):** `cd server && pnpm exec vitest run .it.test` — covers the per-repo
  route/repository behaviour (T12) on testcontainers Postgres.
- **Migration:** `cd server && pnpm db:migrate` against a seeded DB (T2); verify PK + NOT NULL via psql.
- **Client unit/component:** `cd client && pnpm exec vitest run "<literal .test.tsx path>"` per file
  (T13) — bracket App Router paths require literal paths, not `**` globs.
- **Client gate:** `cd client && pnpm typecheck && pnpm build` (no ESLint/Prettier exist in this repo).
- **Demonstration (non-deterministic, optional):** the SPEC-01 mid-tier-model scenario (attach a
  invariant spec, review a violating PR) still applies but is out of scope for these fixes' pass/fail gate.

## Risks & mitigations
- **Legacy `repo_id IS NULL` rows blocking the NOT NULL migration** → T2 deletes them first, before
  `SET NOT NULL` (confirmed safe: local dev DB, no prod data).
- **Composite-PK concurrency race on replace** → T3 keeps the existing advisory-lock serialization used by
  `setSkills`/`setDocuments`; a plain delete+insert would trip the new PK.
- **Cache/UI drift after a repo switch** → T8 puts `repoId` in the query key and writes `onSuccess` back to
  the same scoped key.
- **Fix 2 / Fix 3 both editing the picker + messages** → resolved by the T10→T11 dependency edge (never
  concurrent); Fix 1 and the whole server chain stay fully parallel.
- **Trace contract field left dangling** → `documents_repo_excluded` stays in the `RunTrace` contract and
  is written as `[]` (T7); no vendored-contract edit, no consumer breaks.
- **Hidden MCP consumer of the now-required `repo_id`** → T12 explicitly checks; flag back if found rather
  than silently changing MCP.

## Red-flags check
- [x] Every requirement maps to a task — R1→T1; R2→T11; R3→T2,T3,T4,T5,T6,T7,T8,T9,T10 (tests T12,T13).
- [x] No specification was authored or edited — SPEC-01 taken as input; only this plan was written.
- [x] Execution mode recorded (multi-agent) and the plan is shaped for it (DAG + non-overlapping
      concurrent owned paths; Fix 2 sequenced after the shared-file rewrite).
- [x] Dependencies form a DAG (no cycles): T1·T2·T6·T8 → T3(T2)·T9(T8) → T4(T3)·T7(T3,T6) →
      T5(T4)·T10(T9) → T11(T10) → T12(T5,T7)·T13(T11).
- [x] Concurrent tasks have non-overlapping owned paths (verified per phase; T10/T11 share files but are
      sequenced, never concurrent).
- [x] Every Acceptance is measurable (commands, `422` codes, PK/NOT NULL checks, console-warning absence).
- [x] Contracts defined before dependents — no new/changed shared contract; the server route shape (T5) is
      the agreed wire and the client (T8) is written to it.
- [x] No edits to existing shared contracts — `AgentDocumentLink`/`SkillDocumentLink`/`DocumentsRepoExclusion`
      shapes unchanged (Q2); explicitly called out.
- [x] `*/src/vendor/**` is not modified in any task.
- [x] No DB table deletions or edits to existing migrations — `0015` is append-only; row `DELETE`s are
      data-only within the new migration; `0013`/`0014` untouched.

## AC-to-task mapping
| AC | Tasks |
|----|-------|
| Fix 1 (no AC — pure bug) | T1 |
| AC-13 (store path under the repo it was attached under) | T3, T4, T5, T8 |
| AC-17 (effective set from the PR repo's list; union of agent + enabled skills) | T6, T7 |
| AC-18 / AC-19 (dedup + order — preserved, not regressed) | T6 |
| AC-29 (independent ordered list per repository) | T2, T3 |
| AC-30 (switch active repo → that repo's list, no clear/confirm/invalidate) | T3, T8, T9, T10 |
| AC-31 (run draws from PR repo's list; empty → no docs, run proceeds) | T6, T7 |
| AC-32 (identical for agent and skill) | T3, T4, T5, T10 |
| AC-36 (per-picker path filter, independent of AC-7) | T11 |
| AC-37 (attached count + "N of M shown" while filtering; distinct from AC-15) | T11 |
| AC-38 (no active repo → select-a-repository prompt; distinct from AC-4) | T10 |
