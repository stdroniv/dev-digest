# Plan: Blast Radius

## Understanding
Blast Radius answers a reviewer's first question — "what could break from these
changes?" — which the diff alone cannot show. For a PR's changed files we surface
(1) the symbols declared in those files, (2) the cross-file callers of each symbol
(`file:line`), and (3) the HTTP endpoints + cron jobs reachable from the changed
code. This is a **near-zero-AI read**: all of it already exists in the pre-built
`repo-intel` index and is exposed via `container.repoIntel.getBlastRadius()` +
`getIndexState()`. The work is (Phase A) a thin `blast` server module that resolves
the PR's changed files, calls the facade, and **shapes** a UI-ready response grouped
by changed symbol, plus an isolated, optional one-LLM-call summary endpoint; and
(Phase B) a self-contained `BlastRadius` panel on the existing Overview tab with a
Tree | Graph toggle, click-to-code blob links, and honest empty/degraded states.

## Context loaded
- Root `CLAUDE.md` (auto) + root `INSIGHTS.md` — esp. "looks greenfield, isn't"
  (pre-stubbed scaffolding), the local-first/no-auth threat model, and the
  vendored-contract hand-sync gotcha (`FeatureModelId` is triplicated; do **not**
  edit vendored copies).
- `server/CLAUDE.md`, `server/src/modules/repo-intel/README.md` — module-plugin
  convention, schema-first routes, adapters behind the DI container, test split.
- `client/CLAUDE.md` — data only through `lib/hooks/* → lib/api.ts`; thin pages;
  colocated `_components/<Name>/`; i18n via `messages/<locale>/*.json`.
- Facade (verified): `server/src/modules/repo-intel/service.ts:220` `getBlastRadius`
  (degraded ripgrep path) + `:315` `tryPersistentBlast` (precise path); contract
  `server/src/modules/repo-intel/types.ts:74` (`BlastResult`) + `:42` (`IndexState`);
  `MAX_CALLERS_PER_SYMBOL = 20` at `repo-intel/constants.ts:30`.
- Route/DI precedent: `server/src/modules/pulls/routes.ts` (PR + `pr_files` resolution,
  `getContext`, `IdParams`), `server/src/modules/repo-intel/routes.ts` (facade-read
  route shape), `server/src/modules/index.ts` (module registry), `platform/container.ts`
  (`repoIntel`, `llm(id)`), `_shared/schemas.ts` (`IdParams`).
- LLM-summary precedent: `server/src/modules/reviews/intent.service.ts` +
  `settings/feature-models.ts` (`resolveFeatureModel`), `modules/conventions/service.ts:190`
  `resolveCheapLlm` (first-configured provider + cheap model, graceful when no key),
  `LLMProvider.complete()` at `vendor/shared/adapters.ts:89`.
- Client precedent: PR detail page `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`,
  `_components/OverviewTab/OverviewTab.tsx` (renders `IntentCard`/`RisksCard`),
  `_components/IntentCard/IntentCard.tsx` (panel + empty-state shape),
  `lib/hooks/brief.ts` + `lib/hooks/core.ts` (hook patterns), `lib/api.ts`,
  `lib/github-urls.ts` (`githubBlobUrl` **already exists**), `i18n/request.ts`
  (auto-merges every `messages/en/*.json`), pre-stubbed `messages/en/blast.json`.
- Skills consulted: `backend-onion-architecture` (presentation route → thin app
  service → no new DB/data layer; the facade *is* the data source) and
  `client-server-communication` (endpoint shape, typed hook, error/empty contract).
  Deliberately skipped `drizzle-orm-patterns`/`postgresql-table-design` (no schema
  change — reads go through the facade), and `mermaid-diagram` (the Graph view is
  interactive click-to-code, so a hand-rolled SVG beats a static mermaid render).
- Noted but not coupled to: `mcp/src/tools/get-blast-radius.ts` is a separate
  `not_implemented` MCP stub with its own schema — the web `blast` module is the
  first real UI consumer of `getBlastRadius`; the two contracts stay independent.

