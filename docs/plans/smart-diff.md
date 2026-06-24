# Plan: Smart Diff (risk-ordered diff layout)

## Understanding
Build a deterministic, token-free "Smart Diff" view that re-orders a PR's changed
files by risk so the reviewer reads business logic (`core`) before configs/barrels
(`wiring`) and lock files / generated artifacts (`boilerplate`). A new server route
`GET /pulls/:id/smart-diff` classifies each persisted PR file by path patterns,
attaches the line numbers of findings from the latest review, and returns the
existing `SmartDiff` Zod contract (`groups[{role, files[]}]` + `split_suggestion`).
A new client `SmartDiffViewer` renders the grouped files (boilerplate collapsed by
default) with a clickable "N findings" badge per file that scrolls the diff to the
finding's line. No LLM call is made anywhere in the flow.

## Context loaded
- Root `INSIGHTS.md` — esp. "Looks greenfield, isn't" (the `SmartDiff` contract is
  pre-stubbed and inert; wire it up, don't recreate) and the vendored-contracts entry
  (do NOT edit `src/vendor/shared`; the copies are triplicated and re-vendor-clobbered).
- Root `CLAUDE.md` (auto-loaded), `server/CLAUDE.md`, `client/CLAUDE.md`,
  `reviewer-core/CLAUDE.md` — schema-first routes, modules-as-plugins, DI container,
  data-access-through-hooks, vendored-dir prohibition, test split.
- Contract: `server/src/vendor/shared/contracts/brief.ts` (and the identical client
  copy + both `index.ts` barrels) — **`SmartDiff`, `SmartDiffGroup`, `SmartDiffFile`,
  `SmartDiffRole`, `ProposedSplit` already exist and exactly match the target shape.
  No contract change is needed.**
- Server route templates: `server/src/modules/pulls/routes.ts` (`GET /pulls/:id`,
  `prFiles` shape), `server/src/modules/reviews/routes.ts` + `intent.service.ts`
  (the sibling brief feature — exact pattern to mirror), `service.ts`/`helpers.ts`
  (`ReviewDto`/`reviewsForPull`, findings carry `file`/`start_line`/`end_line`),
  `repository.ts` (`getPrFiles(prId)`, `reviewsForPull(prId)` newest-first).
- Client integration: PR detail page
  `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`, `PrDetailHeader` (tab list),
  `DiffTab`, `OverviewTab`+`IntentCard` (card+hook template), `lib/hooks/brief.ts`
  (`useIntent` template), `lib/api.ts`, the shared `diff-viewer` (`parsePatch` in
  `helpers.ts`, `FileCard`/`CodeLine` rendering), `messages/en/brief.json`.
- Test conventions: `TESTING.md` rules via `server/test/intent-*.it.test.ts` +
  `intent-input.test.ts` (hermetic unit vs `.it.test.ts` DB-backed), `IntentCard`
  client RTL test as the component-test template.
- Skills consulted: `client-server-communication` (new GET endpoint = plural-noun
  sub-resource, `200` + typed hook, parse-don't-cast), `fastify-best-practices`
  (schema-first params, plugin-scoped route). `backend-onion-architecture` applies
  by analogy (pure classifier separated from DB orchestration) — not re-read; the
  existing intent split already embodies it. Deliberately skipped: e2e, agent-prompts,
  drizzle/postgresql skills (no schema/migration change), security skill (local-first,
  read-only GET, no new trust boundary).

## Approach & tradeoffs
**Chosen direction** — mirror the existing Intent brief feature end to end:
1. **Server, reviews module.** Add a pure, side-effect-free classifier + a constants
   file, plus a thin `SmartDiffService` that reads persisted data through the existing
   `ReviewRepository` and assembles the `SmartDiff` contract. Register one
   `GET /pulls/:id/smart-diff` route in `reviews/routes.ts` (the brief family already
   lives there: `GET/POST /pulls/:id/intent`). No GitHub/LLM call — it reads the
   `pr_files` rows that `GET /pulls/:id` already persists, plus findings from
   `reviewsForPull`.
2. **Client.** Add `useSmartDiff(prId)` to `lib/hooks/brief.ts`, a `SmartDiffViewer`
   component that joins the grouping (role + `finding_lines` + path) with the patch
   text already on `pr.files` (by path), and a new "Smart Diff" tab on the PR detail
   page. The viewer renders its own read-only diff rows via the shared `parsePatch`
   helper, assigning a stable DOM id per line so a finding badge can `scrollIntoView`.

**Key decisions / tradeoffs**
- **Classifier in `server/` (reviews module), not `reviewer-core`.** The feature
  scopes "file classifier logic" to `server/`, and the input is server-owned
  (`pr_files` + findings). Kept as a pure helper file (`smart-diff.classify.ts`) so it
  is hermetically unit-testable — same purity benefit as `reviewer-core` without
  widening the blast radius into a third package or the CI runner. Rejected:
  `reviewer-core/src/smart-diff/` (more packages touched than the feature asks for).
- **Patch text stays out of the new endpoint.** `SmartDiffFile` has no `patch` field
  and the client already holds patches via `GET /pulls/:id`. The viewer joins by path,
  so the endpoint stays lean and the contract is untouched. Rejected: adding `patch`
  to the contract (would mean editing the vendored, triplicated, re-vendor-clobbered
  `brief.ts` — explicitly discouraged by root `INSIGHTS.md`).
- **New "Smart Diff" tab, DiffTab untouched.** Preserves the existing Files-changed
  inline-commenting flow and keeps the new view isolated (lower regression risk).
  Rejected: replacing DiffTab content (would have to re-thread the commenting API and
  risk the diff/commenting tests).
- **Viewer renders diff via `parsePatch`, not `FileCard`.** Reusing the exported pure
  parser (no duplicated diff parsing) while owning its own rows lets us attach
  per-line ids + a controlled open state for scroll-to-line, with zero edits to the
  shared `diff-viewer` (and its comment tests). Rejected: adding `anchorId`/controlled-
  open props to `FileCard`/`CodeLine` (touches a shared, tested component for marginal
  reuse).
- **"Latest review" = the newest review row** from `reviewsForPull` (returned
  newest-first), aggregating its findings' `start_line` per file. Simple, deterministic,
  matches the singular wording. See Open questions for the latest-per-agent alternative.

## Implementation steps

1. **Add Smart Diff constants (patterns + thresholds)** — `server/src/modules/reviews/smart-diff.constants.ts`
   - Change type: add
   - What: export the classification inputs so nothing is hardcoded in logic
     (acceptance #4). Three ordered, exported arrays of matchers (regex or
     glob-like strings) — evaluated boilerplate → wiring → core(fallback):
     - `BOILERPLATE_PATTERNS`: lock files (`pnpm-lock.yaml`, `package-lock.json`,
       `yarn.lock`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `composer.lock`,
       `go.sum`), generated/build output (`dist/`, `build/`, `out/`, `.next/`,
       `coverage/`), `*.min.js`, `*.map`, snapshots (`__snapshots__/`, `*.snap`),
       vendored (`/vendor/`, `node_modules/`), and `*.generated.*`.
     - `WIRING_PATTERNS`: config/manifest (`package.json`, `tsconfig*.json`,
       `*.config.{ts,js,mjs,cjs}`, `.eslintrc*`, `.prettierrc*`, `*.yml`/`*.yaml`,
       `.env*`, `Dockerfile`, `docker-compose*`, `.github/`), and barrels/entry files
       (`index.ts`, `index.tsx`, `index.js`).
     - Plus `SPLIT_TOO_BIG_LINES` (e.g. `500`) and `SPLIT_MIN_FILES` (e.g. `2`) for
       `split_suggestion.too_big`.
   - Verify: file exports the three pattern arrays + two numeric thresholds; imported
     by `smart-diff.classify.ts` (step 2) with no literal patterns left in that file.

2. **Add the pure classifier + assembler** — `server/src/modules/reviews/smart-diff.classify.ts`
   - Change type: add
   - What: side-effect-free functions over plain inputs (no DB/`this`/network), mirroring
     `helpers.ts`/`intent-input.ts` purity:
     - `classifyFile(path: string): SmartDiffRole` — test BOILERPLATE first, then
       WIRING, else `'core'`. Lock files therefore always return `'boilerplate'`
       (acceptance #1).
     - `assembleSmartDiff(files, findingLinesByPath): SmartDiff` where `files` is
       `{ path, additions, deletions }[]` and `findingLinesByPath` is
       `Map<string, number[]>`. Build one `SmartDiffGroup` per role in fixed order
       `['core','wiring','boilerplate']` (drop empty groups), each `SmartDiffFile` =
       `{ path, additions, deletions, finding_lines: sorted-unique lines, pseudocode_summary: null }`.
       Compute `split_suggestion`: `total_lines = Σ(additions+deletions)`,
       `too_big = total_lines > SPLIT_TOO_BIG_LINES && files.length >= SPLIT_MIN_FILES`,
       `proposed_splits` = one `ProposedSplit` per non-empty role
       (`{ name: role, files: [paths] }`) when `too_big`, else `[]`.
   - Verify: `node_modules/.bin/tsc --noEmit` (in `server/`) passes; result satisfies
     `SmartDiff.parse(...)`; unit test in step 6 green.

3. **Add `SmartDiffService` (DB orchestration)** — `server/src/modules/reviews/smart-diff.service.ts`
   - Change type: add
   - What: a class taking `Container` (mirror `IntentService`), method
     `get(workspaceId, prId): Promise<SmartDiff>`:
     - `repo.getPull(workspaceId, prId)` → throw `NotFoundError` if absent (workspace
       scoping, like `IntentService.get`).
     - `repo.getPrFiles(prId)` → map to `{ path, additions, deletions }`.
     - `repo.reviewsForPull(prId)` (newest-first); take the latest review row (filter
       to `kind === 'review'`, first element). Build `findingLinesByPath`: for each of
       that review's findings, push `start_line` into the bucket keyed by `finding.file`.
       Empty map when there are no reviews.
     - return `assembleSmartDiff(files, findingLinesByPath)`.
   - Verify: `tsc --noEmit` passes; route test (step 7) returns a contract-valid body.

4. **Register the route** — `server/src/modules/reviews/routes.ts`
   - Change type: modify
   - What: instantiate `const smartDiffService = new SmartDiffService(container);` next
     to `intentService`, and add a schema-first read route beside `GET /pulls/:id/intent`:
     ```ts
     app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => {
       const { workspaceId } = await getContext(container, req);
       return smartDiffService.get(workspaceId, req.params.id);
     });
     ```
     No rate-limit override (cheap read; global 120/min applies, off under test) — same
     as the GET intent route. Update the module's top-of-file route-list comment.
   - Verify: `node_modules/.bin/vitest run routes-smoke` (server) still passes;
     `GET /pulls/<seeded-id>/smart-diff` returns `200`.

5. **Unit-test the classifier** — `server/test/smart-diff-classify.test.ts`
   - Change type: add
   - What: hermetic vitest (no DB, no `.it` suffix). Assert: `pnpm-lock.yaml` →
     `'boilerplate'`; `dist/x.js`, `a.min.js`, `__snapshots__/x.snap` → `'boilerplate'`;
     `tsconfig.json`, `vite.config.ts`, `src/index.ts` → `'wiring'`; `src/service.ts` →
     `'core'`. Assert `assembleSmartDiff` orders groups core→wiring→boilerplate, maps
     `finding_lines` (sorted+unique), and flips `too_big` exactly at the constant.
   - Verify: `node_modules/.bin/vitest run smart-diff-classify` (in `server/`) is green.

6. **Route integration test** — `server/test/smart-diff-routes.it.test.ts`
   - Change type: add
   - What: DB-backed test (`.it.test.ts` suffix, testcontainers) modeled on
     `intent-routes.it.test.ts`: seed a repo + PR, insert `pr_files` (a lock file +
     a core source file) and a review with a finding citing the core file, then
     `app.inject` `GET /pulls/:id/smart-diff`. Assert `200`; the lock file lands in the
     `boilerplate` group; the core file in `core` with `finding_lines` containing the
     finding's `start_line`; non-existent PR → `404`; body passes `SmartDiff.parse`.
   - Verify: `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run smart-diff-routes`
     (in `server/`) is green (skips cleanly if Docker absent, like the intent tests).

7. **Add the client hook** — `client/src/lib/hooks/brief.ts`
   - Change type: modify
   - What: append `useSmartDiff`, mirroring `useIntent`:
     ```ts
     import type { SmartDiff } from "@devdigest/shared";
     export function useSmartDiff(prId: string | null | undefined) {
       return useQuery({
         queryKey: ["smart-diff", prId],
         queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
         enabled: prId != null,
       });
     }
     ```
     (Re-exported via the existing `hooks/index.ts` barrel.)
   - Verify: `node_modules/.bin/tsc --noEmit` (in `client/`) passes; `SmartDiff` resolves
     from `@devdigest/shared`.

8. **Add i18n strings** — `client/messages/en/brief.json`
   - Change type: modify
   - What: add a `smartDiff` block: group labels (`core`/`wiring`/`boilerplate`),
     `findings` badge label (`"{count} findings"`), `empty`
     (`"No changed files to show."`), and `splitSuggestion`
     (`"This PR is large — consider splitting it."`). Keep keys flat/consistent with
     the existing `intent` block so `useTranslations("brief")` resolves them.
   - Verify: keys referenced by `SmartDiffViewer` (step 9) all exist; client test (step
     10) renders without a missing-message warning.

9. **Add `SmartDiffViewer` component** — `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx` (+ `index.ts`, `styles.ts`)
   - Change type: add
   - What: `"use client"` component, props `{ prId: string | null; files: PrFile[] }`.
     Calls `useSmartDiff(prId)`; builds a `Map<path, PrFile>` from `files` for patch
     joins. Renders each `SmartDiffGroup` in order with a `SectionLabel` (translated
     role label, file count). Per file: a header row (path, `+adds −dels`, and — when
     `finding_lines.length > 0` — a clickable "N findings" `Badge`/`Button`). Default
     open state = `role !== "boilerplate"` (acceptance #1). The body renders the joined
     patch via `parsePatch(file.patch)` (import from `@/components/diff-viewer/helpers`),
     each non-hunk line wrapped with `id={lineDomId(path, ln.newNo ?? ln.oldNo)}` and a
     "finding" highlight style when its line number ∈ `finding_lines`.
     Badge `onClick`: open the file if collapsed, then in a `requestAnimationFrame`/
     `setTimeout(0)` call `document.getElementById(lineDomId(path, min(finding_lines)))
     ?.scrollIntoView({ block: "center" })` and apply a transient highlight
     (acceptance #2). Loading → `Skeleton`; empty groups → translated empty state.
   - Verify: `tsc --noEmit` (client) passes; component test (step 10) green.

10. **Component test for the viewer** — `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx`
    - Change type: add
    - What: RTL + vitest (fetch mocked, per `client/CLAUDE.md`), modeled on
      `IntentCard.test.tsx`. Mock `useSmartDiff` (or the fetch) to return a boilerplate
      lock file + a core file with `finding_lines: [12]`. Assert: the boilerplate group
      renders collapsed (its diff lines not in the DOM initially); the core file shows a
      "1 findings"/"1 finding" badge; clicking the badge opens the file and a
      `scrollIntoView` spy fires for the line-12 element id.
    - Verify: `node_modules/.bin/vitest run SmartDiffViewer` (in `client/`) is green.

11. **Wire the tab into the PR detail page** — `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx` and `.../[number]/page.tsx`
    - Change type: modify
    - What: in `PrDetailHeader`, add a tab entry after `diff`:
      `{ key: "smart", label: "Smart Diff", icon: "GitCompare" }` (use an icon that
      exists in `@devdigest/ui`; fall back to `"Code"`/`"Layers"` if needed). In
      `page.tsx`, add `{tab === "smart" && <SmartDiffViewer prId={prId} files={pr.files} />}`
      next to the existing `tab === "diff"` branch and import the component. Tab state
      already round-trips through `?tab=` via `setTab`.
    - Verify: `node_modules/.bin/tsc --noEmit` (client) passes; with API + web running,
      `/repos/:repoId/pulls/:number?tab=smart` shows the grouped view.

## Acceptance criteria
Run from each package using the direct binaries (per root `INSIGHTS.md`, `pnpm <script>`
hard-fails on `ERR_PNPM_IGNORED_BUILDS` in this env):

1. **Server typecheck + logic.** In `server/`: `node_modules/.bin/tsc --noEmit` passes;
   `node_modules/.bin/vitest run smart-diff-classify` is green — proving lock files →
   `boilerplate` and patterns/thresholds come from the constants file (acceptance #1, #4).
2. **Endpoint contract.** In `server/`:
   `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run smart-diff-routes` is
   green — `GET /pulls/:id/smart-diff` returns `200`, a `SmartDiff.parse`-valid body with
   the lock file in `boilerplate` and the core file's `finding_lines` populated; missing
   PR → `404`. No LLM/GitHub adapter is invoked by the service (acceptance #3).
3. **Client typecheck + component.** In `client/`: `node_modules/.bin/tsc --noEmit`
   passes; `node_modules/.bin/vitest run SmartDiffViewer` is green — boilerplate
   collapsed by default (#1), a clickable "N findings" badge that triggers
   `scrollIntoView` for the finding's line element (#2).
4. **End-to-end manual.** `./scripts/dev.sh` (or API+web), open a reviewed PR →
   **Smart Diff** tab: files appear grouped core → wiring → boilerplate; boilerplate is
   collapsed; clicking a file's findings badge expands it and jumps to the cited line.
   No network call to OpenAI/Anthropic/OpenRouter occurs (token-free, #3).

## Risks / out of scope / open questions
- **Risks:**
  - The viewer relies on importing `parsePatch` from
    `@/components/diff-viewer/helpers` (not the package barrel, which only re-exports
    `DiffViewer`). Confirm the deep import resolves under the client tsconfig/aliases;
    if not, re-export `parsePatch` from `diff-viewer/index.ts` (additive) or copy the
    tiny parser into the viewer's local helpers.
  - `pr_files` are only persisted when `GET /pulls/:id` has run; the Smart Diff tab
    lives on the detail page (which fetches detail first), so rows exist by the time the
    tab loads. A freshly-imported PR opened straight to `?tab=smart` could see an empty
    grouping — acceptable (empty state), and the page's `usePullDetail` populates it.
  - Do **not** edit `server/src/vendor/shared` or `client/src/vendor/shared`
    (`brief.ts`) — the `SmartDiff` contract already matches; touching the vendored,
    triplicated copies risks desync/re-vendor clobber (root `INSIGHTS.md`).
- **Out of scope:** no DB schema/migration change (no new table; reads existing
  `pr_files`/`reviews`/`findings`); `pseudocode_summary` stays `null` (it would need an
  LLM — contradicts token-free); no change to the existing Files-changed (`DiffTab`)
  inline-commenting flow; no auto-recompute trigger (Smart Diff is derived on read, not
  persisted); no `reviewer-core`/CI-runner changes.
- **Open questions / assumptions:**
  - "Latest review" is taken as the single newest review row (`reviewsForPull`[0],
    `kind==='review'`). Alternative: aggregate the latest review **per agent** (matching
    the PR-list `findingsByPr` logic) so multi-agent findings all surface. If the
    desired behavior is the latter, `SmartDiffService` should aggregate finding lines
    across the newest-per-`agentId` reviews instead — a localized change in step 3.
  - `finding_lines` uses each finding's `start_line` (the citation anchor). Assumed
    dismissed findings are included (consistent with `SeverityCounts` counting all
    grounded findings); filter to non-dismissed if product wants only live findings.
  - `split_suggestion.proposed_splits` groups by role as a deterministic, no-LLM
    heuristic. If a by-top-level-directory split is preferred, swap the grouping key in
    `assembleSmartDiff` (step 2) — contract shape is unchanged either way.
