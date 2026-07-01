# Plan: Prior PRs touching these files (History Accordion)

## Understanding
Add a collapsed-by-default accordion to the PR Overview titled "Prior PRs touching
these files (N)" that, when the user expands it, lists previously-merged PRs that
changed any of the current PR's files: PR #, title, author, merge date, the
overlapping files, and a short deterministic note. The data comes from `git log`
on the already-cloned repo (no GitHub API, no LLM). Server work runs only at
read-time behind a dedicated endpoint, and the client fetches lazily on first
expand so nothing heavy runs on Overview mount. The shared `PrHistory` contract,
the `GitClient.log` adapter, and the PR/repo lookups all already exist and are
reused unchanged.

## Context loaded
Docs / insights:
- Root `CLAUDE.md` (auto-loaded) + root `INSIGHTS.md` — vendored-contracts-are-source
  of-truth, "looks greenfield, isn't" (pre-stubbed contracts), package-local binary
  invocation (`node_modules/.bin/...`), testcontainers `TESTCONTAINERS_RYUK_DISABLED=true`.
- `server/CLAUDE.md` — adapters-behind-DI, modules-as-plugins registered in
  `src/modules/index.ts`, schema-first routes, `.it.test.ts` split, do-not-touch list.
- `client/CLAUDE.md` — data access only via `src/lib/hooks/*` → `src/lib/api.ts`,
  thin pages + colocated `_components/<Name>/`, i18n via `messages/<locale>/*.json`,
  vendor untouchable.

Skills matched (read on demand, none required loading for this CRUD-shaped feature):
- `client-server-communication` (endpoint shape + typed fetch hook), `fastify-best-practices`
  (schema-first route + per-route rate limit), `react-best-practices` (lazy hook + accordion),
  `react-testing-library` (component test). The blast module already encodes every one of
  these patterns concretely, so I mirror its source rather than re-deriving from the skills.

Server source consulted (the canonical pattern to mirror):
- `server/src/modules/blast/routes.ts` — schema-first `GET /pulls/:id/blast` (params `IdParams`,
  `getContext`, `container`, tighter per-route rateLimit on the expensive variant).
- `server/src/modules/blast/service.ts` — `BlastService.getBlast` (resolve PR via `getPull`,
  files via `getPrFiles`, `pr.repoId`) + the exported pure `shapeBlastResponse` (test seam).
- `server/src/modules/blast/service.test.ts` + `server/test/blast-routes.it.test.ts` — the
  hermetic-unit vs DB-backed `.it.test.ts` split, the inject-a-mock-facade pattern, the
  `setupRepoAndPr` seed helper, 200/404/422 assertions.
- `server/src/modules/reviews/repository/pull.repo.ts` — `getPull(db, workspaceId, prId)` returns
  `PullRow` (has `number`, `repoId`, `branch`); `getPrFiles(db, prId)` returns `{path,...}` rows.
- `server/src/modules/repo-intel/repository.ts` — `RepoIntelRepository.getRepoBasics(repoId)` →
  `{ id, owner, name, defaultBranch, clonePath: string|null }` (degrade gate).
- `server/src/modules/repo-intel/service.ts:227-231` — the exact `getRepoBasics` →
  `if (!repo || !repo.clonePath) return empty` → `const ref: RepoRef = { owner, name }` idiom.
- `server/src/adapters/git/simple-git.ts:149-157` — `log(repo, path?)` maps simple-git's
  `log.all` → `GitCommit { sha, message, author, date }` (`message` = commit subject).
- `server/src/vendor/shared/adapters.ts:105-108,205-238` (DO NOT EDIT) — `RepoRef {owner,name}`,
  `GitCommit`, `GitClient.log(repo, path?)`.
- `server/src/vendor/shared/contracts/brief.ts:65-78` (DO NOT EDIT) — `PrHistoryItem`/`PrHistory`
  zod (reused as the route response schema).