## Approach & tradeoffs
**Chosen:** a new self-contained `server/src/modules/blast/` plugin exposing
`GET /pulls/:id/blast` (+ `GET /pulls/:id/blast/summary`). The route is presentation
only; a thin `BlastService` reads the PR's persisted changed files (`pr_files`),
calls `repoIntel.getBlastRadius` + `getIndexState`, and **re-shapes** the flat
`BlastResult` into a UI-ready, symbol-grouped payload (per-symbol caller cap 20,
rank-desc within a group, endpoints/crons attributed per symbol via `factsByFile`
plus a flat union, and an honest `index` status block). No new tables, no new DB
access, no indexing — the facade is the single data source (onion: inward-only).

The client embeds a `BlastRadius` panel into the **existing** Overview tab (design
#4), fed by a `useBlastRadius(prId)` TanStack hook. It renders Tree (default) and a
hand-rolled SVG Graph behind a toggle, links callers to GitHub blob URLs at the
indexed SHA, and degrades to explicit empty/degraded states.

**Rejected alternatives:**
- *A separate "Blast" tab* — rejected per locked decision #2; the panel lives in
  Overview next to Intent/Risk so the reviewer sees impact without a context switch.
- *Re-deriving callers/endpoints at request time* (re-grep/re-parse the clone) —
  rejected: the facade already did the heavy lifting; the persistent path is a pure
  Postgres read (no clone parsing), which is what keeps the core read fast and AI-free.
- *A new `pr_blast_summary` table / migration for the LLM summary cache* — rejected
  for v1: a process-lifetime in-memory `Map` keyed by `prId:lastIndexedSha` avoids a
  migration (CLAUDE.md discourages casual schema growth) and is sufficient for a
  local-first single-user app. Tradeoff recorded under Risks (lost on restart).
- *A dedicated `blast_summary` FeatureModelId slot* — rejected: `FeatureModelId` is a
  **vendored** enum triplicated across packages (root INSIGHTS) and must not be edited.
  The summary instead routes through the existing `resolveCheapLlm` pattern
  (config/secrets-driven, no hardcoded provider, graceful no-op without a key).
- *A new graph dependency* (react-flow/d3/cytoscape) — rejected: none is installed
  (`client/package.json`), the data is a shallow 3-level hierarchy, and click-to-code
  needs full control of node `onClick`. A small SVG column layout = zero new deps.

## Implementation steps
### Phase A — Server
1. **Define the blast response contract** — `server/src/modules/blast/types.ts`
   - Change type: add
   - What: Plain TS interfaces (no DB) for the UI-ready payload:
     `BlastSymbolGroup = { file; name; kind; callers: { file; symbol; line; rank }[];
     endpoints: string[]; crons: string[] }`;
     `BlastResponse = { symbols: BlastSymbolGroup[]; totals: { symbols; callers;
     endpoints; crons }; impactedEndpoints: string[]; impactedCrons: string[];
     index: { status: IndexStatus; degraded: boolean; reason?: DegradedReason;
     lastIndexedSha: string | null }; degraded: boolean; reason?: DegradedReason }`
     and `BlastSummaryResponse = { summary: string | null; cached: boolean;
     skipped?: 'no_key' | 'no_data' }`. Import `IndexStatus`/`DegradedReason` from
     `../repo-intel/types.js`. Keep this the single source the route returns.
   - Verify: `node_modules/.bin/tsc --noEmit` (in `server/`) passes; type is imported by `service.ts`.
2. **Write the response-shaping service** — `server/src/modules/blast/service.ts`
   - Change type: add
   - What: `class BlastService { constructor(private container: Container) {} }` with
     `async getBlast(workspaceId, prId): Promise<BlastResponse>`:
     (a) resolve the PR row by `(workspaceId, prId)` and its repo (mirror
     `pulls/routes.ts:209-222`); throw `NotFoundError` when absent;
     (b) read changed files from persisted `pr_files` — `container.db.select({path:
     t.prFiles.path}).from(t.prFiles).where(eq(t.prFiles.prId, pr.id))` (the offline
     read at `pulls/routes.ts:270`); `changedFiles = rows.map(r => r.path)`;
     (c) call `container.repoIntel.getBlastRadius(pr.repoId, changedFiles)` and
     `container.repoIntel.getIndexState(pr.repoId)` (in parallel, `Promise.all`);
     (d) **shape**: group the flat `result.callers` by `viaSymbol`; for each
     `changedSymbol`, attach its group's callers sorted by `rank` desc and capped at
     `20` (per-symbol cap; safe given the facade's global cap); attribute
     endpoints/crons by unioning `factsByFile[callerFile]` across that group's caller
     files (fall back to `result.impactedEndpoints` for the flat union); build
     `totals` and the `index` block from `IndexState`
     (`status/degraded/degradedReason/lastIndexedSha`); propagate `result.degraded`/`reason`.
     **Make ZERO model calls here.**
   - Verify: unit test (step 5) asserts grouping/cap/attribution against a mock facade.
3. **Add the optional one-call summary path** — `server/src/modules/blast/summary.service.ts`
   - Change type: add
   - What: `class BlastSummaryService` with a **module-scope** `const summaryCache =
     new Map<string, { summary: string }>()` keyed by `` `${prId}:${lastIndexedSha}` ``.
     `async getSummary(workspaceId, prId): Promise<BlastSummaryResponse>`:
     reuse `BlastService.getBlast` for the shaped data + `index.lastIndexedSha`; if no
     symbols/callers → `{ summary: null, cached: false, skipped: 'no_data' }`; on cache
     hit → return cached `{ cached: true }`; else resolve a cheap LLM via a local
     `resolveCheapLlm()` mirroring `conventions/service.ts:190` (first configured of
     openai/anthropic/openrouter + cheap model) wrapped in try/catch — when none is
     configured return `{ summary: null, cached: false, skipped: 'no_key' }` (NO error);
     otherwise make **exactly one** `llm.complete()` call rendering the blast map to a
     one-paragraph plain-English explanation, store in the cache, return it. Provider/model
     come from config/secrets only — never hardcoded.
   - Verify: unit test (step 6) proves no-key → `skipped:'no_key'` + 0 calls, and a
     second call with the same `prId+sha` → `cached:true` + still 1 total call.
4. **Register the route plugin** — `server/src/modules/blast/routes.ts` + `server/src/modules/index.ts`
   - Change type: add (`routes.ts`), modify (`index.ts`)
   - What: a default Fastify plugin (`withTypeProvider<ZodTypeProvider>()`) declaring
     `GET /pulls/:id/blast` and `GET /pulls/:id/blast/summary`, both `{ schema: { params:
     IdParams } }` (shared `IdParams`, uuid). Each handler does
     `const { workspaceId } = await getContext(container, req)` then delegates to
     `new BlastService(container).getBlast(...)` / `new BlastSummaryService(...).getSummary(...)`.
     No hand-rolled parsing. In `modules/index.ts` add `import blast from './blast/routes.js'`
     and a `blast` entry in the `modules` map (alongside `repoIntel`).
   - Verify: `node_modules/.bin/tsc --noEmit`; route appears in the app's route tree
     (the `.it.test.ts` in step 5 hits it for 200).
5. **Unit + integration tests** — `server/src/modules/blast/service.test.ts` (hermetic)
   + `server/test/blast-routes.it.test.ts` (DB-backed)
   - Change type: add
   - What: *Hermetic* — construct a `Container` with `overrides.repoIntel` = a mock
     returning a hand-built `BlastResult` (≥1 changed symbol, ≥2 callers across files,
     `factsByFile` with ≥1 endpoint + ≥1 cron) and assert the shaped output: callers
     grouped under the right symbol, rank-desc order, per-symbol cap 20, endpoints/crons
     attributed per symbol + flat union, and `index` mirrors the mocked `IndexState`.
     *Integration* (`*.it.test.ts`, testcontainers; mirror an existing
     `server/test/*.it.test.ts` harness) — seed a workspace + repo + PR + `pr_files`,
     inject a mock `repoIntel`, build the app, `GET /pulls/:id/blast` → 200 with the
     grouped shape; assert the mock facade's `getBlastRadius` was called and **no
     `container.llm` provider was constructed** on this path.
   - Verify: `node_modules/.bin/vitest run blast` (hermetic) and
     `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run blast-routes.it`
     (DB-backed) both green.
6. **Summary endpoint test** — `server/src/modules/blast/summary.service.test.ts` (hermetic)
   - Change type: add
   - What: with **no LLM override and no key**, `getSummary` → `skipped:'no_key'`,
     `summary:null`, and zero `complete` calls; with an injected mock `LLMProvider`,
     first call returns a string + `cached:false` and the mock's `complete` is invoked
     **once**, a second call with the same `prId+sha` returns `cached:true` with the
     `complete` count still **1**.
   - Verify: `node_modules/.bin/vitest run blast` green; assertion on the mock call count.
7. **Server typecheck gate** — (no file)
   - Change type: verify-only
   - What: ensure the new module compiles against the facade contract and shared schema.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` exits 0.

### Phase B — Client
8. **Mirror the response types** — `client/src/lib/types.ts`
   - Change type: modify
   - What: add hand-mirrored TS interfaces `BlastResponse`, `BlastSymbolGroup`,
     `BlastSummaryResponse` matching Phase A step 1 (the response is a new shape, not
     in vendored shared contracts — mirror it client-side, consistent with the existing
     `feature-models.ts` hand-mirror noted in root INSIGHTS). Reuse the already-exported
     `IndexStatus` type for `index.status`.
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` passes; hook (step 9) imports them.
9. **Add the data hooks** — `client/src/lib/hooks/blast.ts` (+ re-export in `lib/hooks/index.ts`)
   - Change type: add (`blast.ts`), modify (`index.ts`)
   - What: `useBlastRadius(prId)` → `useQuery({ queryKey: ['blast', prId], queryFn: () =>
     api.get<BlastResponse>(\`/pulls/${prId}/blast\`), enabled: prId != null })`
     (mirror `hooks/brief.ts` `useRisks`). `useBlastSummary(prId, { enabled })` →
     `useQuery({ queryKey: ['blast-summary', prId], queryFn: () =>
     api.get<BlastSummaryResponse>(\`/pulls/${prId}/blast/summary\`), enabled })` so the
     single LLM call only fires when the user opts in (button/disclosure), never on
     panel mount. Re-export both from `lib/hooks/index.ts` if that barrel exists.
   - Verify: `node_modules/.bin/tsc --noEmit`; component test (step 13) drives them via mocked `fetch`.
10. **Add the caller blob-URL helper** — `client/src/lib/github-urls.ts`
    - Change type: modify
    - What: add a thin `blastCallerUrl(repoFullName: string, indexedSha: string | null,
      file: string, line: number): string | null` that returns `null` when
      `repoFullName`/`indexedSha` is missing, else delegates to the existing
      `githubBlobUrl(repoFullName, indexedSha, file, line)`. **Use the indexed SHA**
      (`index.lastIndexedSha`), not the PR head SHA: callers usually live in files
      **outside** the PR diff and their `line` numbers come from the index, so only the
      indexed commit makes `#L{line}` accurate (justification per locked decision #4).
      `githubPrFileUrl` is deliberately not used — it resolves into the PR "Files changed"
      view, which won't contain these caller files.
    - Verify: `node_modules/.bin/tsc --noEmit`; unit assertion in the component test that a
      caller link href is `.../blob/{sha}/{file}#L{line}`.
11. **Build the BlastRadius panel (Tree + toggle + states)** —
    `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadius/BlastRadius.tsx`
    (+ `index.ts`, `styles.ts`)
    - Change type: add
    - What: `<section>` with `SectionLabel` (match `IntentCard`), a header summary line
      "N symbols · N callers · N endpoints · N cron" (from `totals`, strings from
      `blast.stat.*` in `messages/en/blast.json`), and a Tree | Graph toggle
      (`blast.view.tree`/`blast.view.graph`, Tree default). **Tree** renders collapsible
      levels: changed symbol → callers (`file:line`, each an `<a>` to `blastCallerUrl(...)`
      opening in a new tab) → endpoint/cron badges. **States**: when `totals.symbols === 0`
      or no callers → explicit empty state (reuse/extend `blast.noDownstream`); when
      `index.degraded` (or `response.degraded`) → a badge "Index degraded — results may be
      incomplete" (new `blast.degraded.*` keys). Optional summary: a disclosure/button that
      enables `useBlastSummary`; render the paragraph when present, hide cleanly when
      `summary === null` (no error UI for `skipped:'no_key'`). Panel receives
      `prId` + `repoFullName` as props.
    - Verify: `node_modules/.bin/tsc --noEmit`; component test (step 13) asserts header
      counts, tree rows, caller href, empty + degraded rendering.
12. **Build the Graph view** —
    `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadius/BlastGraph.tsx`
    - Change type: add
    - What: a hand-rolled, dependency-free SVG hierarchical node-link view: three columns
      (changed symbol → caller nodes → endpoint/cron nodes), nodes positioned by simple
      row math, connectors as SVG `<path>`/`<line>`; caller nodes are `<a>`/clickable to
      the same `blastCallerUrl`. Use `blast.graph.ariaLabel`/`blast.graph.empty`. No new
      npm dependency (confirmed none present in `client/package.json`).
    - Verify: `node_modules/.bin/tsc --noEmit`; component test toggles to Graph and asserts
      an `svg[aria-label]` plus the empty-graph message when there are no callers.
13. **Wire the panel into Overview + thread repoFullName** —
    `_components/OverviewTab/OverviewTab.tsx` and the page `.../pulls/[number]/page.tsx`
    - Change type: modify
    - What: in `page.tsx`, pass the existing `repoFullName` (already computed at line 94)
      into `<OverviewTab ... repoFullName={repoFullName} />`; extend `OverviewTab` props
      with `repoFullName` and render `<BlastRadius prId={prId} repoFullName={repoFullName} />`
      next to `IntentCard`/`RisksCard`.
    - Verify: `node_modules/.bin/tsc --noEmit`; manual `pnpm dev` shows the panel on the
      Overview tab.
14. **i18n strings** — `client/messages/en/blast.json`
    - Change type: modify
    - What: extend the pre-stubbed file (already has `stat`, `view`, `graph`,
      `noDownstream`, `callerCount`) with `degraded.badge`/`degraded.explain`,
      `summary.show`/`summary.loading`/`summary.empty`, and `clickToCode.aria`. The
      `i18n/request.ts` loader auto-merges every `messages/en/*.json` by filename — no
      registration needed.
    - Verify: `node_modules/.bin/tsc --noEmit`; no missing-message warnings at runtime.
15. **Component tests** —
    `_components/BlastRadius/BlastRadius.test.tsx` (+ `BlastGraph.test.tsx`)
    - Change type: add
    - What: RTL + Vitest (jsdom, `fetch` mocked per `client/CLAUDE.md`). Cover: (a) tree
      renders grouped symbol → callers → endpoint/cron badges with correct header counts;
      (b) a caller link's `href` is the blob URL at the indexed SHA with `#L{line}`;
      (c) empty state when `totals.symbols === 0`; (d) degraded badge when
      `index.degraded`; (e) toggle to Graph renders the SVG; (f) summary disclosure stays
      empty/clean when the summary response is `{ summary: null, skipped: 'no_key' }`.
    - Verify: `cd client && node_modules/.bin/vitest run BlastRadius` green.
16. **Feature documentation** — `docs/architecture.md` (or `server/src/modules/blast/README.md`)
    - Change type: modify (architecture.md) or add (module README)
    - What: the second required markdown doc — a short feature write-up: the
      `GET /pulls/:id/blast` + `/blast/summary` contract, the "reads only through the
      `repoIntel` facade, zero AI on the core path" guarantee, the Overview-panel
      placement, and the indexed-SHA blob-link rationale. (This plan is the first doc;
      this step produces the second.)
    - Verify: file exists and links the route + facade method names; reviewer can follow
      it end to end.
17. **Client typecheck gate** — (no file)
    - Change type: verify-only
    - Verify: `cd client && node_modules/.bin/tsc --noEmit` exits 0.

## Acceptance criteria
Map each product criterion to a concrete check:
- **Grouped, facade-only, zero-AI core read** — `GET /pulls/:id/blast` returns
  `symbols[] → callers[] → endpoints/crons` + `index` block. Verified by
  `blast-routes.it.test.ts` (200 + grouped shape) and the hermetic
  `service.test.ts` asserting grouping/cap/attribution; the it-test asserts the LLM
  provider is never constructed on this path. Run:
  `cd server && node_modules/.bin/vitest run blast` and
  `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run blast-routes.it`.
- **Fast core read** — success criterion: the request does only facade reads (the
  persistent path is pure Postgres, no clone parsing) and makes zero model calls;
  asserted by the it-test (no `llm` construction) and by the absence of any
  clone/parse call in `BlastService`.
- **Demo PR parity (≥2 callers, ≥1 endpoint)** — on a seeded/demo PR that changes a
  shared helper, the response shows a symbol group with ≥2 callers and ≥1 endpoint;
  asserted in the it-test fixture and visible in the Overview panel via `pnpm dev`.
- **Click-to-code** — a caller `file:line` opens `https://github.com/{owner}/{repo}/
  blob/{indexedSha}/{path}#L{line}` in a new tab; asserted by `BlastRadius.test.tsx`
  on the link `href`.
- **Honest empty / degraded states** — empty state when `totals.symbols === 0`;
  degraded badge when `index.degraded`/`response.degraded`; both asserted in
  `BlastRadius.test.tsx`.
- **Optional summary: ≤1 call, cached, clean no-op** — `summary.service.test.ts`
  proves no-key → `skipped:'no_key'` + 0 calls; first call = 1 `complete`; repeat with
  same `prId+sha` = `cached:true`, still 1 call total.
- **Two markdown docs** — this plan (`docs/plans/blast-radius.md`) plus the feature
  doc from step 16 both exist.
- **Global gates** — `cd server && node_modules/.bin/tsc --noEmit` and
  `cd client && node_modules/.bin/tsc --noEmit` both exit 0.

## Risks / out of scope / open questions
- **Risks**
  - *Facade global caller cap.* `tryPersistentBlast` already does
    `callers.slice(0, MAX_CALLERS_PER_SYMBOL=20)` as a **global** cap, so the blast
    module receives ≤20 callers total on the persistent path. Our per-symbol cap of 20
    is therefore an upper bound that is effectively never binding today — a PR touching
    many symbols may show fewer callers per symbol than 20. Lifting this would require a
    facade change (out of scope: we read only through the facade). Flag in the panel
    copy if needed.
  - *`pr_files` must be populated.* `getBlast` reads changed files from persisted
    `pr_files`, which the PR detail endpoint fills. In the normal UI flow the page calls
    `usePullDetail` (populating `pr_files`) before the Overview panel renders, so the
    ordering holds; but a direct API hit on a never-opened PR with no GitHub token could
    see empty `pr_files` → empty blast. Treated as a legitimate empty state, not an error.
  - *In-memory summary cache* is per-process and lost on restart / not shared across the
    API + MCP processes. Acceptable for local-first single-user; documented tradeoff vs a
    migration-backed table (which CLAUDE.md and the "don't add tables casually" rule
    discourage).
  - *Hand-mirrored response types* (`client/src/lib/types.ts`) can drift from the server
    interface; keep them adjacent in the PR and covered by the component test fixtures.
- **Out of scope**
  - No changes to `repo-intel` indexing, the facade, vendored shared contracts
    (`*/src/vendor/shared`), existing migrations, or unused tables.
  - No new DB table/migration; no auth (local-first, no route auth per root CLAUDE.md).
  - No change to the MCP `get-blast-radius` stub.
- **Open questions / assumptions**
  - *Crons surfaced separately:* `BlastResult.factsByFile` carries `crons`, and the
    `blast.json` stat keys include `crons`, but `BlastResult.impactedEndpoints` is the
    only flat union the facade exposes (no `impactedCrons`). Assumption: derive a flat
    cron union in `BlastService` by unioning `factsByFile[*].crons` (degraded ripgrep
    path has no `factsByFile`, so crons are simply empty there).
  - *Summary model choice:* assumes routing through the `resolveCheapLlm` first-configured
    pattern (mirrors `conventions/service.ts`) rather than reusing the `review_intent`
    slot, to avoid coupling blast to an unrelated feature's model and to stay
    secrets-driven. Either is config-driven; flagged here so it can be re-decided cheaply.
  - *Feature-doc location:* assumes the second doc lives at
    `server/src/modules/blast/README.md` (module-local, matching `repo-intel/README.md`)
    unless the team prefers a section in `docs/architecture.md`.
