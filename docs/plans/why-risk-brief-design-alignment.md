# Implementation Plan: Why+Risk Brief — Design Alignment

> **Supersedes the stale plan** `docs/plans/why-risk-brief.md`, which was written against an
> earlier SPEC-03 that diverged from the authoritative design. This plan realigns the *existing*
> implementation to the corrected, approved `specs/SPEC-03-2026-07-02-why-risk-brief.md`. Do NOT
> follow the old plan.

## Overview

This is a **design-alignment refactor**, not a greenfield build. The Why+Risk Brief was already
implemented as a standalone card; the corrected SPEC-03 dissolves that card and weaves its content
into the PR Brief Overview surface's existing regions: the brief's *what/why* becomes the PR Brief
**header** summary prose, its risk display defers to the pre-existing severity-based **Risk Areas**,
and its *review-focus* becomes a standalone **"read these first"** section in the right column. The
work is **client-only** for this pass, plus a clearly-marked mock stub for the review-focus items
(the contract lacks the `line`/reason fields the design needs — real data is an explicit deferred
follow-up).

## Execution mode

**single-agent (one pass)** — user-confirmed. The change is small and tightly coupled through
`OverviewTab.tsx`, which is the orchestration hub: it owns the single `useWhyRiskBrief` read, feeds
the header summary precedence, threads `repoFullName`/`prNumber` into `IntentCard`, mounts the new
`ReviewFocus` section, and drops `PrBriefCard`. Under multi-agent, `OverviewTab.tsx` /
`OverviewTab.test.tsx` would be a high-overlap Owned path and the parallelism gains are marginal, so
one ordered pass is cleaner. Tasks below still declare a dependency DAG and disjoint Owned paths so
the ordering is explicit and resumable.

## Requirements (verified)

Every requirement is restated from the confirmed scope and mapped to its SPEC-03 acceptance criteria
and owning task(s). Presentation-facing ACs (AC-2, AC-3, AC-7, AC-8, AC-17, AC-18, AC-19, AC-20,
AC-21, AC-25, AC-31) are the focus of this pass; the generation/grounding/caching ACs (AC-1 shape,
AC-4/5/6/9–16, AC-22–30, AC-32–36) are already satisfied by the existing backend + contract and are
**not** re-touched here. **AC-21 (stale indication) and AC-31 (docs-truncated indication) are display
ACs the old card rendered — they are retained and re-homed into the PR Brief header (T1), not
dropped.**

- **R1 — Remove the standalone Why+Risk Brief card.** Delete the `PrBriefCard/` component, its
  mount in `OverviewTab.tsx`, and its tests. Its `what`/`why`/`risks`/`review_focus`/regenerate no
  longer render as a card. → SPEC-03 Non-goals ("Not a standalone card"), AC-17 (no in-place
  regenerate control). → T4 (unmount), T5 (delete).
- **R2 — PR Brief header (VerdictBanner).** (a) Remove the agent-name label/chip from the PR Brief
  header. (b) When a brief is `ready`, the brief's `what`/`why` **replaces** the review's own summary
  as the header prose (`what` primary line, `why` secondary line); while no brief exists (or the
  brief query is still loading), show the review's own summary. (c) The header renders whenever a
  completed review exists — independent of the brief. (d) When the `ready` brief is `stale`, show a
  **stale / may-be-out-of-date** indication in the header (AC-21); when the `ready` brief has
  `docs_truncated`, show a subtle **docs-context-incomplete** note near the header prose (AC-31).
  Both are display-only, tied to the `ready` state, with no regenerate control (AC-17). → AC-2, AC-3,
  AC-17 (stale-display clause), AC-19(b/c), AC-20, AC-21, AC-31. → T1 (VerdictBanner renders all four),
  T4 (OverviewTab precedence + threads `stale`/`docs_truncated` + drops `agentName`).
- **R3 — Risk Areas references always-visible clickable links.** In `RiskAreas.tsx` (inside the
  Intent card), drop the click-accordion: always show each risk's title and render its `file_refs`
  as always-visible clickable links to the repo file at `path:line` (`MonoLink` + `githubPrFileUrl`,
  parsing the path portion out of the `path:line` string for the URL). Keep the longer risk
  `explanation` as a hover tooltip (native `title` / `aria-label`) — preserving a "different on
  hover" affordance without a click reveal. Thread `repoFullName` + `prNumber` down through
  `IntentCard` (today `prId`-only) from `OverviewTab`. → AC-7, AC-8. → T2, T4 (threads props).
- **R4 — New "Review focus — read these first" section (STUBBED).** A standalone section in the
  RIGHT column, below Prior PRs: an ordered/prioritized list with a visible count badge; each item
  shows `path:line — <short reason>` as a clickable link. **The current contract
  `WhyRiskFocusItem = { path }` lacks `line` and a reason, and the backend does not produce them, so
  this pass renders a clearly-marked module-level MOCK array of `{ path, line, reason }`** (count
  badge = mock length; each item a `MonoLink` to `githubPrFileUrl(repoFullName, prNumber, path)`).
  Real data is an explicit OUT-OF-SCOPE follow-up (see "Deferred follow-ups"). → AC-4, AC-5, AC-9
  (design/presentation realized against mock data). → T3.
