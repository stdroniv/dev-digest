# Plan: Blast Radius "0 everything" data fixes + PR-score badge on Overview

> Builds on / supersedes the investigation in
> `docs/plans/blast-radius-correctness-and-score.md`. The prior shipped pass
> (`docs/plans/blast-radius-fixes.md`) already landed the design-fidelity visuals
> (segmented toggle, code-chip names, chevron collapse, per-symbol caller count,
> per-stat icons, `Workflow` section icon, amber cron badge), the per-symbol
> caller cap (`capCallersPerSymbol`, `server/.../repo-intel/service.ts:107`), and
> the honest "partial index" badge. **Verified present in the current code** — do
> NOT re-plan those. This plan closes the five issues that pass explicitly
> deferred: A (honest copy), B/C (endpoint/cron data), D (empty graph), E (score
> badge on Overview).

## Understanding
On a Next.js App-Router PR (e.g. `calcom/cal.diy` #29654: 22 changed symbols, all
"0 callers", 0 endpoints, 0 cron, index `full` so no degraded/partial badge fires)
the Blast Radius panel reads as broken even though "0 cross-file callers" is
technically correct for framework-invoked route handlers. The goal: (A) make the
zero-callers copy honest, (B) actually detect the endpoints/crons these `route.ts`
files expose, (C) attribute a changed file's OWN endpoint/cron facts to its symbol
(not only its callers' facts), (D) draw the changed-symbol column in the Graph view
even with zero callers, and (E) surface the existing `VerdictBanner` "PR SCORE"
gauge on the Overview tab (it currently lives only on the Findings tab). No new
DB tables, contracts, or endpoints — only an indexer-extraction change (requires a
reindex) plus shaping/UI wiring over data already on the wire.

## Context loaded
- Root `INSIGHTS.md` — run package-local `node_modules/.bin/{tsc,vitest}` (never
  `pnpm test`; the pnpm wrapper's deps precheck hard-fails); vendored shared
  contracts are hand-edited per package; `.it.test.ts` needs
  `TESTCONTAINERS_RYUK_DISABLED=true`.
- `server/INSIGHTS.md` — the exact two-gap root cause for this bug is already
  recorded ("Blast Radius reports 0 endpoints · 0 cron for Next.js App-Router
  PRs"): make `extractEndpoints`/`extractCrons` path-aware AND attribute the
  changed files' own facts, then REINDEX. Also: `shapeBlastResponse`/
  `capCallersPerSymbol` "export the pure bit for a hermetic test" seam.
- `client/INSIGHTS.md` — the BlastGraph empty-gate fix (draw left column when
  `symbols.length > 0`), the VerdictBanner-on-Overview wiring (reuse
  `usePrReviews` `reviews[0]`), the `isEmpty = !data || totals.symbols === 0`
  gating that must NOT regress, and RTL rules for this package (no
  `@testing-library/user-event` → `fireEvent`; duplicate text → `getAllByText`;
  interpolated siblings break `getByText(/whole/)`; icon names must exist in the
  vendored registry; `getNodeText` reads only direct text nodes).
- `server/CLAUDE.md`, `client/CLAUDE.md` — schema-first routes, i18n in
  `messages/`, `src/vendor/**` do-not-touch, append-only migrations.
- Source read & line-verified: `server/src/adapters/codeindex/extract.ts`
  (`extractEndpoints:182`, `extractCrons:202`), `server/src/modules/repo-intel/
  service.ts` (`tryPersistentBlast:336-412`, `getFileFacts` call `:397`, degraded
  `extractEndpoints` `:314`, `getBlastRadius:241`), `repository.ts`
  (`getResolvedCallers:502-531`, `getFileFacts:533-549`),
  `pipeline/full.ts:186-187`, `pipeline/incremental.ts:193-194`,
  `modules/blast/service.ts` (`shapeBlastResponse:30-106`, attribution `:41-53`),
  `modules/blast/types.ts`, `repo-intel/types.ts` (`BlastResult.factsByFile:84`);
  tests `server/test/extract.test.ts`, `server/src/modules/blast/service.test.ts`.
  Client: `BlastRadius.tsx`, `BlastGraph.tsx`, `BlastRadius/styles.ts`,
  `messages/en/blast.json`, `OverviewTab/OverviewTab.tsx`, `pulls/[number]/
  page.tsx` (`usePrReviews:40`), `VerdictBanner/VerdictBanner.tsx`,
  `ReviewRunAccordion.tsx:64-65,149-156` (the `findings`/`blockers` derivation to
  mirror), `vendor/shared/contracts/review-api.ts` (`ReviewRecord:23-38`),
  `messages/en/prReview.json` (`verdict.prScore:34`); tests
  `BlastRadius.test.tsx`, `BlastGraph.test.tsx`.
- Skills matched (read NONE in full — the two `INSIGHTS.md` files already encode
  the package-specific rules that actually govern these edits, which are more
  authoritative here than the generic skill text): `client-server-communication`
  (no wire change here — confirms it), `react-testing-library` (the test churn is
  the real risk; rules already in `client/INSIGHTS.md`),
  `backend-onion-architecture` (extraction stays in the adapter, shaping stays
  pure — no layering change).

## Approach & tradeoffs

**B — path-aware extraction, `relPath` OPTIONAL.** Give `extractEndpoints` and
`extractCrons` an optional second `relPath?` arg. When it identifies a Next.js
route file (`**/app/**/route.{ts,tsx,js,jsx,mjs,cjs}`, plus legacy
`**/pages/api/**`), derive the route path from the FILE path and emit one endpoint
per exported HTTP verb (`export [async] function GET|POST|PUT|PATCH|DELETE|HEAD|
OPTIONS`, also `export const GET = …`); flag `/api/cron/**` as a cron fact. Keeping
`relPath` optional means every existing caller and the whole `extract.test.ts`
back-compat suite is untouched (Express/Fastify regex path unchanged when no
`relPath`). Rejected: a separate `extractNextRoutes` function — it would duplicate
the verb scan and force every caller site to call two functions; folding the
path-aware branch into the existing two keeps the single `factsBuf` write in the
pipelines unchanged. Route-path derivation is heuristic (drop route groups
`(group)`, `[id]`→`:id`, `[...slug]`→`:slug`) so it is unit-tested and kept
conservative — a wrong path is worse than none.

**C — attribute the changed file's OWN facts.** The attribution model assumes
"changed symbol → callers → callers' files expose endpoints" (true for middleware
like the design's `rateLimit`), and silently drops "the changed file IS the
endpoint" — exactly the route-handler case (0 callers → `callerFiles` empty →
facts never read). Two minimal edits, NO contract change: (1) in `tryPersistentBlast`
fetch facts for `callerFiles ∪ changedFiles` so `BlastResult.factsByFile` and
`impactedEndpoints` already include self-facts; (2) in `shapeBlastResponse` add the
symbol's own `sym.file` facts to its group's `endpoints`/`crons`. `impactedCrons`
and `totals` derive from `factsByFile` and so update for free. Rejected: a new
`selfEndpoints` field on `BlastResult`/`BlastResponse` — unnecessary; the existing
`factsByFile` map already carries per-file facts, it was just never queried for the
changed files.

**A — honest zero-callers copy.** The current `noDownstream` string ("…no
downstream callers found.") implies breakage. Reword to explain that these symbols
are entry points/exports with no in-repo callers. Frontend + i18n only.

**D — Graph draws the left column with 0 callers.** Replace `BlastGraph`'s
`hasContent = callers.length>0 || rightNodes.length>0` gate with
`symbols.length === 0` so the empty message shows only when there are literally no
symbols; otherwise the existing three-column render draws the changed-symbol column
standalone. Minimal change; the layout math already tolerates empty caller/right
columns (`Math.max(n,1)`).

**E — VerdictBanner on the Overview.** `VerdictBanner` already exists, self-guards
`score != null`, and is mounted only in `ReviewRunAccordion` (Findings). Pass the
latest review (newest `kind==='review'` with a non-null `verdict`) from `page.tsx`
into `OverviewTab` and render `<VerdictBanner>` above `IntentCard`; render nothing
when absent. Reuse `usePrReviews` data already fetched at `page.tsx:40` — no new
endpoint/contract. Mirror `ReviewRunAccordion`'s `findings`/`blockers` derivation
(`blockers` = CRITICAL non-dismissed).

## Implementation steps

### Tier 1 — backend data (B + C): the "0 endpoints / 0 cron" fix

1. **Make `extractEndpoints`/`extractCrons` path-aware for Next.js routes** —
   `server/src/adapters/codeindex/extract.ts`
   - Change type: modify
   - What:
     - Change signatures to `extractEndpoints(content: string, relPath?: string)`
       and `extractCrons(content: string, relPath?: string)` (`:182`, `:202`).
       When `relPath` is `undefined`, behavior is byte-for-byte the current
       Express/Fastify regex path (back-compat).
     - Add a small pure helper `nextRoutePath(relPath): string | null` that returns
       a route path only for route files: match `(^|/)app/(.+)/route\.(t|j)sx?$`
       (also `.mjs/.cjs`) — and legacy `(^|/)pages/api/(.+)\.(t|j)sx?$`. Take the
       captured middle segments, drop route groups `^\(.*\)$`, map `[...x]`→`:x`,
       `[x]`→`:x`, join with `/`, prefix `/api`-or-derived `/`. Concretely for
       `app/api/cron/foo/route.ts` the segment-after-`app/` is `api/cron/foo` →
       `/api/cron/foo`. Return `null` for non-route files.
     - In `extractEndpoints`: if `relPath` yields a non-null route path, scan
       `content` for exported verbs with
       `/^\s*export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/`
       and `/^\s*export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/`,
       and `out.add(\`${verb} ${routePath}\`)` per matched verb. Still ALSO run the
       existing Express/Fastify regexes (a file can be both).
     - In `extractCrons`: if the route path starts with `/api/cron/` (or `relPath`
       is under `app/api/cron/` / `pages/api/cron/`), `out.add(\`cron:${routePath}\`)`.
       Keep the existing cron-expression/`register('kind')` detection unchanged.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` (signatures still
     satisfy all callers since the new arg is optional) + the test in step 3.

2. **Thread `relPath` through the three call sites** —
   `server/src/modules/repo-intel/pipeline/full.ts`,
   `server/src/modules/repo-intel/pipeline/incremental.ts`,
   `server/src/modules/repo-intel/service.ts`
   - Change type: modify
   - What:
     - `full.ts:186-187`: `extractEndpoints(source)` → `extractEndpoints(source, relPath)`;
       `extractCrons(source)` → `extractCrons(source, relPath)` (`relPath` already
       in scope — it's the key the symbol/ref buffers use).
     - `incremental.ts:193-194`: same change (`relPath` in scope; used at `:187`,
       `:196`). **Do not miss this file** — the prior investigation doc named only
       `full.ts`, but the incremental refresh path builds `file_facts` too, so an
       incremental update would otherwise re-write stale caller-only facts.
     - `service.ts:314` (degraded ripgrep path): `extractEndpoints(content)` →
       `extractEndpoints(content, file)` (`file` is the caller file path). Best-
       effort: this still only reads caller files, not the changed file itself —
       the persistent path (step 4) is the one that matters for #29654;
       call this out, don't expand the degraded path further.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` clean; existing
     `node_modules/.bin/vitest run test/indexer-pipeline.test.ts` still green.

3. **Unit-test the path-aware extraction (hermetic, no Docker)** —
   `server/test/extract.test.ts`
   - Change type: modify
   - What: add a `describe('extractEndpoints / extractCrons — Next.js App Router')`
     block:
     - `route.ts` at `apps/web/app/api/cron/foo/route.ts` with
       `export async function GET(req){}` + `export async function POST(req){}` →
       `extractEndpoints(src, relPath)` contains `"GET /api/cron/foo"` and
       `"POST /api/cron/foo"`; `extractCrons(src, relPath)` contains
       `"cron:/api/cron/foo"`.
     - Route group + dynamic: `app/api/(admin)/users/[id]/route.ts` with
       `export async function DELETE(){}` → `"DELETE /api/users/:id"`, and
       `extractCrons` returns NO `cron:` entry.
     - Catch-all: `app/api/webhooks/[...slug]/route.ts` with
       `export const GET = () => {}` → `"GET /api/webhooks/:slug"`.
     - Back-compat: calling `extractEndpoints(src)` WITHOUT `relPath` on the
       existing Express fixture still yields `"GET /users"` (re-assert one existing
       case to prove no regression); a `route.ts` content passed WITHOUT `relPath`
       yields no verb-derived endpoints.
   - Verify: `cd server && node_modules/.bin/vitest run test/extract.test.ts`.

4. **Attribute the changed files' OWN facts (self-facts)** —
   `server/src/modules/repo-intel/service.ts` + `server/src/modules/blast/service.ts`
   - Change type: modify
   - What:
     - `service.ts` `tryPersistentBlast`: change the facts fetch at `:397` from
       `getFileFacts(repoId, callerFiles)` to
       `getFileFacts(repoId, [...new Set([...callerFiles, ...changedFiles])])`.
       `changedFiles` is the method param. This makes `factsByFile` and the
       `endpoints` set (`:398-403`, hence `impactedEndpoints` at `:408`) include
       the route files' own facts. No other change in this method.
     - `blast/service.ts` `shapeBlastResponse` attribution loop (`:41-53`):
       change the per-symbol fact source from `callerFiles` only to
       `[...new Set([...callerFiles, sym.file])]`, so a symbol's own
       `result.factsByFile[sym.file]` endpoints/crons land in its group. The
       existing `impactedCrons` union (`:76-82`) and `totals` (`:84-89`) then pick
       up self-crons automatically — no further edit. Keep the same-file CALLER
       guard at `:37` untouched (it filters callers, not facts).
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` + the test in step 5.

5. **Extend the pure shaper test for self-facts** —
   `server/src/modules/blast/service.test.ts`
   - Change type: modify
   - What: add a `describe('shapeBlastResponse — self-facts (route handler, 0
     callers)')` case: build a `BlastResult` with one changed symbol
     `{ file: 'app/api/cron/foo/route.ts', name: 'GET', kind: 'function' }`,
     `callers: []`, `impactedEndpoints: ['GET /api/cron/foo']`,
     `factsByFile: { 'app/api/cron/foo/route.ts': { endpoints: ['GET /api/cron/foo'],
     crons: ['cron:/api/cron/foo'] } }`. Assert the `GET` group's `endpoints`
     contains `'GET /api/cron/foo'`, its `crons` contains `'cron:/api/cron/foo'`,
     and `totals.endpoints === 1`, `totals.crons === 1`. (Existing fixtures put
     facts only on caller files — never on `src/svc.ts`/`src/utils.ts` — so the new
     `sym.file` attribution does NOT change any existing assertion.)
   - Verify: `cd server && node_modules/.bin/vitest run src/modules/blast/service.test.ts`
     (all existing + new cases green).

### Tier 2 — frontend honesty (A) + empty graph (D)

6. **Honest zero-callers copy** —
   `client/messages/en/blast.json`
   - Change type: modify
   - What: change `noDownstream` (`:15`) from
     `"{count} changed symbol(s), no downstream callers found."` to
     `"{count} changed symbol(s) with no in-repo callers — e.g. route handlers, exports, or framework entry points."`
     Leave `{count}` interpolation intact. Do NOT touch `empty`/`degraded`/`partial`.
   - Verify: valid JSON — `cd client && node -e "require('./messages/en/blast.json')"`;
     consumed by step 8's assertion.

7. **Graph draws the changed-symbol column with 0 callers** —
   `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadius/BlastGraph.tsx`
   - Change type: modify
   - What: replace the empty gate at `:53-69`. Drop
     `const hasContent = callers.length > 0 || rightNodes.length > 0;` and change
     `if (!hasContent)` to `if (symbols.length === 0)` so the "No downstream
     callers to graph." message shows ONLY when there are literally no symbols.
     The existing three-column render (`:153+`) already maps `symbols`, and the
     row-height math uses `Math.max(callers.length, 1)` / `Math.max(rightNodes.length, 1)`
     so an empty centre/right column renders cleanly (no caller/right `<rect>`s,
     no edges). No other change.
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` + the test in step 8.

8. **Update Blast tests for honest copy + standalone-column graph** —
   `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadius/BlastRadius.test.tsx`
   and `.../BlastRadius/BlastGraph.test.tsx`
   - Change type: modify
   - What:
     - `BlastRadius.test.tsx` "shows the no-downstream-callers note above the tree"
       (`:300-307`): change the regex to match the new copy, e.g.
       `/2 changed symbol\(s\) with no in-repo callers/`.
     - `BlastGraph.test.tsx`: the existing "empty (no callers)" block (`:77-90`)
       uses `SYMBOLS_NO_CALLERS` which HAS one symbol — after step 7 that now
       renders an svg, not the empty message. Update it: (a) add a `NO_SYMBOLS:
       BlastSymbolGroup[] = []` fixture and assert it shows
       `"No downstream callers to graph."` and `document.querySelector("svg")` is
       null; (b) change the `SYMBOLS_NO_CALLERS` case to assert an
       `svg[aria-label]` IS rendered and the symbol name `"checkRateLimit"` appears
       (the graph renders the raw name, not `displayName()`'s parens).
   - Verify: `cd client && node_modules/.bin/vitest run BlastRadius BlastGraph`
     (matches both files) + `node_modules/.bin/tsc --noEmit`.

### Tier 3 — PR-score badge on Overview (E)

9. **Render `VerdictBanner` atop the Overview** —
   `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
   - Change type: modify
   - What:
     - Add imports: `import { VerdictBanner } from "../VerdictBanner";` and
       `import type { ReviewRecord, Verdict } from "@devdigest/shared";`.
     - Add `latestReview: ReviewRecord | null` to `OverviewTabProps` and the
       destructured params.
     - Above `<IntentCard …>` render (only when a verdict exists):
       ```tsx
       {latestReview?.verdict && (
         <VerdictBanner
           verdict={latestReview.verdict as Verdict}
           summary={latestReview.summary}
           score={latestReview.score}
           findingsCount={latestReview.findings.length}
           blockers={latestReview.findings.filter(
             (f) => f.severity === "CRITICAL" && !f.dismissed_at,
           ).length}
           agentName={latestReview.agent_name}
         />
       )}
       ```
       This mirrors `ReviewRunAccordion.tsx:64-65,149-156` exactly. The gauge
       itself only appears when `score != null` (VerdictBanner self-guard).
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` + the test in step 11.

10. **Pass the latest review from the page** —
    `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`
    - Change type: modify
    - What: after `const { data: reviews, … } = usePrReviews(prId);` (`:40`) /
      near the existing `const runs = reviews ?? [];` (`:83`), add
      `const latestReview = (reviews ?? []).find((r) => r.kind === "review" && r.verdict != null) ?? null;`
      (reviews are newest-first, so `.find` gives the newest reviewed run). Pass it
      into the Overview render at `:149`:
      `{tab === "overview" && <OverviewTab prBody={pr.body} prId={prId} repoFullName={repoFullName} latestReview={latestReview} />}`.
    - Verify: `cd client && node_modules/.bin/tsc --noEmit`.

11. **Test the Overview score badge (new file)** —
    `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.test.tsx`
    - Change type: add
    - What: render `<OverviewTab>` wrapped in `QueryClientProvider` +
      `NextIntlClientProvider locale="en" messages={{ brief, blast, prReview }}`
      (import `messages/en/{brief,blast,prReview}.json` — `brief` for Intent/Risks
      cards, `blast` for BlastRadius, `prReview` for VerdictBanner). Mock
      `global.fetch` to resolve `null`/benign JSON for any URL (intent → null,
      risks → null, blast → an empty-symbols payload, summary not fetched) so the
      child cards render their empty states without throwing.
      - Case 1: pass `latestReview` with `kind:"review"`, `verdict:"comment"`,
        `score:61`, `summary:"…"`, `findings:[]`. Assert `getByText("PR SCORE")`
        and `getByText("61")` render.
      - Case 2: pass `latestReview={null}`. Assert
        `queryByText("PR SCORE")` is `null`.
    - Verify: `cd client && node_modules/.bin/vitest run OverviewTab`.

## Acceptance criteria

- **Backend gate (`server/`):**
  - `node_modules/.bin/tsc --noEmit` clean.
  - `node_modules/.bin/vitest run test/extract.test.ts` green — Next.js route
    cases produce `"GET /api/cron/foo"` / `"POST /api/cron/foo"` /
    `"cron:/api/cron/foo"`, route groups + `[id]`/`[...slug]` map correctly, and
    the no-`relPath` Express cases are unchanged.
  - `node_modules/.bin/vitest run src/modules/blast/service.test.ts` green — a
    changed symbol whose OWN file has endpoint/cron facts and **0 callers** still
    reports them in its group and in `totals.endpoints`/`totals.crons`; all prior
    cases stay green.
  - `node_modules/.bin/vitest run test/indexer-pipeline.test.ts` and the existing
    `test/repo-intel-blast-cap.test.ts` still pass.
- **Frontend gate (`client/`):**
  - `node_modules/.bin/tsc --noEmit` clean.
  - `node_modules/.bin/vitest run BlastRadius BlastGraph OverviewTab` green —
    specifically: the honest no-in-repo-callers note renders; the Graph view shows
    an `svg[aria-label]` (changed-symbol column) when symbols exist with 0 callers,
    and the empty message only when there are no symbols; the Overview shows
    "PR SCORE" + the numeric score when a review exists and nothing when it does
    not. The `isEmpty = !data || totals.symbols === 0` gating is NOT regressed
    (the partial/no-callers tree still renders).
- **Whole feature (manual, requires a REINDEX):** the extraction change rebuilds
  `file_facts` only on (re)index — `cd server && pnpm db:migrate` is not needed (no
  schema change), but the demo/target repo must be re-indexed (Refresh / resync)
  for facts to refresh. After reindex, on a Next.js App-Router PR
  (`apps/web/app/api/cron/**/route.ts`): the stat row shows non-zero
  endpoints/cron, the per-symbol rows show `Globe`/`Clock` badges, the Graph view
  draws the symbol column, the zero-callers note reads honestly, and — when a
  review exists — the PR SCORE gauge sits atop the Overview.

## Risks / out of scope / open questions

- **Risks:**
  - **Stale `file_facts` until reindex.** Facts are built at index time; the B/C
    fixes have NO effect on already-indexed repos until a Refresh/resync. Call this
    out in the PR and trigger a resync for demo/target repos. This is the single
    biggest "looks like it didn't work" trap.
  - **Heuristic route-path derivation.** Groups `(x)`, dynamic `[id]`, catch-all
    `[...slug]` are conventions, not guarantees; a wrong derived path is worse than
    none. Keep the matcher conservative and rely on the step-3 unit tests; return
    `null` (no endpoint) rather than guessing for shapes not covered.
  - **`incremental.ts` must be threaded too** (step 2) — missing it would let an
    incremental refresh overwrite freshly-correct facts with caller-only facts.
  - **Client test churn.** Per `client/INSIGHTS.md`: no `@testing-library/user-event`
    (use `fireEvent`); "2 callers" / duplicate strings need `getAllByText`; the
    BlastGraph empty-state tests are inverted by step 7 and MUST be updated, not
    left asserting the old behavior. Don't regress the `isEmpty` gating.
  - **Verb regex precision.** Match only top-of-line `export … GET|POST|…` to avoid
    treating a local `const GET = …` or a re-export from a non-route file as an
    endpoint; the `relPath` route-file guard already scopes this, but keep the
    anchored `^\s*export` form.
- **Out of scope (deferred — do NOT build here):**
  - The broader 2-column "PR Brief" redesign, the cost card, and any page-level
    layout regrouping.
  - `RiskPillRow` (pills vs the current detail cards) and the Intent green-check /
    X scope icons / dropping the Recalculate button.
  - The `HistoryAccordion` "Prior PRs touching these files (N)" — needs net-new
    backend (derive from `pr_files` overlap → new query + contract field + likely a
    new index); explicitly deferred to a separate pass.
  - Degraded ripgrep path self-fact surfacing (only `relPath` threading is done in
    step 2; the degraded path still reads caller files only).
- **Open questions / assumptions:**
  - *Assumption:* the cron-fact string format `cron:<path>` is acceptable to the
    UI — the client renders cron facts as free-text badges (`group.crons.map`),
    so any stable string works; chosen to mirror the existing `job:<kind>` shape.
  - *Assumption:* "latest review for the Overview" = newest `kind==='review'` with
    a non-null `verdict` (multi-agent PRs have several review rows; newest-first
    `.find` matches the Findings tab's top accordion). If the product later wants a
    specific agent's verdict on the Overview, this is the one line to change
    (`page.tsx` `latestReview`).
  - *Assumption:* no shared-contract edit is needed — `BlastResult.factsByFile`
    already carries per-file facts and `ReviewRecord` already exposes
    `verdict`/`summary`/`score`/`findings`; verified in
    `repo-intel/types.ts:84` and `vendor/shared/contracts/review-api.ts:23-38`.