- `server/src/platform/container.ts:89-93` — `container.git` (overridable in tests).
- `server/src/modules/_shared/{schemas.ts,context.ts}` — `IdParams` (uuid), `getContext`.
- `server/src/app.ts:64-65` — global `setValidatorCompiler`/`setSerializerCompiler` are set, so a
  Zod `response` schema serializes correctly (no other route uses one today, but it is supported).
- `server/src/adapters/mocks.ts:255-314` — `MockGitClient.log` currently ignores `path`; needs a
  per-path test seam.
- `server/src/db/schema/pulls.ts:5-45` — `pull_requests` (`number`, `repoId`, `branch`) and
  `pr_files`; `server/src/db/rows.ts:18` — `PullRow`.

Client source consulted:
- `client/src/lib/hooks/blast.ts` — `useBlastSummary(prId, { enabled })` lazy-on-expand pattern.
- `client/src/lib/api.ts` — `api.get<T>` typed fetch client.
- `client/src/lib/github-urls.ts:16-18` — `githubPrUrl(repoFullName, number)`.
- `client/src/lib/types.ts:55-111` — hand-mirrored TS interfaces (`BlastResponse` etc.) — where
  `PrHistory`/`PrHistoryItem` interfaces get added.
- `.../_components/OverviewTab/OverviewTab.tsx:20-44` — stacked sections; `<BlastRadius>` placement;
  `prId`/`repoFullName` already in scope.
- `.../_components/BlastRadius/{BlastRadius.tsx,index.ts,styles.ts,BlastRadius.test.tsx}` — component
  + `index.ts` re-export + `styles.ts` + the RTL fetch-mock + `NextIntlClientProvider` test harness.
- `client/messages/en/blast.json` — i18n shape; `client/src/i18n/request.ts:16-25` — namespaces are
  auto-discovered from `messages/<locale>/*.json` (adding `history.json` needs NO registration code).

Deliberately NOT loaded: `reviewer-core/*` (no review-flow/prompt/grounding change), `docs/agent-prompts/*`
(no agent prompt), `e2e/*` (no new browser flow in scope), `docs/architecture.md` (read-time endpoint, not
the review pipeline). The referenced `docs/plans/blast-radius-*.md` are not present on disk in this tree, so
the implemented blast module source above stands in as the established convention.

## Approach & tradeoffs
Chosen: **#1 git-log on the existing clone** + integration **A (dedicated read-time
endpoint + lazy hook fetched on expand)**.

- **New `history` module** (`server/src/modules/history/`) registered in `src/modules/index.ts`,
  rather than bolting onto the `blast` module. Matches the "each lesson adds its own module without
  touching others" convention in `index.ts`; keeps blast's zero-AI invariant and tests undisturbed.
- **Per-changed-file `git.log(ref, file)` loop, then invert to PR→files.** The existing adapter
  method gives, for each file, the commits (and thus PRs, via the merge/squash ref in the subject)
  that touched it. Inverting the (file→commits) map yields each prior PR's `files_overlap` for free.
  Rejected: adding a `GitClient` method that takes paths/`maxCount` — the adapter interface is
  vendored and do-not-touch.
- **Pure helpers split out as test seams** — `parsePrRef`/`stripPrRef` (`pr-ref.ts`) and the
  grouping/rank/build function `buildPriorPrs` (exported from `service.ts`, mirroring how blast
  exports `shapeBlastResponse`). The DB+git orchestration (`HistoryService.getPriorPrs`) is covered
  by a DB-backed `.it.test.ts`; the pure logic by hermetic unit tests.
- **Reuse the vendored `PrHistory` zod as the route response schema.** No contract change. This is
  the first route to declare a Zod `response` schema, but the global serializer compiler
  (`app.ts:65`) supports it. Tradeoff: a malformed item would 500 on serialize — mitigated because
  `buildPriorPrs` constructs items to the contract shape deterministically.
- **Degrade-to-safe over throw.** Missing PR → 404 (mirrors blast; the client addressed a row that
  does not exist). Everything else — no clone (`clonePath == null`), no changed files, unparseable
  subjects, or any git error — returns `{ history: [] }`, never a 500.
