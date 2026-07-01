# Plan: Blast Radius "0 everything" + missing PR-score badge

> Follow-up to `blast-radius-fixes.md`. That pass landed the design-fidelity
> visuals (collapsible tree, stat icons, badge/toggle restyle) and an honest
> *partial-index* badge, but **explicitly deferred** the issues reported here:
> the all-zero data state, the empty graph, and the PR-SCORE gauge. This plan
> closes those.

## Reported symptoms (calcom/cal.diy PR #29654)
1. Tree view lists 22 changed symbols, **every one "0 callers"**, with no
   degraded/partial badge.
2. Stat row reads **0 callers · 0 endpoints · 0 cron** — even though the changed
   files are literally `apps/web/app/api/cron/**/route.ts`.
3. The **Graph** toggle shows "No downstream callers to graph."
4. **No score badge** anywhere on the Overview (Intent area).

## How the design was verified
The design file is a `__bundler` HTML: component source is gzip+base64 in a
`<script type="__bundler/manifest">`. Decoded it and read the real components:
- `screen_pr_detail.jsx` (`BriefCard`, `IntentBlock`, `RiskPillRow`, `HistoryAccordion`).
- `blast.jsx` (`BlastRadius`, tree + graph).
- `findings.jsx` (`VerdictBanner` → `CircularScore` "PR SCORE").
- `data.jsx` (mock `VERDICT.score = 61`, `INTENT`, `BLAST`).

**Design layout of the Overview ("PR Brief"):** a `VerdictBanner` (verdict pill +
summary + findings/blockers badge + **CircularScore "PR SCORE"** + cost) on top,
then a **2-column grid** — left card = `Intent` + `Risk areas` (pill row), right
card = `Blast radius` + `HistoryAccordion`.

---

## Root causes (grounded)

### A. "0 callers" is *technically correct* for this PR — and that's the trap
`tryPersistentBlast` (`server/src/modules/repo-intel/service.ts:336-412`) resolves
callers via `getResolvedCallers` (`repository.ts:502-531`): only `references` whose
`decl_file` resolved to a changed file **and** that come from a *different* file
(cross-file) count. The changed symbols in this PR are Next.js **App-Router route
handlers** (`GET`, `getHandler`, `handler`, `validateRequest`, …) plus same-file
helpers. Route handlers are invoked by the framework via file-based routing — never
`import`ed/called by other repo code → **0 cross-file callers**. Local helpers are
called within the same `route.ts` → excluded as same-file (`service.ts:294`,
`shapeBlastResponse` guard `service.ts:36-37`). So the all-zero tree is honest, not
broken — but it reads as broken because the panel has nothing else to show and no
degraded/partial badge fires (index is `full`).

### B. Endpoints/crons are never detected for Next.js App-Router routes
`extractEndpoints` (`adapters/codeindex/extract.ts:182-195`) only matches
Express/Fastify shapes: `app.get('/x')`, `router.post(...)`, `route({method,url})`.
cal.com uses **`export async function GET(req)` in `route.ts`**, where the path is
derived from the *file path* (`app/api/cron/foo/route.ts` → `/api/cron/foo`). No
regex matches it → `file_facts.endpoints` is empty for these files.
`extractCrons` (`extract.ts:202-214`) matches `cron.schedule('* * * * *')` /
`register('kind')`; a cron *route* under `/api/cron/**` has none → no cron facts.
→ **0 endpoints, 0 cron** even though these are exactly cron HTTP endpoints.

### C. Facts are attributed to *caller* files, never the changed files
Even if B were fixed, `tryPersistentBlast` reads facts via
`getFileFacts(repoId, callerFiles)` (`service.ts:397`, `repository.ts:534-549`) —
**caller files only**. For a route-handler PR the changed file *is* the endpoint and
has 0 callers → `callerFiles` is empty → facts never read → still 0 endpoints/crons.
The whole attribution model assumes "changed symbol → callers → the callers' files
expose endpoints" (true for middleware like the design's `rateLimit`), and silently
drops the "the changed file is itself the endpoint" case.

### D. The graph renders nothing when there are no callers/endpoints
`BlastGraph` (`BlastRadius/BlastGraph.tsx:53-69`) early-returns the empty message
when `callers.length === 0 && rightNodes.length === 0`. It never draws the
changed-symbol column on its own, so 22 symbols + 0 callers = a blank graph. The
toggle itself works (the screenshot shows Graph active) — it's the empty gate that
makes it look dead.

### E. The PR-SCORE badge exists but isn't on the Overview
`VerdictBanner` (`_components/VerdictBanner/VerdictBanner.tsx`) already renders
`CircularScore` + "PR SCORE", but it's only mounted inside `ReviewRunAccordion`
(Findings tab). `OverviewTab.tsx` renders `IntentCard / RisksCard / BlastRadius /
Description` — no verdict banner. The data is already on the wire: `usePrReviews`
returns reviews newest-first, each with `verdict` + `score`
(`vendor/shared/contracts/review-api.ts:30,32`).

---

## Design ↔ current differences (for completeness)
| Aspect | Design | Current |
|---|---|---|
| Score | `VerdictBanner` + `CircularScore` "PR SCORE" atop PR Brief | absent on Overview (only in Findings) |
| Grouping | "PR Brief" header + **2-col grid** (Intent+Risks \| Blast+History) | stacked full-width sections |
| Intent | italic-quoted text; **IN SCOPE** = green `Check`, **OUT OF SCOPE** = muted `X`, 2-col grid; no Recalculate | plain bullets, single column, **Recalculate** button |
| Risks | compact clickable **pill row** (icon+title → expand) | stacked detail cards (HIGH/MEDIUM badge + body) |
| Blast | tree/graph (matches) + **HistoryAccordion** "Prior PRs touching these files" below | tree/graph only, no history |