- **R5 — Unified empty state gating only the brief-dependent content.** Replace today's fragmented
  per-region empty states with ONE page-level "No brief yet → Generate brief" card (document icon,
  "No brief yet" heading, "Generate a Why+Risk brief for this PR." subtitle, PRIMARY "Generate brief"
  button) that occupies the Review-focus slot. It gates ONLY the brief-dependent content (the
  review-focus region / summary prose) — NOT the review-derived header or the intent / Risk-Areas /
  blast / prior-PRs regions. The "Generate brief" button triggers the existing brief-generation path
  only (`useGenerateWhyRiskBrief`), not a full review run. When intent is not yet computed (state
  `not_available`), the "Generate brief" action is unavailable; when `skipped` (no model), the action
  is unavailable and the reason is shown. → AC-17, AC-18, AC-19(a), AC-25. → T3 (empty state lives in
  ReviewFocus), T4 (feeds resolved state).
- **R6 — i18n + tests.** Update `messages/en/*.json` strings; update/remove affected component tests;
  add tests for the new Review-focus section and the unified empty state. → T1–T5 (each owns its own
  test), T3 (i18n `whyRiskBrief.json`).

### AC traceability (display/presentation ACs owned by this pass)

| AC | Requirement | Owning task(s) | Coverage |
|----|-------------|----------------|----------|
| AC-2 (what/why is header summary; brief precedence over review summary) | R2(b) | T1, T4 | Covered |
| AC-3 (no agent name in PR Brief header) | R2(a) | T1 (prop retained), T4 (call site drops it) | Covered |
| AC-7 (Risk Areas is the risk surface) | R3 | T2 | Covered |
| AC-8 (Risk-Areas refs always-visible clickable links) | R3 | T2 | Covered |
| AC-17 (only empty-state generates; no in-place regenerate; **stale shown but not self-serviceable**) | R2(d), R5 | T1 (stale display, no regenerate control), T3 (generate only from empty state), T5 (card/regenerate removed) | Covered |
| AC-18 (generate = brief only, not a full review) | R5 | T3 (`useGenerateWhyRiskBrief` only) | Covered |
| AC-19 (gate only brief-dependent content; header + non-brief regions render independently) | R2(b), R5 | T3, T4 | Covered |
| AC-20 (ready → full composition incl. review-focus + header what/why) | R2, R4 | T1, T3, T4 | Covered |
| AC-21 (stale cached brief served with may-be-out-of-date indication) | R2(d) | T1 (stale badge in header), T4 (threads `state.stale`) | Covered |
| AC-25 (intent absent → Generate unavailable) | R5 | T3 (`not_available` disables Generate) | Covered |
| AC-31 (docs truncated → indicate incomplete context) | R2(d) | T1 (docs-truncated note), T4 (threads `state.docs_truncated`) | Covered |
| AC-4/AC-5/AC-9 (review-focus item shape/count/ordering) | R4 | T3 (realized against MOCK; real data deferred) | Covered-by-mock (see Deferred follow-ups) |

### Constraints (honoured by every task)

- **Client-only** this pass, plus the marked mock stub. **No** DB / schema / route / server / contract
  changes. The `WhyRiskFocusItem` contract change is explicitly deferred.
- **Do NOT touch `src/vendor/**`** — vendored contracts/UI primitives are generated; editing one copy
  desyncs the others.
- Follow the colocated `_components/<Name>/` + co-located `styles.ts` + `*.test.tsx` conventions.
- Data access only via `src/lib/hooks/* → src/lib/api.ts`; never `fetch` from a component.
- User-facing strings come from `messages/en/*.json`, never hard-coded JSX.

## Open questions & recommendations (resolved)

- **Q1 (shared VerdictBanner) → answered:** Keep `agentName` as an optional prop on the shared
  `VerdictBanner`; simply **stop passing it at the `OverviewTab` (PR Brief header) call site**. The
  per-run accordion (`ReviewRunAccordion.tsx:149`) keeps its agent chip. Do NOT strip agent-name
  rendering from the shared component. (Satisfies AC-3 for the PR Brief header only.)
- **Q2 (what/why composition) → answered:** When a brief is `ready`, render `what` as the primary
  summary line and `why` as a secondary line beneath it, fully replacing the review summary; while
  the brief query is loading, show the review's own summary until it resolves.
- **Q3 (RiskAreas explanation) → answered:** Drop the click-accordion; always show the risk title and
  the clickable `path:line` link; keep the longer `explanation` as a **hover tooltip** (native
  `title` / `aria-label`) — matches the design and preserves the "different on hover" behavior.
- **Q4 (review-focus mock shape) → answered:** A clearly-marked module-level MOCK array of
  `{ path, line, reason }`, rendered when the brief status is `ready`; count badge = mock length;
  each item a `MonoLink` to `githubPrFileUrl(repoFullName, prNumber, path)`. Real-data wiring is an
  explicit deferred follow-up.
- **Q5 (review-focus gating) → answered:** The mock Review-focus list renders only when the brief is
  `ready`; for `not_generated` / `not_available` / `skipped` / loading, the same right-column slot
  shows the unified "No brief yet" empty state (Generate enabled only for `not_generated`; disabled
  with a reason for `not_available` / `skipped` per AC-25).