- **Lazy fetch on first expand.** Hook defaults `enabled: false` (mirrors `useBlastSummary`); the
  accordion flips it true on first open. The git-log loop is filesystem work and must not run on
  Overview mount. Consequence: the header count `(N)` only appears after the first expand resolves
  (and stays, React-Query-cached). Rejected: fetch-on-mount to show `N` eagerly — violates the
  no-work-on-mount constraint. Note in Open Questions.
- **Deterministic `notes`, no LLM.** `notes` = `"Touched N of these files"` derived from
  `files_overlap.length`. The GitHub Associated-PRs enrichment and any LLM-authored note are
  out of scope.

## Implementation steps

### Server

1. **Pure PR-ref parser** — `server/src/modules/history/pr-ref.ts`
   - Change type: add
   - What: export `parsePrRef(message: string): number | null` and `stripPrRef(message: string): string`.
     `parsePrRef` reads the **first line** (subject) of `message` and matches, in order:
     squash-merge trailing ref `/\(#(\d+)\)\s*$/` and merge-commit `/^Merge pull request #(\d+)\b/`;
     returns the captured number or `null`. `stripPrRef` returns the subject with a trailing
     `(#\d+)` removed and trimmed (the human title). No git, no DB, no I/O.
   - Verify: `cd server && node_modules/.bin/vitest run src/modules/history/pr-ref.test.ts` (step 2) passes.

2. **Parser unit tests** — `server/src/modules/history/pr-ref.test.ts`
   - Change type: add
   - What: hermetic `describe`/`it` (vitest) covering: squash subject `"Add rate limiting (#482)"` → `482`
     and title `"Add rate limiting"`; merge subject `"Merge pull request #77 from acme/feat"` → `77`;
     a body-only `(#12)` on a non-first line is ignored; plain subject with no ref → `null` and title
     unchanged; multi-digit and leading-zero-free numbers; an empty string → `null`.
   - Verify: `cd server && node_modules/.bin/vitest run src/modules/history/pr-ref.test.ts` → green.

3. **History service (pure builder + orchestrator)** — `server/src/modules/history/service.ts`
   - Change type: add
   - What:
     - Export pure `buildPriorPrs(commitsByFile: Array<{ file: string; commits: GitCommit[] }>,
       ownPrNumber: number, opts?: { maxPrs?: number }): PrHistory`. Algorithm: iterate files →
       commits; `n = parsePrRef(c.message)`; skip `n == null` or `n === ownPrNumber`; accumulate a
       `Map<number, { pr_number, title, author, merged_at, filesOverlap: Set<string> }>` keyed by `n`
       (first sighting sets `title = stripPrRef(c.message)`, `author = c.author`, `merged_at = c.date`;
       keep the **max** `merged_at` across sightings; add `file` to `filesOverlap`). Then emit
       `PrHistoryItem[]` sorted by `merged_at` desc (recency), take top `opts.maxPrs ?? 8`, with
       `files_overlap` = sorted array and `notes` = `"Touched ${size} of these files"`. Return
       `{ history }`. Constants `MAX_PRS_RETURNED = 8`, `MAX_FILES_SCANNED = 25`,
       `MAX_COMMITS_PER_FILE = 50` exported for tests/reuse.
     - `class HistoryService { constructor(private container: Container) {} async getPriorPrs(workspaceId, prId): Promise<PrHistory> }`:
       (a) `const pr = await getPull(container.db, workspaceId, prId)`; if `!pr` → `throw new NotFoundError('Pull request not found')`.
       (b) `const files = (await getPrFiles(container.db, pr.id)).map(r => r.path)`; if empty → `{ history: [] }`.
       (c) `const basics = await new RepoIntelRepository(container.db).getRepoBasics(pr.repoId)`;
       if `!basics || !basics.clonePath` → `{ history: [] }` (mirror `repo-intel/service.ts:227-231`).
       (d) `const ref: RepoRef = { owner: basics.owner, name: basics.name }`; cap files to
       `files.slice(0, MAX_FILES_SCANNED)` and `container.log?.warn` when truncated.
       (e) For each capped file: `try { commits = (await container.git.log(ref, file)).slice(0, MAX_COMMITS_PER_FILE) } catch { commits = [] }`.
       (f) `return buildPriorPrs(commitsByFile, pr.number, { maxPrs: MAX_PRS_RETURNED })`.
       Wrap (c)-(f) in a `try/catch` that returns `{ history: [] }` so any git/FS error degrades, never 500.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` clean; step 4 tests pass.

4. **Builder unit tests** — `server/src/modules/history/service.test.ts`
   - Change type: add
   - What: hermetic tests for the **pure** `buildPriorPrs` only (no DB/git), mirroring
     `blast/service.test.ts`. Cover: two files sharing PR `#482` → one item with both files in
     `files_overlap` and `notes` "Touched 2 of these files"; the current PR's own number is excluded;
     commits with no parseable ref are dropped; `merged_at` is the max date across sightings; sort is
     recency-desc; `maxPrs` cap (build 10 distinct PRs, assert 8 returned, newest kept); empty input →
     `{ history: [] }`.
   - Verify: `cd server && node_modules/.bin/vitest run src/modules/history/service.test.ts` → green.