---

## Fix plan

### Tier 1 — correctness (the reported bugs)

**1. Detect Next.js App-Router endpoints + cron routes.**
`server/src/adapters/codeindex/extract.ts`
- Give `extractEndpoints(source, relPath?)` a path-aware branch: when `relPath`
  matches `**/app/**/route.{ts,tsx,js,jsx}` (or legacy `pages/api/**`), derive the
  route path from the file path (strip `app`, drop the trailing `/route.ext`,
  collapse `(group)` segments, map `[id]`→`:id`) and emit one entry per exported
  HTTP verb found (`export async function GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS`).
- `extractCrons(source, relPath?)`: when the derived path is under `/api/cron/`
  (or the file is under `app/api/cron/**`), emit a `cron:<path>` fact.
- Thread `relPath` through the one caller: `pipeline/full.ts:186-187`
  (`extractEndpoints(source)` → `extractEndpoints(source, relPath)`), and the
  ripgrep path `service.ts:314` (best-effort; pass the file).
- Verify (hermetic, no Docker): `server/test/extract-nextjs-routes.test.ts` —
  a `route.ts` with `export async function GET`/`POST` under `app/api/cron/x/`
  yields `["GET /api/cron/x","POST /api/cron/x"]` + a `cron:/api/cron/x` fact.
- **Requires a reindex** of any already-indexed repo for facts to refresh
  (`file_facts` is built at index time).

**2. Attribute the changed files' own endpoints/crons (self-facts).**
`server/src/modules/repo-intel/service.ts` + `blast/service.ts`
- In `tryPersistentBlast`, fetch facts for `changedFiles` too (union with
  `callerFiles`) and pass them through so `shapeBlastResponse` can attribute a
  changed symbol's *own* file facts to its group — not only its callers' files.
- In `shapeBlastResponse` (`blast/service.ts:41-53`), add the symbol's own
  `sym.file` facts to its `endpoints`/`crons`, and fold self-endpoints/crons into
  `impactedEndpoints`/`impactedCrons` + `totals`.
- Verify: extend `blast/service.test.ts` — a changed symbol in a file with an
  endpoint fact and **0 callers** still reports that endpoint in its group and in
  `totals.endpoints`.

**3. Graph draws the changed-symbol column even with 0 callers.**
`client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadius/BlastGraph.tsx`
- Change the empty gate (`:53-69`) to render whenever `symbols.length > 0`
  (draw the left column standalone; right/centre columns appear as data exists).
  Only show the "nothing to graph" copy when there are literally no symbols.
- Verify: `BlastGraph.test.tsx` — symbols + 0 callers renders `<rect>`/symbol
  text instead of the empty message.

**4. Honest copy for the genuine "no in-repo callers" case.**
`client/.../BlastRadius/BlastRadius.tsx` + `client/messages/en/blast.json`
- When `symbols > 0 && callers === 0` and the index is `full` (not partial/
  degraded), use copy that explains it instead of implying breakage — e.g.
  "These symbols are entry points (route handlers / exports) with no in-repo
  callers." If endpoints/crons resolved (after fix 2), lead with those.
- Verify: update the existing `noDownstream` assertion in `BlastRadius.test.tsx`.

### Tier 2 — the PR-SCORE badge (design parity, small)

**5. Surface `VerdictBanner` on the Overview.**
`client/.../_components/OverviewTab/OverviewTab.tsx` (+ pass latest review down
from `page.tsx`)
- Pass the latest review (`reviews[0]`: `verdict`, `summary`, `score`,
  finding/blocker counts) into `OverviewTab` and render `<VerdictBanner>` above
  `IntentCard` when a review exists (null/score-absent → render nothing, exactly
  like the component already guards `score != null`). No new contract/endpoint —
  reuse `usePrReviews` data already fetched in `page.tsx:40`.
- Verify: `OverviewTab` test — with a review the score gauge renders above Intent;
  with no reviews the Overview is unchanged.

### Tier 3 — broader design-fidelity (optional, larger; deferred by prior plan)
2-col PR-Brief grid, `RiskPillRow` (pills vs cards), Intent green-check/X scope
icons + drop Recalculate, and the `HistoryAccordion` ("Prior PRs touching these
files" needs net-new backend: derive from `pr_files` overlap → new query +
contract field). Recommend a separate pass once Tier 1–2 land.

## Acceptance
- Backend: `tsc --noEmit` clean; `extract-nextjs-routes.test.ts` + extended
  `blast/service.test.ts` green; after reindex, PR #29654 shows the cron endpoints
  it actually exposes (non-zero endpoints/cron).
- Frontend: `tsc --noEmit` clean; graph renders symbol nodes with 0 callers; the
  0-callers copy is honest; the PR-SCORE gauge shows on the Overview when a review
  exists. Do **not** regress the `isEmpty = !data || totals.symbols === 0` gating.

## Risks / notes
- Fix 1 changes indexer output → stale `file_facts` until a reindex; call this out
  in the PR and trigger a resync for demo repos.
- Route-path derivation is heuristic (groups `(x)`, dynamic `[id]`, catch-all
  `[...slug]`); keep it conservative and unit-tested — wrong paths are worse than
  none.
- `extractEndpoints`/`extractCrons` are also consumed by the ripgrep degraded path
  and possibly elsewhere — keep `relPath` optional so existing callers/tests don't
  break.
</content>
</invoke>