- **Rec (single read owner) → accepted:** `OverviewTab` owns the single `useWhyRiskBrief(prId)` call
  and passes the resolved state down to both the header (what/why precedence + stale/docs-truncated)
  and the new `ReviewFocus` section, keeping the AC-2/AC-19/AC-21/AC-31 precedence logic in one place.
  TanStack dedupes by query key regardless, but a single owner keeps the logic centralized; the write
  mutation (`useGenerateWhyRiskBrief`) lives locally in `ReviewFocus` and reactively updates
  `OverviewTab` via the shared `["why-risk-brief", prId]` cache key on success.

## Affected modules & contracts

- **client (`@devdigest/web`) only.** No server / reviewer-core / mcp / e2e changes this pass.
- **Contracts: none changed.** The existing `WhyRiskBriefState` / `WhyRiskBrief` / `BriefRef` /
  `WhyRiskFocusItem` (`client/src/vendor/shared/contracts/why-risk-brief.ts`) and the composite
  `Risk`/`Risks` (`.../brief.ts`) are consumed as-is — the `ready` state already carries `stale` and
  `docs_truncated` booleans (AC-21/AC-31 source). `src/vendor/**` is not touched.
- **Components touched:**
  - `_components/VerdictBanner/` — presentation change (header what/why prose; stale badge;
    docs-truncated note; agent chip retained but no longer fed by the PR Brief header). Shared with
    `ReviewRunAccordion` — behaviour there is unchanged.
  - `_components/IntentCard/` (`IntentCard.tsx`, `RiskAreas.tsx`, `styles.ts`) — thread
    `repoFullName`+`prNumber`; Risk-Areas refs become always-visible links, explanation → hover.
  - `_components/ReviewFocus/` — **NEW** right-column section (mock review-focus list + unified empty
    state + Generate action).
  - `_components/OverviewTab/` — orchestration: own the brief read, feed header precedence +
    stale/docs-truncated, thread IntentCard props, mount ReviewFocus, unmount PrBriefCard.
  - `_components/PrBriefCard/` — **DELETED**.
- **Hooks: reused as-is.** `useWhyRiskBrief` + `useGenerateWhyRiskBrief` already exist in
  `src/lib/hooks/brief.ts` (moved from `PrBriefCard` to `OverviewTab`/`ReviewFocus` callers). No hook
  changes required. `useRisks` (composite Risk Areas) already consumed by `RiskAreas`.
- **i18n:** `client/messages/en/whyRiskBrief.json` repurposed (empty-state + review-focus strings;
  **retain** the `stale` and `docsTruncated` keys for the header indicators; drop only the truly
  card-only keys). `brief.json` (`riskAreas` label) reused unchanged.

## Architecture changes

- `_components/ReviewFocus/ReviewFocus.tsx` — **NEW** `"use client"` colocated feature component
  (right-column region). Owns `useGenerateWhyRiskBrief`; receives the resolved `WhyRiskBriefState`
  + loading flag + `prId`/`repoFullName`/`prNumber` as props from `OverviewTab`.
- `_components/ReviewFocus/styles.ts`, `index.ts`, `ReviewFocus.test.tsx` — co-located per convention.
- `OverviewTab.tsx` — becomes the single owner of `useWhyRiskBrief(prId)`; derives the header brief
  prop (`{ what, why, stale, docsTruncated }`) and the ReviewFocus state prop from one read.
- No RSC boundary changes: all touched components are already `"use client"` (hooks + interactivity);
  the page (`page.tsx`) is untouched and already passes `repoFullName` + `prNumber` into `OverviewTab`.

## Deferred follow-ups (OUT OF SCOPE this pass — do NOT implement here)

These are required to make the Review-focus section (R4) render **real** data instead of the mock.
They are called out so the mock is understood as temporary, and so the next planning pass has the
seam. Each is a separate future effort spanning contract + engine + server (not client-only):

1. **Contract:** extend `WhyRiskFocusItem` from `{ path }` to `{ path, line, reason }` (or a
   `location`/`reason` shape) in the shared contract `contracts/why-risk-brief.ts`, hand-synced
   byte-identically across the `server/`, `client/`, `mcp/` vendored copies (no sync script).
2. **reviewer-core:** update `reviewer-core/src/why-risk-brief/` generation so the single structured
   pass produces a location + reason per review-focus item, and update grounding to validate the
   location against the PR's real changed locations (AC-4, AC-10, AC-11 — location grounding).
3. **server:** persist and serve the richer `review_focus` items (jsonb payload already stores the
   whole brief — a shape change flows through once the contract + engine emit it).
4. **client:** replace the `ReviewFocus` MOCK array with the real `state.brief.review_focus`, keep the
   ordering (AC-9) and count badge, and add a real-data test. (This is the only client-side part.)

> Note: AC-21 (stale) and AC-31 (docs-truncated) are **NOT** in this deferred set — they are covered
> this pass by T1 (header indicators). Only the review-focus `line`/reason enrichment is deferred.

Additionally noted (not blocking, but a latent inconsistency vs the corrected AC-1): the contract
still carries `risk_level` and a `risks` list that AC-1 says the brief should not own. This pass stops
rendering them (card removed), so the surface conforms; removing them from the contract/engine is a
separate deferred cleanup, not required for design alignment.

