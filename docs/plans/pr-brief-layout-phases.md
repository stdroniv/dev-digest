# PR Brief — Overview tab layout realignment (fix phases)

Bring the PR Details **Overview** tab in line with the "PR Brief" design mockup.
This doc is the **phase breakdown / scope contract**. The in-depth technical plan
(file-by-file changes, edge cases, test matrix) lives in
[`pr-brief-layout.md`](./pr-brief-layout.md), authored by the planner agent.

## Problem (grounded)

The Overview tab is a single full-width vertical stack of independent sections;
the design is a "PR Brief" group with a two-column grid. Specifics:

- Orchestration point `OverviewTab.tsx:22-48` returns a bare fragment; page
  container `page.tsx:150` is `display:flex; flexDirection:column; gap:24`.
- Intent, Risks, Blast, PriorPrs render as four stacked **full-width** siblings.
- No "PR Brief" grouping label exists (`brief.json` has `block.*` but no `prBrief`).
- In-scope / out-of-scope stack vertically (`IntentCard.tsx:122-150`,
  `scopeSection` is padding-only at `IntentCard/styles.ts:30-32`).
- Risks is its own top-level `<section>` (`RisksCard.tsx:24-26`), not inside Intent.
- Styling stays inline `CSSProperties` + CSS vars — **not Tailwind** — and inline
  styles cannot express `@media`, so responsive collapse must use
  `grid-template-columns: repeat(auto-fit, minmax(...))`.

## Target (design, Image #1)

`PR BRIEF` label → full-width verdict card → 2-col grid: **Intent** (left:
italic-quoted intent, In/Out-of-scope side-by-side, Risk Areas chips) and
**Blast Radius** (right: stats + tree, with **Prior PRs nested at the bottom**).

## Locked decisions

| Topic | Decision |
|-------|----------|
| Risk Areas rendering | **Chips + hover/expand detail** — mockup-accurate pills; explanation + file_refs revealed on hover/click (no data loss). |
| Cost line (`$0.014 · 8.2K→1.3K`) | **Render only if the data already exists** on the review record. No backend/reviewer-core plumbing in this effort. |
| Prior PRs placement | **Nested in the Blast Radius column**, at the bottom of the card. |
| Cosmetic 5a/5b (italic-quoted intent, ✓/✗ scope icons) | In scope — low-risk, design-accurate. |
| Styling approach | Inline `CSSProperties` + CSS vars (match existing). No Tailwind, no new CSS files unless a `@media` is unavoidable. |
| Locales | Only `en` exists (`client/messages/en/`). New i18n keys go there. |

---

## Phase 1 — "PR Brief" group + two-column grid (backbone)

**Fixes:** no PR-Brief grouping; Intent & Blast not side-by-side; Prior PRs nesting.
**Files:** `OverviewTab/OverviewTab.tsx`, `OverviewTab/styles.ts`, `messages/en/brief.json`.
**Changes:**
- Wrap brief in `<section><SectionLabel icon="FileText">{t("brief.prBrief")}</SectionLabel>…`.
- `VerdictBanner` stays full-width directly under the label (still conditional).
- Add `briefGrid` = `repeat(auto-fit, minmax(380px,1fr))`, `gap:20`, `alignItems:start`.
- Left cell: `<IntentCard>`. Right cell: column wrapping `<BlastRadius>` then `<PriorPrs>`.
- New key `brief.prBrief`.

**Verify:** Intent-left / Blast-right ≥1080px; collapses to one column when narrow;
Description stays full-width below the grid.

## Phase 2 — Blast Radius half-width hardening

**Fixes:** long real paths (e.g. `apps/web/app/api/cron/…/route.ts`) overflow a ~520px column.
**Files:** `BlastRadius/styles.ts` (+ caller/symbol row component if needed).
**Changes:** middle-truncate / ellipsis + horizontal-scroll on path rows; stat row +
Tree/Graph toggle wrap gracefully; nested Prior PRs accordion fits the narrower card.
**Verify against real data** (cal.com PR #29672), not the toy mockup paths.

## Phase 3 — Risk Areas into the Intent card (chips + hover)

**Fixes:** risks should be inside Intent, not a separate section.
**Files:** `IntentCard/IntentCard.tsx`, `IntentCard/styles.ts`, `OverviewTab/OverviewTab.tsx`,
`RisksCard/*` (repurpose/remove), `messages/en/brief.json`.
**Changes:**
- Render a `RiskAreas` block inside the Intent card body (below scopes) with a
  "RISK AREAS" sub-label; remove the standalone `<RisksCard>` sibling.
- Move `useRisks(prId)` into Intent (or a co-located `<RiskAreas prId>`).
- Render risks as **chips** (severity-tinted icon + title); explanation + file_refs
  on **hover/expand** (decision: chips + hover detail).
- New key `brief.riskAreas`.

## Phase 4 — In Scope / Out of Scope → two columns

**Fixes:** scope lists stack vertically.
**Files:** `IntentCard/IntentCard.tsx`, `IntentCard/styles.ts`.
**Changes:** `scopeSection` → `display:grid; gridTemplateColumns: repeat(auto-fit, minmax(200px,1fr)); columnGap:24`;
wrap each scope block (label + `ul`) as a grid cell so they sit side-by-side and
collapse on narrow widths.

## Phase 5 — Visual fidelity polish

**Fixes:** the remaining mockup deltas.
- **5a** — intent summary italic + curly-quoted (`IntentCard.tsx:112`). **In scope.**
- **5b** — green `✓ IN SCOPE` / red `✗ OUT OF SCOPE` label icons. **In scope.**
- **5c** — (folded into Phase 3 by the chips decision).
- **5d** — cost line on the verdict card **only if** token/cost fields already exist
  on the review record; otherwise skip. No new plumbing.

---

## Execution order

`1 → 2 → 3 → 4 → 5`. Phases 1–4 resolve every structural inconsistency; Phase 5 is
pixel-fidelity. Each phase = one commit, its own tests, an independently visible result.

## Cross-cutting edge cases (the planner must enumerate + handle)

- **No intent computed** (current empty state) — left card still renders; show
  Recalculate empty state; if risks exist, still show Risk Areas below it.
- **No risks** — hide the Risk Areas sub-section (or empty hint), don't leave a bare label.
- **in_scope / out_of_scope empty** (one or both) — 2-col scope grid with a missing column.
- **No review / no verdict** — `VerdictBanner` hidden; PR-Brief label + grid still render.
- **Blast: index degraded / 0 symbols / 0 callers / 0 endpoints / 0 cron** — degraded
  badge + empty states inside the narrower right column.
- **Loading** — IntentCard/RisksCard currently `return null` while loading; avoid a
  half-empty flashing grid (consistent skeleton/placeholder).
- **Narrow viewport** — grid + scope columns collapse to one column (no `@media`).
- **Long file paths** at half width (Phase 2).
- **Tests** — `OverviewTab.test`, `IntentCard.test`, `RisksCard.test` updated for the
  moved/nested structure; client tests are hermetic (`fetch` mocked).

## Constraints

- Do **not** touch `src/vendor/**` (vendored `@devdigest/ui` / shared contracts).
- All data access via `src/lib/hooks/*`; no direct `fetch` in components.
- User-facing strings via `messages/en/*.json`, not hard-coded JSX.