5. **Route (schema-first)** — `server/src/modules/history/routes.ts`
   - Change type: add
   - What: default Fastify plugin mirroring `blast/routes.ts`. `const app = appBase.withTypeProvider<ZodTypeProvider>()`.
     Register `app.get('/pulls/:id/prior-prs', { schema: { params: IdParams, response: { 200: PrHistory } },
     config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req): Promise<PrHistory> => {
     const { workspaceId } = await getContext(container, req); return new HistoryService(container).getPriorPrs(workspaceId, req.params.id); })`.
     Import `PrHistory` from `@devdigest/shared`. No hand-rolled `.parse()`.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` clean.

6. **Register the module** — `server/src/modules/index.ts`
   - Change type: modify
   - What: add `import history from './history/routes.js';` and add `history,` to the `modules` record.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` clean; the route is reachable in step 8.

7. **Per-path git mock seam** — `server/src/adapters/mocks.ts`
   - Change type: modify
   - What: add `logByPath?: Record<string, GitCommit[]>` to `MockGitOptions`, and change
     `MockGitClient.log(repo, path?)` to return `this.opts.logByPath?.[path ?? ''] ?? <existing default>`.
     (Real source file, not vendored — editing is allowed.) This lets DB-backed tests return distinct
     commits per file without touching disk.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` clean; used by step 8.

8. **Route integration test (DB-backed)** — `server/test/history-routes.it.test.ts`
   - Change type: add
   - What: `.it.test.ts` mirroring `blast-routes.it.test.ts`. Seed workspace + repo (set
     `clonePath: '/mock/clones/acme/repo'`, non-null) + PR (`number: 900`, `branch`) + `pr_files`
     for two paths. Build the app with `overrides: { secrets: new MockSecretsProvider({}),
     git: new MockGitClient({ logByPath: { 'src/a.ts': [<commit "Feat A (#101)">, <commit "(#900)" own-PR>],
     'src/b.ts': [<commit "Feat A (#101)">, <commit "Merge pull request #102 from x">] } }) }`. Assert:
     `GET /pulls/:id/prior-prs` → 200, body matches `PrHistory` with `#101` listing both files
     (overlap=2), `#102` listing one, the own-PR `#900` excluded, recency order, `notes` populated;
     a repo seeded with `clonePath: null` → 200 `{ history: [] }`; a non-existent PR uuid → 404;
     a non-uuid id → 422.
   - Verify: `cd server && TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run test/history-routes.it.test.ts` → green.

### Client