## Phased tasks

### Phase 1 — Presentation leaves (independent; may be done in any order)

T1, T2, T3 touch disjoint component folders and do not depend on each other. All three must land
before T4 wires them into `OverviewTab`.

#### T1 — VerdictBanner: header what/why prose + stale + docs-truncated indicators; retain (but stop feeding) the agent chip

- **Action:** In `VerdictBanner.tsx`, add an optional prop
  `brief?: { what: string; why: string; stale: boolean; docsTruncated: boolean } | null`.
  When `brief` is present:
  - render `brief.what` as the primary summary line and `brief.why` as a secondary line beneath it,
    and do NOT render the `summary` paragraph (AC-2);
  - when `brief.stale` is true, render a small **stale** badge in the header title row (reuse the
    existing stale visual language the old card used — clock icon + `t("stale")`), tied to the
    `ready` brief and with NO regenerate control (AC-21 + AC-17 stale-display clause);
  - when `brief.docsTruncated` is true, render a subtle **docs-context-incomplete** note directly
    under the brief prose (`t("docsTruncated")`) (AC-31).
  When `brief` is absent, keep the current behaviour (render `summary` when non-null). **Leave the
  `agentName` prop and its `Badge` rendering exactly as-is** (still used by `ReviewRunAccordion`).
  Resolve the two indicator labels from the `whyRiskBrief` namespace via a scoped
  `const tw = useTranslations("whyRiskBrief")` — call the hook unconditionally (rules of hooks) but
  only RESOLVE `tw("stale")` / `tw("docsTruncated")` inside the `brief`-present branches, so callers
  that pass no `brief` (e.g. `ReviewRunAccordion`) never resolve those keys and need no namespace
  change. Keep the existing `t = useTranslations("prReview")` for verdict labels. Add the styles to
  `VerdictBanner/styles.ts`: `s.whySummary` (secondary/muted why line), `s.staleBadge` (small
  inline badge), `s.truncatedNote` (subtle note). Update `VerdictBanner.test.tsx`: add
  `whyRiskBrief` to the test provider `messages`; add cases asserting (i) with
  `brief={{what,why,stale:false,docsTruncated:false}}` both `what`/`why` render and `summary` does
  not; (ii) `stale:true` renders the stale badge text; (iii) `docsTruncated:true` renders the
  truncated note; keep the existing agent-chip and cost/token cases green.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`, `react-testing-library`
- **Owned paths:** `client/src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/VerdictBanner.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/styles.ts`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/VerdictBanner.test.tsx`
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** `VerdictBanner` is **shared** with `ReviewRunAccordion.tsx` (which passes
  `agentName` and NO `brief`) — do NOT remove the `agentName` prop or its rendering; AC-3 is satisfied
  by the caller (T4) not passing it, not by deleting it here. Calling `useTranslations("whyRiskBrief")`
  is harmless when the namespace is absent — next-intl only logs `MISSING_MESSAGE` on key
  *resolution*, and the two keys are resolved only when a `brief` is passed, so `ReviewRunAccordion`
  (no `brief`) is unaffected and needs no namespace (client `INSIGHTS.md` MISSING_MESSAGE note). Any
  `VerdictBanner`/`OverviewTab` test that passes a `brief` MUST include `whyRiskBrief` in its provider
  `messages`. Avoid the `border`/`background` shorthand+longhand React style-conflict trap when adding
  the badge/note styles (use longhands if any per-render override touches the same box — client
  `INSIGHTS.md`).
- **Acceptance:** `node_modules/.bin/vitest run` (client) for `VerdictBanner.test.tsx` green: with
  `brief={{what:"W",why:"Y",stale:false,docsTruncated:false}}` and `summary="OLD"`,
  `getByText("W")` and `getByText("Y")` resolve and `queryByText("OLD")` is null (AC-2 precedence);
  with `brief.stale=true`, the stale badge text (`whyRiskBrief.stale`) renders (AC-21); with
  `brief.docsTruncated=true`, the truncated note (`whyRiskBrief.docsTruncated`) renders (AC-31); with
  no `brief` and `summary="OLD"`, `getByText("OLD")` resolves; the existing agent-chip case
  (`agentName="Security Reviewer"`) still renders the chip (proves the shared prop is intact). `tsc
  --noEmit` passes in `client/`.

#### T2 — RiskAreas: always-visible `path:line` links + explanation-on-hover; thread repo/PR into IntentCard

