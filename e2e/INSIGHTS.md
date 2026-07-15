# e2e — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module (`@devdigest/e2e`).
Managed by the `engineering-insights` skill. Add each entry under one section; keep
it actionable cold; never edit or delete existing entries.

## What Works

- The `/ci-runs` unbounded-refetch bug documented below (inline, non-memoized `since`/`filters`) is
  **fixed** as of the CI Runs product-bug pass: `CiRunsPage.tsx` now wraps `since` in
  `React.useMemo(() => sinceFor(dateRange), [dateRange])` and the whole `filters` object in a second
  `useMemo` keyed on `[agentId, repo, status, source, since]`, so `useCiRuns(filters)`'s query key is
  referentially stable across renders unless a real filter input changed. Regression-guarded by a new
  RTL test in `client/src/app/ci-runs/_components/CiRunsPage/CiRunsPage.test.tsx` ("passes a
  referentially-stable `filters` object (and `since`) to useCiRuns across re-renders") that captures the
  `filters` arg on the first `useCiRuns` mock call, forces a second render via RTL `rerender`, and
  asserts `toBe` (reference) equality — verified this test FAILS against the pre-fix inline computation
  (different `since` timestamps a few ms apart) and PASSES after the memoization. `09-ci-export.flow.json`
  now reliably clears the CI Runs step (page header, all 8 rendered column headers, seeded rows across
  succeeded/failed/running statuses) — confirmed in a clean `9/9 flows passed` hermetic run.

## What Doesn't Work

- `/ci-runs` cannot be flow-tested as written (SPEC-05 T13): `CiRunsPage.tsx` computes `sinceFor(dateRange)` inline in the component body (not `useMemo`'d) and threads the fresh, millisecond-precision result into `useCiRuns(filters)`'s query key. Every render — including the one caused by the query's own fetch settling — produces a new `since` value, so React Query treats it as a brand-new query and re-fetches immediately, forever. Confirmed via a rate-limit-disabled (`NODE_ENV=test LOG_LEVEL=info`) diagnostic API: **~14,000 `GET /ci-runs` requests logged within a couple of seconds** of opening the page — an unbounded synchronous request loop, not a polling interval. With the real global rate limiter on (120 req/min, `server/src/app.ts`), the page exhausts the budget within ~1s of mount and then never recovers (each 429 → error-state re-render → new `since` → new query → another 429, forever) — and because the limiter is global (not per-route), this also starves every other API call for the rest of that session. This is a **product bug in `client/src/app/ci-runs/_components/CiRunsPage/CiRunsPage.tsx`** (compute/memoize `since` once per `dateRange` change, not per render) — out of e2e's owned paths to fix. Until fixed, any flow that opens `/ci-runs` and waits on its data will fail/timeout, and — because the rate limiter is global — will also break every subsequent step in the same browser session that hits the API.

- Don't assert icon+number UI (e.g. the severity FINDINGS counters from `FindingsCounts`) with `wait --text "<digit>"` — a bare "1"/"2" matches incidental text anywhere on the page and is non-deterministic. agent-browser matches visible DOM text only (NOT `aria-label`), so the counters carry no stable text anchor. Assert instead on a stable nearby label (e.g. the PR-list `wait --text "Findings"` column header in `04-pr-findings.flow.json`) and leave the exact numeric values to the server integration + client component tests.

- `agent-browser` (verified v0.29.1) matches the **CSS-RENDERED** text, so a label styled `text-transform: uppercase` is matched in its UPPERCASE form — `wait --text "Cost"` / `"Findings"` FAIL against a header that renders as `COST` / `FINDINGS`. The vendored `SectionLabel` and the PR-list column headers use `text-transform: uppercase`, which is exactly why `02-repo-pulls-detail` (`wait --text "Cost"`) and `04-pr-findings` (`wait --text "Findings"`) fail locally on this binary version (confirmed: they fail identically on a clean `main` with the feature stashed — NOT a regression; CI may pin an older agent-browser that matched DOM text). Fix for new flows: assert on case-stable content — a `MetricCard` label (not transformed, e.g. `"Used by"`), an entity name (`"Performance Reviewer"`), a link (`"Open"`), or a lowercase donut-legend category (`"security"`) — NOT a `SectionLabel` heading. Pattern: `08-skill-stats.flow.json` deliberately avoids "Agents using this skill" / "Findings by category".

- agent-browser `wait --text` is CASE-SENSITIVE (corollary of matching rendered text): `"Cost"` does not match rendered `COST`. When in doubt about a label's casing, match a substring you can see verbatim in the running UI rather than the source-string casing.

- `next dev` under `./scripts/e2e.sh` occasionally throws a transient
  `MODULE_NOT_FOUND: Cannot find module './vendor-chunks/<pkg>.js'` (`webpack-runtime.js` requiring a
  chunk a background `static-paths-worker` hasn't finished writing yet) on the FIRST navigation to a
  freshly-compiling route, producing a one-off 404/500 before Next serves the real page on the next
  request. Observed on `/agents/[id]` (unrelated to any product code — reproduces on an untouched
  route) in one hermetic run, then did NOT reproduce on an immediate re-run with a clean `client/.next`.
  Separately, a DIFFERENT run in the same session failed elsewhere on a `find text ... click` race
  (already covered by the "filter the list… avoids a scroll" pattern below) — different flow, different
  step, same theme: a `next dev`/click-timing hiccup, not a real regression. If a flow fails on a step
  UNRELATED to the product code you just changed, `rm -rf client/.next` and re-run once before treating
  it as a real bug — both failures cleared on retry with **0 code changes**.

## Codebase Patterns

- Running `./scripts/e2e.sh` (or its equivalent commands by hand) while another worktree/checkout already has its OWN hermetic e2e stack up will collide on the default alt ports/container name (`E2E_PG_PORT=5433`, `E2E_API_PORT=3101`, `E2E_WEB_PORT=3100`, `E2E_PG_CONTAINER=devdigest-e2e-postgres`) — `docker ps`/`lsof -nP -iTCP:<port> -sTCP:LISTEN` first, and if occupied, pick a *different* set of alt ports/container name (e.g. `E2E_PG_PORT=5434 E2E_API_PORT=3111 E2E_WEB_PORT=3110 E2E_PG_CONTAINER=devdigest-e2e-postgres-<suffix>`) rather than reusing the script's defaults or touching the ports/container another session is using.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