9. **Mirror the contract types** — `client/src/lib/types.ts`
   - Change type: modify
   - What: add hand-mirrored interfaces next to `BlastResponse`:
     `export interface PrHistoryItem { pr_number: number; title: string; merged_at: string; author: string; files_overlap: string[]; notes: string; }`
     and `export interface PrHistory { history: PrHistoryItem[]; }` (matches vendored `brief.ts`).
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` clean.

10. **Lazy data hook** — `client/src/lib/hooks/history.ts`
    - Change type: add
    - What: `"use client"`; `export function usePriorPrs(prId, options: { enabled: boolean })` →
      `useQuery({ queryKey: ["prior-prs", prId], queryFn: () => api.get<PrHistory>(\`/pulls/${prId}/prior-prs\`), enabled: options.enabled && prId != null })`.
      Mirror `useBlastSummary`'s explicit `enabled` gate so nothing fetches on mount.
    - Verify: `cd client && node_modules/.bin/tsc --noEmit` clean.

11. **i18n strings** — `client/messages/en/history.json`
    - Change type: add
    - What: new `history` namespace (auto-discovered, no code wiring): keys
      `title` ("Prior PRs touching these files"), `count` ("{count}"), `toggle.aria`
      ("Toggle prior PRs"), `loading`, `empty` ("No prior merged PRs touched these files."),
      `mergedAt` ("merged {date}"), `note` ("Touched {count} of these files"),
      `openOnGithub` ("Open PR #{number} on GitHub"). All user-facing strings live here.
    - Verify: valid JSON; consumed by step 12; rendered in step 13's test.

12. **The accordion component** — three files under
    `client/src/app/repos/[repoId]/pulls/[number]/_components/PriorPrs/`
    - Change type: add (`PriorPrs.tsx`, `styles.ts`, `index.ts`)
    - What: `"use client"` `export function PriorPrs({ prId, repoFullName }: { prId: string|null|undefined; repoFullName: string|null|undefined })`.
      `const t = useTranslations("history")`. `const [open, setOpen] = React.useState(false)`;
      `const { data, isLoading } = usePriorPrs(prId, { enabled: open })`. Render a `<section>` with a
      `SectionLabel icon="History"` and a bordered accordion header button (chevron rotates when open;
      `aria-expanded={open}`; on click `setOpen(o => !o)`). Show the count badge `t("count", { count:
      data.history.length })` only once `data` is present. When open: `isLoading` → `t("loading")`;
      empty `data.history` → `t("empty")`; else map `HistoryRow`s — `#<pr_number>` (mono/accent) +
      `title`, `author` + `·` + `merged_at`, the `notes` line; each row links to
      `githubPrUrl(repoFullName, item.pr_number)` (`target="_blank" rel="noopener noreferrer"`,
      `aria-label={t("openOnGithub", { number: item.pr_number })}`) when `repoFullName` is set, else
      plain text. `styles.ts` mirrors `BlastRadius/styles.ts` (`s` object). `index.ts`:
      `export { PriorPrs } from "./PriorPrs";`.
    - Verify: `cd client && node_modules/.bin/tsc --noEmit` clean; step 14 test passes.

13. **Wire into the Overview** — `.../_components/OverviewTab/OverviewTab.tsx`
    - Change type: modify
    - What: `import { PriorPrs } from "../PriorPrs";` and render `<PriorPrs prId={prId} repoFullName={repoFullName} />`
      immediately after `<BlastRadius prId={prId} repoFullName={repoFullName} />` (line 37). No prop
      plumbing needed — both are already in scope.
    - Verify: `cd client && node_modules/.bin/tsc --noEmit` clean; appears below Blast Radius in the UI.

14. **Component test (RTL + Vitest)** — `.../_components/PriorPrs/PriorPrs.test.tsx`
    - Change type: add
    - What: mirror `BlastRadius.test.tsx` harness (`QueryClientProvider` + `NextIntlClientProvider`
      with `{ history: historyMessages }`, `global.fetch` mock returning a `PrHistory` payload). Cover:
      (a) collapsed by default — `fetch` is NOT called on mount and rows are not rendered;
      (b) clicking the header expands, fetches, and renders a row with `#101`, the title, author,
      `merged_at`, the `notes`, and a link whose `href` is `https://github.com/<repo>/pull/101`;
      (c) empty `history` → empty-state message; (d) the count badge reflects `history.length` after
      expand. Assert no-fetch-on-mount via `expect(fetch).not.toHaveBeenCalled()` before the click.
    - Verify: `cd client && node_modules/.bin/vitest run "src/app/repos/[repoId]/pulls/[number]/_components/PriorPrs/PriorPrs.test.tsx"` → green.

## Acceptance criteria
1. Server typecheck + unit + integration:
   `cd server && node_modules/.bin/tsc --noEmit` (clean), then
   `cd server && node_modules/.bin/vitest run src/modules/history` (parser + builder green), then
   `cd server && TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run test/history-routes.it.test.ts`
   → `GET /pulls/:id/prior-prs` returns 200 with a `PrHistory` whose items list the overlapping
   PRs (own PR excluded, recency-ordered, `notes` populated); a `clonePath: null` repo returns
   `{ history: [] }`; a non-existent PR → 404; a non-uuid id → 422.
2. Client typecheck + component test:
   `cd client && node_modules/.bin/tsc --noEmit` (clean), then
   `cd client && node_modules/.bin/vitest run "src/app/repos/[repoId]/pulls/[number]/_components/PriorPrs/PriorPrs.test.tsx"`
   → accordion is collapsed on mount with **no** network call, expands to fetch and render PR rows
   with working GitHub links, and shows the empty state when `history` is empty.
3. End-to-end (manual smoke, optional): with the API + web running against an imported, indexed repo,
   open a PR Overview → a "Prior PRs touching these files" accordion sits directly below Blast Radius,
   collapsed; expanding it loads merged PRs that previously touched the PR's files, each linking to
   GitHub.

## Risks / out of scope / open questions
- Risks:
  - **First route with a Zod `response` schema.** Serialization relies on `app.ts:65`'s global
    serializer compiler; a `buildPriorPrs` output that violates `PrHistory` would 500 on serialize.
    Mitigated by constructing items deterministically to the contract; the `.it.test.ts` asserts 200.
  - **`maxCount` cannot be pushed into `git.log`** (vendored interface is do-not-touch), so the cap is
    a post-fetch `slice(0, MAX_COMMITS_PER_FILE)` plus `MAX_FILES_SCANNED`/`MAX_PRS_RETURNED`. On a
    huge file history the git subprocess still produces full output before slicing — acceptable for a
    local-first single-user app; truncation is logged.
  - **Subject-format coverage.** Only squash `"… (#N)"` and `"Merge pull request #N …"` are parsed;
    rebase-merge / custom templates yield `null` and are silently skipped (degrade, not error).
  - Do NOT edit `server/src/vendor/**` or `client/src/vendor/**`, do NOT alter the `PrHistory`
    contract, the `GitClient` interface, or any existing migration; no new DB table is needed.
- Out of scope (deferred):
  - GitHub Associated-PRs API fallback/enrichment; LLM-generated `notes` (kept deterministic);
    populating `PrBrief.history` in `BriefService` (this feature uses the dedicated read-time endpoint);
    the broader 2-column PR-Brief redesign.
- Open questions / assumptions:
  - **Count `(N)` appears only after first expand** (lazy-load preserves no-work-on-mount). Assumed
    acceptable vs. the design's eager `(N)`. If eager count is required, a cheap count-only path would
    be a follow-up — not planned here.
  - **Own-PR exclusion** is by matching `pr.number` in commit refs. Since the clone is checked out on
    the default branch, the current PR's unmerged branch commits aren't in `git log` history anyway;
    assumed sufficient (no separate branch-commit SHA scan).
  - **`merged_at` is the commit date** of the merge/squash commit (no `merged_at` column exists and
    only ~50 recent PRs are imported, so local `pr_files` is not authoritative) — assumed an adequate
    proxy for "merge date".
  - The vendored `PrHistory.merged_at` is a plain `string`; the UI renders it as-is (optionally via a
    date formatter). Assumed no strict ISO/locale formatting requirement for v1.