- **Action:** Rewrite `RiskAreas.tsx` to drop the click/hover accordion state (`openIdx`/`hoverIdx`)
  and the `<button>` toggle. For each risk render: the severity-tinted title (keep `severityColor`
  chip styling / icon) with the risk `explanation` exposed via a native hover tooltip (`title` +
  `aria-label` on the title element), and the `file_refs` **always visible** — each ref rendered as a
  `MonoLink` whose `href = githubPrFileUrl(repoFullName, prNumber, parsePath(ref))`, where
  `parsePath` strips the trailing `:line` (split on the last `:`) for the URL while the visible label
  keeps the full `path:line` string. When `repoFullName` is missing or `prNumber` is not finite,
  render the ref as inert mono text (mirror `PriorPrs`'s repo-absent fallback). Add the required props
  `repoFullName: string | null | undefined` and `prNumber: number` to `RiskAreas`. Thread the same two
  props through `IntentCard` (add them to `IntentCardProps` and pass to `<RiskAreas>`). Update
  `RiskAreas.test.tsx` (remove the accordion/hover/aria-expanded cases; add: refs render as anchors
  with an `href` always visible without any click; the `explanation` is present as the title's
  `title`/`aria-label` rather than hidden-until-click; null/empty risks still render nothing) and
  `IntentCard.test.tsx` (pass the new `repoFullName`/`prNumber` props).
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`, `react-testing-library`
- **Owned paths:** `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/RiskAreas.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/RiskAreas.test.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.test.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/styles.ts`
- **Depends-on:** none
- **Risk:** medium
- **Known gotchas:** File links MUST use `MonoLink` + `githubPrFileUrl` (the `FindingCard`/`PrBriefCard`
  pattern) — the current `RiskAreas` renders refs as inert `<span>`s; that is exactly what AC-8
  forbids. `githubPrFileUrl(repo, number, file)` without a `pathSha` returns the bare
  `/pull/{n}/files` URL (valid); the precise `#diff-…R{line}` anchor needs the async `usePathShas`
  hash and is **not** in scope — the bare Files link is acceptable (client `INSIGHTS.md` finding-link
  note). `file_refs` values are `string[]`; treat the format as `path:line` and split on the LAST `:`
  so a path containing no colon still yields a usable path. When editing `styles.ts`, keep the
  separately-exported `severityColor` map outside the `s` object (a `Record<RiskSeverity,…>` is not
  assignable to `CSSProperties` — client `INSIGHTS.md`). Adding required props to `RiskAreas`/`IntentCard`
  makes any test that mounts them fail to typecheck until updated — both test files are Owned here.
- **Acceptance:** `node_modules/.bin/vitest run` (client) for `RiskAreas.test.tsx` + `IntentCard.test.tsx`
  green: with a risk whose `file_refs=["src/db/queries.ts:42"]` and a real `repoFullName`/`prNumber`,
  the ref renders as an `<a>` with a non-empty `href` containing `/pull/{prNumber}/files`, visible
  without any click (AC-8); the risk `explanation` is reachable as the title element's `title`/`aria-label`
  (hover affordance) and there is no `aria-expanded` toggle button; with `repoFullName={null}` the ref
  renders as text (no `href`); empty/null risks render nothing. `tsc --noEmit` passes in `client/`.

#### T3 — New ReviewFocus section (mock list + unified empty state + Generate action) + i18n

- **Action:** Create `_components/ReviewFocus/` (`ReviewFocus.tsx`, `styles.ts`, `index.ts` barrel,
  `ReviewFocus.test.tsx`). Props: `{ state: WhyRiskBriefState | undefined; isLoading: boolean; prId:
  string; repoFullName: string | null | undefined; prNumber: number }`. It owns
  `useGenerateWhyRiskBrief(prId)` for the Generate action. Render by state:
  - `isLoading` (or `state === undefined`) → `Skeleton` inside the standard
    `<section><SectionLabel/><div style={s.card}>…</div></section>` shell (mirror `IntentCard`
    loading, `height≈88`).
  - `status === "ready"` → the **"Review focus — read these first"** section: a `SectionLabel` (icon
    e.g. `"ListChecks"`/`"Target"` — verify the name exists in `@devdigest/ui` before use) plus a
    visible **count badge** (mirror `PriorPrs`'s `s.countBadge`, `t("reviewFocus.count",{count})`),
    then an ordered `<ol>`/`<ul>` of the module-level `MOCK_REVIEW_FOCUS` items. Each item renders
    `<MonoLink href={githubPrFileUrl(repoFullName, prNumber, item.path)}>{`${item.path}:${item.line}`}</MonoLink>`
    followed by `— {item.reason}`. `MOCK_REVIEW_FOCUS` is a clearly-commented
    `const MOCK_REVIEW_FOCUS: { path: string; line: number; reason: string }[] = [...]` with a
    `// TODO(SPEC-03 follow-up): replace with real state.brief.review_focus once WhyRiskFocusItem
    carries line+reason — see docs/plans/why-risk-brief-design-alignment.md "Deferred follow-ups".`
    marker. Count badge reflects `MOCK_REVIEW_FOCUS.length`.
  - `status === "not_generated"` → the **unified empty state**: `EmptyState` sub-component (document
    icon e.g. `"FileText"`, `t("emptyState.heading")` = "No brief yet", `t("emptyState.subtitle")`,
    and a PRIMARY `Button` (`kind="primary"`) `t("generate")` → `generate.mutate()`, disabled while
    `generate.isPending`, label swaps to `t("generating")`). Never auto-fire the mutation on mount.
  - `status === "not_available"` (intent absent) → the same `EmptyState` shell but the Generate action
    is **unavailable** (button omitted or `disabled`), with `t("notAvailableHint")` explaining intent
    must be computed first (AC-25).
  - `status === "skipped"` → the `EmptyState` shell with Generate unavailable and `t("skippedNoModel")`
    shown as the reason (AC-27 surfaced here).
  - Update `client/messages/en/whyRiskBrief.json` (repurpose): keys `reviewFocus.title`,
    `reviewFocus.count` (`"{count, plural, one {# file} other {# files}}"`), `emptyState.heading`,
    `emptyState.subtitle`, `generate` ("Generate brief"), `generating`, `notAvailableHint`,
    `skippedNoModel`. **RETAIN** the `stale` and `docsTruncated` keys — they are now rendered by the
    header (T1/VerdictBanner), so do NOT delete them. Remove only the genuinely card-only keys that
    nothing renders anymore (`title` "Why + Risk Brief", `regenerate`, `emptyGenerated`, `risksLabel`,
    `reviewFocusLabel`, `riskLevel.*`) — keep everything `ReviewFocus` (this task) or the header (T1)
    consumes.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `next-best-practices`, `ui-frontend-architecture`,
  `react-testing-library`
- **Owned paths:** `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewFocus/ReviewFocus.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewFocus/styles.ts`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewFocus/index.ts`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewFocus/ReviewFocus.test.tsx`,
  `client/messages/en/whyRiskBrief.json`
- **Depends-on:** none (uses existing hooks + helpers)
- **Risk:** medium
- **Known gotchas:** `"use client"` required (hooks + interactivity). `messages/en/<ns>.json` filename
  = namespace, auto-merged — no index to edit. **Do NOT delete the `stale`/`docsTruncated` keys** —
  T1 resolves them from this same namespace; deleting them would make the header indicators render the
  raw key. Verify any icon name exists in `client/src/vendor/ui/` before using it — an unknown name
  silently renders nothing (`"GitCompare"` gotcha, client `INSIGHTS.md`); prefer known icons
  (`FileText`, `Target`, `ListChecks` only if present). Use `Skeleton` for the loading branch to keep
  the right-column height stable (client `INSIGHTS.md`). The mock list is presentation-only — do NOT
  read `state.brief.review_focus` (its items are `{path}`-only and would render without a line/reason);
  the mock is intentional per Q4. Do not auto-generate on mount (AC-16/AC-14).
- **Acceptance:** `node_modules/.bin/vitest run` (client) for `ReviewFocus.test.tsx` green:
  `status:"ready"` renders the count badge = `MOCK_REVIEW_FOCUS.length` and each mock item as an
  `<a href>` (MonoLink) with visible `path:line — reason` text (AC-4/5 realized against mock);
  `status:"not_generated"` renders the "No brief yet" heading + an enabled primary "Generate brief"
  button that, on click, calls `generate.mutate` (spied) and does NOT auto-POST on mount (AC-18/14);
  `status:"not_available"` renders the empty state with NO enabled Generate action + the intent hint
  (AC-25); `status:"skipped"` shows the no-model reason (AC-27). `tsc --noEmit` passes in `client/`.

### Phase 2 — Orchestration & cleanup

#### T4 — OverviewTab: own the brief read, feed header precedence + stale/docs-truncated, thread props, mount ReviewFocus, unmount PrBriefCard

- **Action:** In `OverviewTab.tsx`:
  1. Call `const { data: brief, isLoading: briefLoading } = useWhyRiskBrief(prId)` once at the top
     (import from `@/lib/hooks/brief`).
  2. Derive `const headerBrief = brief?.status === "ready" ? { what: brief.brief.what, why:
     brief.brief.why, stale: brief.stale, docsTruncated: brief.docs_truncated } : null;` and pass
     `brief={headerBrief}` to `<VerdictBanner>` (this carries the what/why prose AND the stale /
     docs-truncated indicators — AC-2/AC-21/AC-31); **remove the `agentName={latestReview.agent_name}`
     prop** from this call site (AC-3). Keep the `latestReview?.verdict` render gate unchanged (header
     stays review-derived, independent of the brief — AC-19c/AC-20). Keep passing
     `summary={latestReview.summary}` so the fallback works while the brief is loading / absent
     (AC-2/AC-19b).
  3. Pass `repoFullName={repoFullName}` and `prNumber={prNumber}` to `<IntentCard>` (new props from T2).
  4. Remove the `import { PrBriefCard }` and its `<PrBriefCard …>` render from the left `s.cell`
     (revert the left cell to just `<IntentCard …>`); update the `styles.ts` comment on `s.cell` that
     references PrBriefCard stacking (no structural style change required; the left cell may hold just
     IntentCard).
  5. In the right column (`s.rightCol`), mount `<ReviewFocus state={brief} isLoading={briefLoading}
     prId={prId} repoFullName={repoFullName} prNumber={prNumber} />` **below** `<PriorPrs …>` (guard on
     `prId && Number.isFinite(prNumber)` as the current PrBriefCard mount did).
  6. Update `OverviewTab.test.tsx`: remove the "PrBriefCard wiring" describe block (asserting "Why +
     Risk Brief" / "No brief generated yet."); the `/why-risk-brief` fetch branch stays (now feeds
     both header + ReviewFocus). Add/adjust assertions: with `latestReview` present + brief
     `not_generated`, the header shows the review's own summary (AC-2 fallback) and the ReviewFocus
     slot shows the unified "No brief yet" empty state (AC-19); add a case where `/why-risk-brief`
     returns `{status:"ready", brief:{…}, stale:true, docs_truncated:true, generated_at:…}` and assert
     the header renders the brief `what`/`why`, the stale badge, and the docs-truncated note
     (AC-2/AC-21/AC-31); the `whyRiskBrief` namespace remains in the provider `messages`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `next-best-practices`, `ui-frontend-architecture`,
  `react-testing-library`
- **Owned paths:** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/styles.ts`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.test.tsx`
- **Depends-on:** T1 (VerdictBanner `brief` prop incl. `stale`/`docsTruncated`), T2 (IntentCard new
  props), T3 (`ReviewFocus` export + `whyRiskBrief` i18n keys)
- **Risk:** medium
- **Known gotchas:** Adding a child that calls `useTranslations("<ns>")` (ReviewFocus →
  `whyRiskBrief`, and now VerdictBanner resolves `whyRiskBrief` keys when a `brief` is passed) requires
  that namespace in every test provider that mounts OverviewTab, or next-intl silently logs
  `MISSING_MESSAGE` while the suite stays green (client `INSIGHTS.md`) — the existing
  `OverviewTab.test.tsx` already includes `whyRiskBrief`, keep it. `OverviewTab` fetch mocks are
  URL-branching already; keep the `/why-risk-brief` branch. `prNumber` is a prop (passed from
  `page.tsx:161`), NOT `useParams()` — keep using the prop (client `INSIGHTS.md` PrBriefCard-wiring
  note). Removing the `agentName` pass must NOT touch `ReviewRunAccordion` (different surface, keeps
  its chip). The `ready` envelope's fields are snake_case (`docs_truncated`) — map to the camelCase
  `docsTruncated` prop when building `headerBrief` (client↔server keys are snake_case; the prop is a
  local camelCase shape).
- **Acceptance:** `node_modules/.bin/vitest run` (client) for `OverviewTab.test.tsx` green: no
  "Why + Risk Brief" card text remains; with a review + `not_generated` brief the header renders the
  review `summary` and the right column renders the "No brief yet" empty state; with a `ready` brief
  that is `stale:true`/`docs_truncated:true` the header renders the brief `what`/`why` + the stale
  badge + the docs-truncated note (AC-2/AC-21/AC-31); the PR-score / cost / token header cases still
  pass; no `MISSING_MESSAGE` for `whyRiskBrief` in stderr. `tsc --noEmit` passes in `client/` (proves
  the PrBriefCard import is gone and IntentCard/VerdictBanner prop shapes line up).

#### T5 — Delete the PrBriefCard component

- **Action:** Delete the entire `_components/PrBriefCard/` folder (`PrBriefCard.tsx`, `styles.ts`,
  `index.ts`, `PrBriefCard.test.tsx`). No other references remain after T4 (verified: the only
  non-folder usages were `OverviewTab.tsx` (removed in T4) and the `OverviewTab/styles.ts` comment).
- **Module:** client
- **Type:** ui
- **Skills to use:** (none — deletion)
- **Owned paths:** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/styles.ts`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/index.ts`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.test.tsx`
- **Depends-on:** T4 (the import/usage must be removed first, or the build breaks)
- **Risk:** low
- **Known gotchas:** Do this AFTER T4 so `OverviewTab` no longer imports it. `grep -rn "PrBriefCard"
  client/src` must return zero hits after deletion. The `useWhyRiskBrief`/`useGenerateWhyRiskBrief`
  hooks in `src/lib/hooks/brief.ts` are NOT deleted — they are now used by `OverviewTab`/`ReviewFocus`.
- **Acceptance:** `grep -rn "PrBriefCard" client/src` returns nothing; `tsc --noEmit` and the full
  client `vitest run` pass with the folder gone.

#### T6 — Verification gate

- **Action:** After T1–T5 land, run `tsc --noEmit` and the client test suite; fix only integration
  seams surfaced here (imports, namespace/message wiring) — no new scope. Confirm no orphaned
  references to removed i18n keys or `PrBriefCard`, and that the retained `stale`/`docsTruncated` keys
  resolve in the header.
- **Module:** client
- **Type:** ui
- **Skills to use:** (none — verification)
- **Owned paths:** none (read/run only; any fix is reported back to the owning task)
- **Depends-on:** T4, T5
- **Risk:** low
- **Known gotchas:** Use the package-local binary `node_modules/.bin/vitest` — `pnpm test` trips a
  deps-status precheck (root/client `INSIGHTS.md`). App Router bracket-folder globs do NOT match with
  `**` — pass the LITERAL bracketed file path or run bare `vitest run` and grep the file name out of
  the output (client `INSIGHTS.md`). If a red file falls outside all Owned paths, diff-check whether
  it pre-existed before assuming this work broke it.
- **Acceptance:** `node_modules/.bin/tsc --noEmit` green in `client/`; `node_modules/.bin/vitest run`
  (client) green, including `VerdictBanner`, `RiskAreas`, `IntentCard`, `ReviewFocus`, and
  `OverviewTab` suites; `grep -rn "PrBriefCard" client/src` empty; no `MISSING_MESSAGE` for
  `whyRiskBrief` (stale/docsTruncated keys resolve).

## Testing strategy

- **Component tests (RTL + Vitest + jsdom, `fetch` mocked)** — the whole pass is client-only:
  - `VerdictBanner.test.tsx` — what/why precedence over summary; stale badge when `brief.stale`;
    docs-truncated note when `brief.docsTruncated`; agent chip still renders when `agentName` is
    passed (shared-prop intact).
  - `RiskAreas.test.tsx` + `IntentCard.test.tsx` — refs render as always-visible anchors (`href`),
    explanation-on-hover (no `aria-expanded` toggle), repo-absent fallback to inert text.
  - `ReviewFocus.test.tsx` — ready → mock list + count badge + MonoLinks; not_generated → enabled
    Generate + no auto-POST; not_available → Generate unavailable + intent hint; skipped → no-model
    reason.
  - `OverviewTab.test.tsx` — no PrBriefCard; header fallback to review summary; header stale +
    docs-truncated indicators on a `ready` brief; ReviewFocus empty state in the right column;
    existing score/cost cases green; no `MISSING_MESSAGE`.
- **Commands:** `node_modules/.bin/vitest run` (bare, then grep the target file names out of the
  output) and `node_modules/.bin/tsc --noEmit`, run inside `client/`. No `.it.test.ts` (no DB), no
  new e2e (advisory, model-gated read surface; `e2e/` is deterministic/no-LLM).

## Risks & mitigations

- **Shared `VerdictBanner` regressing the per-run accordion** (removing `agentName` would drop the
  agent chip from `ReviewRunAccordion` too) → keep the prop; only the OverviewTab call site stops
  passing it (Q1). T1 acceptance re-asserts the chip renders when the prop is supplied. → T1/T4.
- **Stale / docs-truncated indicators lost in the card removal** → explicitly re-homed into the
  header (T1) with their own acceptance criteria + tests; the `stale`/`docsTruncated` i18n keys are
  RETAINED (T3), and OverviewTab threads `state.stale`/`state.docs_truncated` from the single read
  (T4). AC-21 + AC-31 covered. → T1/T3/T4.
- **Mock review-focus mistaken for real data** → the MOCK array carries an explicit
  `TODO(SPEC-03 follow-up)` comment pointing at the "Deferred follow-ups" section; the plan lists the
  contract+engine+server work needed to replace it. → T3 + Deferred follow-ups.
- **`RiskAreas` `path:line` parsing** — a `path` without a `:line` suffix, or the bare-`/files` URL
  lacking a precise line anchor → split on the LAST `:` (path with no colon still yields a path); the
  bare Files URL is a valid, resolvable link (line anchor needs the out-of-scope `usePathShas` hash).
  → T2.
- **next-intl silent MISSING_MESSAGE** when a new child namespace isn't in a test provider → every
  test that mounts `ReviewFocus` (or a `VerdictBanner` with a `brief`) includes `whyRiskBrief` in
  `messages`; stderr is the only signal (client `INSIGHTS.md`). → T1/T3/T4.
- **Icon name typo rendering nothing** (`@devdigest/ui` icon map returns `undefined` silently) → verify
  every icon name against `client/src/vendor/ui/` before use. → T3.

## Red-flags check

- [x] Every requirement (R1–R6) maps to at least one task (see Requirements + AC-traceability table).
- [x] Every retained display AC (AC-2, AC-3, AC-7, AC-8, AC-17, AC-18, AC-19, AC-20, AC-21, AC-25,
      AC-31) is Covered in the AC-traceability table with an owning task.
- [x] No specification was authored or edited — SPEC-03 taken as input; only this plan file written.
- [x] Execution mode recorded (single-agent) and the plan is shaped for it (ordered leaves → one
      orchestration task → deletion → verify).
- [x] Dependencies form a DAG: T1, T2, T3 (roots) → T4(T1,T2,T3) → T5(T4) → T6(T4,T5). No cycles.
- [x] Owned paths are disjoint per task (VerdictBanner only T1; IntentCard/RiskAreas only T2;
      ReviewFocus + whyRiskBrief.json only T3; OverviewTab only T4; PrBriefCard only T5).
- [x] Every Acceptance is measurable (named test file + command, `tsc --noEmit`, or a concrete
      `grep`/DOM assertion).
- [x] No contract changes — `src/vendor/**` is not touched; the `WhyRiskFocusItem` shape change is
      explicitly deferred, not done here. AC-21/AC-31 use existing `stale`/`docs_truncated` fields.
- [x] No DB / server / reviewer-core / migration changes — client-only pass.
- [x] Failure & edge states covered by owning tasks: unavailable-precondition (`not_available` when
      intent absent → Generate unavailable, distinct from `not_generated`, AC-25 — T3); no-model
      (`skipped` reason shown — T3); brief-loading vs absent both fall back to the review summary in
      the header (AC-2/AC-19b — T4); **stale cached brief served with a may-be-out-of-date indication
      and no self-service regenerate (AC-21 + AC-17 stale clause — T1/T4); docs-truncated indication
      (AC-31 — T1/T4)**; in-progress + navigate-away (generation is a persisted server round-trip; on
      return the read serves the cached row or `not_generated` — existing read path, surfaced by
      T3/T4); no in-place regenerate on a cached brief (AC-17 — card removed, T1/T4/T5).
      Preserve-prior-on-retry / partial-N-failure are backend concerns already satisfied and out of
      scope for this client-only pass.
</content>
