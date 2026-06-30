# Plan: PR Brief — Overview tab layout realignment

> Technical companion to the scope contract in
> [`pr-brief-layout-phases.md`](./pr-brief-layout-phases.md). Execute phase-by-phase
> (`1 → 2 → 3 → 4 → 5`); each phase is one commit with its own tests and an
> independently visible result. Do **not** widen scope beyond the five phases.

## Understanding

The Overview tab currently renders four independent full-width stacked sections
(Intent, Risks, Blast, Prior PRs) plus a conditional VerdictBanner and a
Description block. The "PR Brief" design instead groups them: a `PR BRIEF`
section label → full-width verdict card → a two-column grid with **Intent** on the
left (italic-quoted intent, In/Out-of-scope side-by-side, Risk Areas as chips) and
**Blast Radius** on the right (stats + tree, with **Prior PRs nested at the bottom**
of that column). Description stays full-width below the grid. This effort is
**client-only, presentation-only**: no backend, no `reviewer-core`, no DB, no new
endpoints or contracts. All structural moves reuse the existing inline
`CSSProperties` + CSS-var styling idiom (no Tailwind, no global CSS / `@media`;
responsive collapse via `grid-template-columns: repeat(auto-fit, minmax(...))`).

## Context loaded

- **Scope contract**: `docs/plans/pr-brief-layout-phases.md` (phases, locked
  decisions, cross-cutting edge cases).
- **Docs/INSIGHTS**: root `INSIGHTS.md`; `client/CLAUDE.md`; `client/INSIGHTS.md`
  (the BlastRadius `isEmpty` gate, the `styles.ts` cannot hold a `Record` map rule,
  the `severityColor` pattern, the `border`/`borderColor` shorthand-vs-longhand
  console-error rule, the next-intl MISSING_MESSAGE silent-failure rule, the
  `vi.fn` empty-tuple typecheck rule, the RTL `getNodeText` direct-text-node rule).
- **Page/orchestrator**: `pulls/[number]/page.tsx` (container at line 150; passes
  `latestReview`), `_components/OverviewTab/{OverviewTab.tsx,styles.ts,OverviewTab.test.tsx}`.
- **Cards**: `_components/IntentCard/{IntentCard.tsx,styles.ts,index.ts,IntentCard.test.tsx}`,
  `_components/RisksCard/{RisksCard.tsx,styles.ts,index.ts,RisksCard.test.tsx}`,
  `_components/BlastRadius/{BlastRadius.tsx,styles.ts}`,
  `_components/PriorPrs/{PriorPrs.tsx,styles.ts}`,
  `_components/VerdictBanner/{VerdictBanner.tsx,styles.ts,constants.ts}`.
- **Hooks**: `src/lib/hooks/brief.ts` (`useIntent`, `useRisks`, `useRecalculateIntent`),
  `src/lib/hooks/blast.ts`, `src/lib/hooks/history.ts` (read transitively).
- **Contracts (vendored, read-only)**: `src/vendor/shared/contracts/brief.ts`
  (`Intent`, `Risk`, `RiskSeverity`, `Risks`), `src/vendor/shared/contracts/review-api.ts`
  (`ReviewRecord`).
- **UI primitives (vendored, read-only)**: `src/vendor/ui/icons.tsx` (icon registry),
  `primitives/SectionLabel.tsx`, `primitives/Chip.tsx`, `primitives/Badge.tsx`,
  `primitives/CircularScore.tsx`, `primitives/Skeleton.tsx`. **There is no Tooltip /
  Popover / Disclosure primitive** (grep returned nothing) — the chip hover/expand
  must be co-located.
- **i18n**: `client/messages/en/brief.json` (only `en` exists). Verdict strings live
  in `messages/en/prReview.json` (`prReview` namespace).
- **House style**: skimmed `docs/plans/risk-areas-card.md` (mirror-Intent pattern,
  inline-`styles.ts`, `severityColor` separate export).
- **Skills consulted**: `react-best-practices` (component decomposition, controlled
  expand state, hooks, JSX) and `react-testing-library` (query priority, `fireEvent`
  — no `user-event` in this package, `aria-label` queries, `getAllByText` for
  intended duplicates). Deliberately skipped backend/Drizzle/Zod/Fastify skills — no
  server, schema, or contract changes in this effort.

## Cost-data verdict (Phase 5d) — **SKIPPED: data not present**

`ReviewRecord` is the type of `latestReview` passed into `OverviewTab`
(`page.tsx:85`, `OverviewTab.tsx:18`). Its full field set is
`src/vendor/shared/contracts/review-api.ts:23-38`:

```
id, pr_id, agent_id, run_id, agent_name, kind, verdict, summary,
score, model, grounding, created_at, findings
```

There is **no** `cost_usd`, `tokens`, `tokens_in/out`, or `usage` field. Token/cost
data exists elsewhere in the codebase (`contracts/trace.ts:63-69,121-132` carry
`tokens_in/tokens_out/cost_usd` on **run/trace** records, which is why `RunHistory`
can render a cost line), but that data is **not** on the review record handed to the
Overview tab, and the locked decision forbids new plumbing to fetch it. **Therefore
Phase 5d ships nothing**: `VerdictBanner.tsx` / its `styles.ts` are not touched, no
cost line is added. Recorded as an open question below in case a later effort wants
to thread run-level cost into the Overview.

## Approach & tradeoffs

- **Restructure at the orchestrator, keep the cards self-contained.** Each card
  (`IntentCard`, `BlastRadius`, `PriorPrs`) already renders its own `<section>` +
  `SectionLabel` and self-fetches via its hook. Phase 1 only re-parents them into a
  grid inside a new `PR BRIEF` `<section>`; the cards keep their own sub-labels
  (matching the mockup's `INTENT` / `BLAST RADIUS` / `PR HISTORY` sub-headers). This
  is the smallest change that achieves the two-column layout and keeps each card
  independently testable.
  - *Rejected: one monolithic `BriefCard` component owning intent+blast+risks+history.*
    It mirrors the design source's `BriefCard` more literally but collapses four
    independently-loading, independently-tested cards into one, multiplies the
    edge-case surface, and throws away working tests. Re-parenting is lower risk.
- **Risk Areas: co-located chip component, not the vendored `Chip`.** The vendored
  `Chip` (`vendor/ui/primitives/Chip.tsx`) hard-codes accent colors on `active` and
  exposes no `aria-expanded`/`aria-controls`, so it can't express a severity-tinted,
  keyboard-expandable chip without editing a vendored file (forbidden). I add a
  small co-located `RiskAreas` component that owns the chips + inline expand and
  reuses the existing `severityColor` map idiom.
- **Hover/expand without a portal.** No Tooltip primitive exists, and the codebase's
  portal popovers (`FindingsHoverCard`, `MultiFindingBadge`) carry documented
  scroll-detach gotchas (`client/INSIGHTS.md`). The chip detail is therefore an
  **inline expandable region** (click-to-pin via `aria-expanded`, reveal-on-hover/focus
  via local state, full text via native `title=`), which is keyboard- and
  screen-reader-accessible and avoids the portal class of bugs entirely.
- **Loading: height-stable skeletons, not `return null`.** `IntentCard` and
  `BlastRadius` currently `return null` while their hook loads, which would flash a
  half-empty grid (left or right cell collapsing to zero height until the other
  resolves). Each loading branch renders a fixed-height card skeleton instead so the
  grid stays stable. This is the cross-cutting "avoid a half-empty flashing grid"
  fix, applied in the phase that already edits each file (Blast in P2, Intent in P3).

---

## Implementation steps (by phase)

### Phase 1 — "PR Brief" group + two-column grid (backbone)

**Files:** `OverviewTab/OverviewTab.tsx`, `OverviewTab/styles.ts`,
`messages/en/brief.json`, `OverviewTab/OverviewTab.test.tsx`.

1. **Add the `prBrief` i18n key** — `messages/en/brief.json`
   - Change type: modify
   - What: add top-level key `"prBrief": "PR Brief"` (sibling of `block`,
     `noRisks`, `intent`, …). Leave all existing keys intact.
   - Verify: `node_modules/.bin/tsc --noEmit` clean; key resolves in the test below.

2. **Add grid + layout style objects** — `OverviewTab/styles.ts`
   - Change type: modify (extend the exported `s` object; keep `descriptionBox`)
   - What: add
     ```ts
     briefBody: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
     briefGrid: {
       display: "grid",
       gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
       gap: 20,
       alignItems: "start",
     } satisfies CSSProperties,
     cell: { minWidth: 0 } satisfies CSSProperties,          // left grid cell — lets content shrink/ellipsis
     rightCol: { display: "flex", flexDirection: "column", gap: 20, minWidth: 0 } satisfies CSSProperties,
     ```
   - Note: `minWidth: 0` on both cells is load-bearing — a CSS grid item defaults to
     `min-width: auto`, which prevents the Blast card's long paths (Phase 2) from
     ellipsing/scrolling and would overflow the track instead.
   - Verify: `tsc --noEmit` clean.

3. **Re-parent the brief into the grid** — `OverviewTab/OverviewTab.tsx`
   - Change type: modify
   - What: wrap the verdict + grid in a `PR BRIEF` section; move `IntentCard`,
     `BlastRadius`, `PriorPrs` into the grid; keep `Description` full-width below.
     `RisksCard` stays as-is in Phase 1 (it is removed in Phase 3). New body:
     ```tsx
     const t = useTranslations("brief");           // add import { useTranslations } from "next-intl"
     return (
       <>
         <section>
           <SectionLabel icon="FileText">{t("prBrief")}</SectionLabel>
           <div style={s.briefBody}>
             {latestReview?.verdict && (
               <VerdictBanner /* …unchanged props… */ />
             )}
             <div style={s.briefGrid}>
               <div style={s.cell}>
                 <IntentCard prId={prId} />
               </div>
               <div style={s.rightCol}>
                 <BlastRadius prId={prId} repoFullName={repoFullName} />
                 <PriorPrs prId={prId} repoFullName={repoFullName} />
               </div>
             </div>
           </div>
         </section>

         {/* RisksCard remains here in P1 only; removed in P3 */}
         <RisksCard prId={prId} />

         {prBody && (
           <section>
             <SectionLabel icon="MessageSquare">Description</SectionLabel>
             <div style={s.descriptionBox}>{prBody}</div>
           </section>
         )}
       </>
     );
     ```
   - Note: the outer `<>` siblings still sit inside `page.tsx`'s `gap: 24` flex
     column, so PR-Brief section / (P1-only) RisksCard / Description keep 24px
     vertical rhythm. The verdict + grid get the tighter 20px rhythm from `briefBody`.
   - Verify: `tsc --noEmit`; the test in step 4.

4. **Update OverviewTab test for the new structure** — `OverviewTab/OverviewTab.test.tsx`
   - Change type: modify
   - What: add an assertion that `screen.getByText("PR Brief")` renders (the new
     section label; DOM text keeps source casing even though CSS uppercases it — see
     `client/INSIGHTS.md`). Existing assertions (`PR SCORE`, score `61`, the blast
     empty-state string, no-score-when-null) remain valid. The test already imports
     the real `brief.json`, so the new `prBrief` key is covered automatically.
   - Verify: `node_modules/.bin/vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/OverviewTab.test.tsx`.

**Phase 1 verification:** `tsc --noEmit`; the OverviewTab vitest file green; manual:
at ≥1080px Intent sits left / Blast (with Prior PRs nested under it) sits right;
shrink the window → grid collapses to one column with no `@media`; Description stays
full-width below; verdict card spans full width above the grid.

### Phase 2 — Blast Radius half-width hardening

**Fix:** real-world long paths (e.g. `apps/web/app/api/cron/.../route.ts`) and the
stat row + Tree/Graph toggle overflow a ~500px column once Blast is half-width.

**Files:** `BlastRadius/styles.ts`, `BlastRadius/BlastRadius.tsx` (two `title=`
attrs + a loading skeleton), optionally `PriorPrs/styles.ts`.

1. **Stat row + header wrap gracefully** — `BlastRadius/styles.ts`
   - Change type: modify
   - What: on `header` add `flexWrap: "wrap"` + `rowGap: 8`; on `statRow` add
     `flexWrap: "wrap"` + `rowGap: 6` and reduce `gap` from `16` to `12`. Keep
     `toggleGroup.flexShrink: 0` so the segmented control never compresses. This lets
     the toggle drop below the stats when the column is too narrow for both on one row.
   - Verify: `tsc --noEmit`; visual at narrow width.

2. **Ellipsis the per-symbol file path** — `BlastRadius/styles.ts` + `BlastRadius.tsx`
   - Change type: modify
   - What (styles): on `symbolHeader` add `minWidth: 0`; on `symbolChip` add
     `flexShrink: 0`; on `symbolFile` add
     `{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flexShrink: 1 }`;
     `symbolCount` already has `flexShrink: 0`.
   - What (component): render the path with a `title` so the full value is available
     on hover — `BlastRadius.tsx:229` becomes
     `<span style={s.symbolFile} title={group.file}>{group.file}</span>`.
   - Verify: a long `group.file` ellipses inside the narrow card and shows full text
     on hover; `tsc --noEmit`.

3. **Horizontal-scroll the caller `file:line` rows** — `BlastRadius/styles.ts` + `BlastRadius.tsx`
   - Change type: modify
   - What (styles): on `callerList` add `overflowX: "auto"`; on `callerItem` add
     `whiteSpace: "nowrap"` + `minWidth: 0`; on `callerLink` and `callerLinkPlain`
     add `whiteSpace: "nowrap"`. Horizontal scroll (not ellipsis) is chosen for
     callers because the trailing `:line` must stay readable.
   - What (component): add `title={label}` to the caller `<a>`/`<span>`
     (`BlastRadius.tsx:294,304`).
   - Verify: long caller paths scroll within the card instead of widening the column.

4. **Loading skeleton (no half-empty grid)** — `BlastRadius/BlastRadius.tsx`
   - Change type: modify
   - What: replace `if (isLoading) return null;` (`BlastRadius.tsx:39`) with a
     height-stable placeholder so the right grid cell holds its height while the
     left (Intent) cell resolves:
     ```tsx
     if (isLoading) {
       return (
         <section>
           <SectionLabel icon="Workflow">Blast Radius</SectionLabel>
           <div style={s.card}><div style={{ padding: 16 }}><Skeleton height={120} /></div></div>
         </section>
       );
     }
     ```
     (`Skeleton` from `@devdigest/ui`.)
   - Verify: `tsc --noEmit`; the existing `BlastRadius.test.tsx` / `BlastGraph.test.tsx`
     still green (they assert on resolved content, not the loading branch).

5. **(Conditional) Prior PRs title wrap in the narrow card** — `PriorPrs/styles.ts`
   - Change type: modify (only if it overflows — verify first)
   - What: `prLink` is a flex row of `prNumber` + `prTitle`; a long title can
     overflow at half width. If so, add `minWidth: 0` to `prLink`, `flexShrink: 0` to
     `prNumber`, and `overflowWrap: "anywhere"` to `prTitle` so the title wraps.
   - Verify: a long prior-PR title wraps inside the nested accordion at ~500px.

**Phase 2 verification:** import a real repo + PR (the doc names **cal.com #29672**)
and confirm the half-width Blast card holds together — long symbol paths ellipsis,
caller rows scroll, stats/toggle wrap, nested Prior PRs fit; `tsc --noEmit`; the two
Blast vitest files green.

### Phase 3 — Risk Areas into the Intent card (chips + hover/expand)

**Goal:** risks render **inside** the Intent card, below the scopes, as
severity-tinted chips with an inline expandable detail; the standalone `RisksCard`
sibling is removed. No data is lost — every chip can reveal its `explanation` +
`file_refs`.

**Files (create):** `IntentCard/RiskAreas.tsx`, `IntentCard/RiskAreas.test.tsx`.
**Files (modify):** `IntentCard/IntentCard.tsx`, `IntentCard/styles.ts`,
`OverviewTab/OverviewTab.tsx`, `messages/en/brief.json`.
**Files (delete):** `RisksCard/RisksCard.tsx`, `RisksCard/styles.ts`,
`RisksCard/index.ts`, `RisksCard/RisksCard.test.tsx` (the whole folder; it is plain
source — not vendor, not a migration, not a DB table — so deletion is permitted).

1. **Add the `riskAreas` i18n key** — `messages/en/brief.json`
   - Change type: modify
   - What: add `"riskAreas": "Risk Areas"`. The existing `risks.{high,medium,low}`
     keys are reused for severity wording in chip `aria-label`/`title`. (Leave the
     now-unused `block.risks` and `noRisks` keys in place — harmless; optional later
     cleanup. **Do not** delete them in this phase to keep the diff scoped.)
   - Verify: `tsc --noEmit`.

2. **Create the `RiskAreas` chip component** — `IntentCard/RiskAreas.tsx` (new)
   - Change type: add
   - What: a self-fetching component placed inside the Intent card body. Behavior:
     - Calls `useRisks(prId)` from `@/lib/hooks/brief`.
     - While loading → `return null` (no label flash; the intent body above already
       holds the card's height).
     - When `!risks || risks.risks.length === 0` → `return null` (no bare "RISK
       AREAS" label — see edge cases).
     - Otherwise render: a top divider (reuse `s.divider` from IntentCard styles), a
       `RISK AREAS` sub-label (`brief.riskAreas`, styled like `s.scopeLabel`), then a
       wrapped chip row.
   - Chip markup (one per risk), the **locked chips + hover/expand** design:
     ```tsx
     const sev = r.severity;                      // "high" | "medium" | "low"
     const open = openIdx === i || hoverIdx === i;
     const detailId = `risk-detail-${prId}-${i}`;
     const SevIcon = Icon[RISK_ICON[sev]];        // high→AlertOctagon, medium→AlertTriangle, low→Info
     <div style={s.riskChipWrap}>
       <button
         type="button"
         style={{ ...s.riskChip, color: severityColor[sev].c, background: severityColor[sev].bg,
                  borderColor: severityColor[sev].c }}
         aria-expanded={openIdx === i}
         aria-controls={detailId}
         title={r.explanation}
         onClick={() => setOpenIdx(openIdx === i ? null : i)}
         onMouseEnter={() => setHoverIdx(i)}
         onMouseLeave={() => setHoverIdx((h) => (h === i ? null : h))}
         onFocus={() => setHoverIdx(i)}
         onBlur={() => setHoverIdx((h) => (h === i ? null : h))}
       >
         <SevIcon size={12} aria-hidden="true" />
         <span style={s.riskChipTitle}>{r.title}</span>
       </button>
       {open && (
         <div id={detailId} role="region" aria-label={r.title} style={s.riskDetail}>
           <p style={s.riskExplanation}>{r.explanation}</p>
           {r.file_refs.length > 0 && (
             <div style={s.riskFileRefs}>
               {r.file_refs.map((ref, j) => (
                 <span key={j} style={s.riskFileRef}>
                   <Icon.FileText size={11} aria-hidden="true" /> {ref}
                 </span>
               ))}
             </div>
           )}
         </div>
       )}
     </div>
     ```
     - State: `const [openIdx, setOpenIdx] = React.useState<number | null>(null)`
       (click-pin, single-open accordion) and
       `const [hoverIdx, setHoverIdx] = React.useState<number | null>(null)`
       (hover/focus reveal). `open = openIdx === i || hoverIdx === i`. `aria-expanded`
       reflects only the **pinned** state (`openIdx === i`) so screen readers report
       the deliberate toggle, while mouse/focus users still get the transient reveal.
     - `RISK_ICON` is a local `Record<RiskSeverity, IconName>` —
       `{ high: "AlertOctagon", medium: "AlertTriangle", low: "Info" }` (all three
       exist in `vendor/ui/icons.tsx`).
   - Accessibility summary: each chip is a real `<button>` (Tab-focusable,
     Enter/Space toggles), carries `aria-expanded` + `aria-controls`, the revealed
     panel is `role="region"` with `aria-label={title}`, the severity icon is
     `aria-hidden` (color is not the sole signal — the title text carries meaning),
     and `title=` gives a native hover tooltip for the full explanation.
   - Verify: `tsc --noEmit`; tests in step 5.

3. **Add Risk Areas + chip styles** — `IntentCard/styles.ts`
   - Change type: modify
   - What: add (and, per `client/INSIGHTS.md`, export `severityColor` as a **separate
     named const**, not inside `s` — a `Record` is not assignable to `CSSProperties`):
     ```ts
     // inside `s`:
     riskAreasSection: { padding: "0 16px 14px" } satisfies CSSProperties,
     riskChipRow: { display: "flex", flexWrap: "wrap", gap: 8 } satisfies CSSProperties,
     riskChipWrap: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 } satisfies CSSProperties,
     riskChip: {
       display: "inline-flex", alignItems: "center", gap: 6,
       padding: "4px 10px", borderRadius: 6, fontSize: 12.5, fontWeight: 600,
       borderStyle: "solid", borderWidth: 1, cursor: "pointer",
       maxWidth: "100%",
     } satisfies CSSProperties,
     riskChipTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
     riskDetail: {
       padding: "8px 10px", borderRadius: 6,
       background: "var(--bg-surface)", borderStyle: "solid", borderWidth: 1, borderColor: "var(--border)",
       display: "flex", flexDirection: "column", gap: 6,
     } satisfies CSSProperties,
     riskExplanation: { fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 } satisfies CSSProperties,
     riskFileRefs: { display: "flex", flexWrap: "wrap", gap: 8 } satisfies CSSProperties,
     riskFileRef: {
       display: "inline-flex", alignItems: "center", gap: 4,
       fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--text-muted)",
     } satisfies CSSProperties,
     // separate named export (outside `s`):
     export const severityColor: Record<RiskSeverity, { c: string; bg: string }> = {
       high:   { c: "var(--crit)", bg: "var(--crit-bg)" },
       medium: { c: "var(--warn)", bg: "var(--warn-bg)" },
       low:    { c: "var(--sugg)", bg: "var(--sugg-bg)" },
     };
     ```
     `import type { RiskSeverity } from "@devdigest/shared"` at the top of the file.
     This is the same `severityColor` map as the deleted `RisksCard/styles.ts:79-83`
     (preserves the high/medium/low → crit/warn/sugg palette).
   - Border-shorthand caution (`client/INSIGHTS.md`): `riskChip` sets `borderColor`
     only via the per-render spread alongside `borderWidth`/`borderStyle` longhands —
     it never mixes the `border` shorthand with a per-side override, and it sets all
     four sides via the single `borderColor`, so no `borderLeftColor`-style collision
     can occur.
   - Verify: `tsc --noEmit`.

4. **Mount `RiskAreas` inside the Intent card + remove the sibling** —
   `IntentCard/IntentCard.tsx` and `OverviewTab/OverviewTab.tsx`
   - Change type: modify
   - What (IntentCard): render `<RiskAreas prId={prId} />` inside the card `<div>`,
     **after** the intent block, so it shows whether the intent block is
     `IntentContent` or `EmptyState`:
     ```tsx
     <div style={s.card}>
       {!intent ? <EmptyState … /> : <IntentContent … />}
       <RiskAreas prId={prId} />
     </div>
     ```
     `RiskAreas` self-handles its own top divider and null states, so when there are
     no risks the card looks exactly as it does today.
   - What (OverviewTab): delete the `import { RisksCard }` line and the
     `<RisksCard prId={prId} />` element added in Phase 1.
   - What (delete): remove the `RisksCard/` folder.
   - Verify: `tsc --noEmit` (confirms no dangling `RisksCard` import anywhere — grep
     `rg "RisksCard" client/src` should return zero hits after this step).

5. **Tests** — `IntentCard/RiskAreas.test.tsx` (new) + `IntentCard/IntentCard.test.tsx`
   - Change type: add / modify
   - What (`RiskAreas.test.tsx`): mirror `RisksCard.test.tsx`'s harness
     (`QueryClientProvider` + `NextIntlClientProvider messages={{ brief }}`, `fetch`
     mocked, `jsonResp`). Assert:
     - chips render the risk **titles** (e.g. `getByText("SQL injection in user query")`),
     - the explanation is **not** in the DOM until expanded
       (`expect(screen.queryByText(/concatenated directly/)).toBeNull()`),
     - `fireEvent.click` on the chip (`getByRole("button", { name: /SQL injection/i })`)
       reveals the explanation **and** the `file_refs` (`src/db/queries.ts`),
     - `fireEvent.mouseEnter` on the chip also reveals the explanation (hover path),
     - the chip carries `aria-expanded="false"` initially and `"true"` after click,
     - null / empty-array responses render **nothing** (component returns null) —
       `expect(screen.queryByText("Risk Areas")).toBeNull()`.
     Use `fireEvent` (no `user-event` in this package) and `getByRole`/`aria-label`
     queries per `client/INSIGHTS.md`.
   - What (`IntentCard.test.tsx`): the existing tests mock `fetch` returning a single
     body for every call; now that `IntentCard` also mounts `RiskAreas` (→ `useRisks`
     → `GET /pulls/:id/risks`), the mock must branch on the URL so `/risks` returns
     `null` (no risk chips) while `/intent` returns the intent fixture — otherwise the
     intent fixture is fed to `useRisks` and `Risks` shape mismatches surface.
     Switch the fixtures to a URL-branching `vi.fn((url) => …)` like
     `OverviewTab.test.tsx` does. The `risks` namespace is already in `brief.json`
     (already provided to the test). No assertion changes beyond the fetch mock.
   - Verify: `vitest run …/IntentCard/` (both files).

**Phase 3 verification:** `tsc --noEmit`; `rg RisksCard client/src` empty; the
IntentCard + RiskAreas vitest files green; manual: a PR with risks shows chips under
the scopes inside the Intent card, click/hover reveals detail, keyboard Tab reaches
each chip and Enter toggles it.

### Phase 4 — In Scope / Out of Scope → two columns

**Goal:** the two scope lists sit side-by-side and collapse to one column on narrow
widths, with no `@media`.

**Files:** `IntentCard/IntentCard.tsx`, `IntentCard/styles.ts`.

1. **Grid-ify `scopeSection`** — `IntentCard/styles.ts`
   - Change type: modify
   - What: change `scopeSection` (currently padding-only, `styles.ts:30-32`) to a
     responsive 2-col grid and add a cell wrapper style:
     ```ts
     scopeSection: {
       padding: "0 16px 14px",
       display: "grid",
       gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
       columnGap: 24,
       rowGap: 4,
       alignItems: "start",
     } satisfies CSSProperties,
     scopeCol: { minWidth: 0 } satisfies CSSProperties,
     ```
   - Verify: `tsc --noEmit`.

2. **Wrap each scope block as a grid cell** — `IntentCard/IntentCard.tsx`
   - Change type: modify
   - What: in `IntentContent`, wrap each `(label + ul)` pair (`IntentCard.tsx:122-150`)
     in `<div style={s.scopeCol}>…</div>` so each is one grid cell:
     ```tsx
     <div style={s.scopeSection}>
       {intent.in_scope.length > 0 && (
         <div style={s.scopeCol}>
           <p style={s.scopeLabel}>…inScope…</p>
           <ul style={s.scopeList}>…</ul>
         </div>
       )}
       {intent.out_of_scope.length > 0 && (
         <div style={s.scopeCol}>
           <p style={s.scopeLabel}>…outOfScope…</p>
           <ul style={s.scopeList}>…</ul>
         </div>
       )}
     </div>
     ```
     With `auto-fit` + `minmax(200px,1fr)`, when only one block is present it spans
     the full width (single column); when both are present they sit side-by-side and
     collapse to one column under ~424px of card width.
   - Verify: `tsc --noEmit`; existing IntentCard scope assertions still pass (text
     nodes unchanged); manual: both scopes side-by-side wide, stacked narrow.

**Phase 4 verification:** `tsc --noEmit`; IntentCard vitest green; manual at wide
(side-by-side) and narrow (stacked) widths, plus the one-list and no-list cases.

### Phase 5 — Visual fidelity polish

**Files:** `IntentCard/IntentCard.tsx`, `IntentCard/styles.ts`,
`IntentCard/IntentCard.test.tsx`. (5c folded into Phase 3; **5d skipped** — see the
cost-data verdict above; `VerdictBanner` untouched.)

1. **5a — italic, curly-quoted intent summary** — `IntentCard.tsx` + `styles.ts`
   - Change type: modify
   - What (component): `IntentCard.tsx:112` becomes a single text node wrapped in
     curly quotes: `<p style={s.summaryText}>{`“${intent.intent}”`}</p>`
     (keeping one text node avoids the RTL multi-node split; see `client/INSIGHTS.md`).
   - What (styles): add `fontStyle: "italic"` to `s.summaryText`.
   - Test impact: `IntentCard.test.tsx:53` asserts the exact unquoted string and will
     **break**. Update that assertion (and any other exact-summary match) to a
     substring regex `getByText(/Add rate limiting to public API endpoints\./)` so
     the test is robust to the quote characters.
   - Verify: `tsc --noEmit`; IntentCard vitest green.

2. **5b — green `✓ IN SCOPE` / red `✗ OUT OF SCOPE` label icons** — `IntentCard.tsx` + `styles.ts`
   - Change type: modify
   - What (component): the scope label is currently a bare `<p style={s.scopeLabel}>`.
     Render an icon before the text:
     ```tsx
     <p style={{ ...s.scopeLabel, ...s.scopeLabelRow }}>
       <Icon.Check size={12} style={{ color: "var(--ok)" }} aria-hidden="true" />
       {inScopeLabel}
     </p>
     …
     <p style={{ ...s.scopeLabel, ...s.scopeLabelRow }}>
       <Icon.X size={12} style={{ color: "var(--crit)" }} aria-hidden="true" />
       {outOfScopeLabel}
     </p>
     ```
     `Icon` from `@devdigest/ui`; `Check` and `X` both exist in the registry; `--ok`
     and `--crit` are already used by `VerdictBanner/constants.ts`.
   - What (styles): add
     `scopeLabelRow: { display: "flex", alignItems: "center", gap: 5 } satisfies CSSProperties`.
   - Test impact: scope label text nodes are unchanged (the icon is a separate
     element), so the in/out-of-scope item assertions and the `In scope` / `Out of
     scope` label text still match. No new assertions required.
   - Verify: `tsc --noEmit`; IntentCard vitest green; manual: green check on IN SCOPE,
     red ✗ on OUT OF SCOPE.

3. **5c** — folded into Phase 3 (chips). No work.

4. **5d — cost line** — **SKIPPED.** `ReviewRecord` carries no cost/token fields
   (review-api.ts:23-38). No file changes. See the cost-data verdict section.

**Phase 5 verification:** `tsc --noEmit`; IntentCard vitest green (with the updated
5a assertion); manual visual diff against the mockup for the italic-quoted intent and
the colored scope icons.

---

## Edge-case matrix

Every cross-cutting edge case from the phases doc, the exact rendering behavior, and
the component/branch that owns it.

| Edge case | Exact behavior | Owner / branch |
|-----------|----------------|----------------|
| **No intent computed** (intent null) | Intent card still renders; the intent slot shows the `EmptyState` (`No intent computed…` + Recalculate). `RiskAreas` renders **independently** below it, so risk chips still appear if risks exist. | `IntentCard.tsx` `{!intent ? <EmptyState/> : <IntentContent/>}` + `<RiskAreas/>` always mounted after it. |
| **No intent AND no risks** | Card shows only the `EmptyState` row; `RiskAreas` returns `null` (no divider, no `RISK AREAS` label). Identical to today's empty card. | `RiskAreas` early `return null` on `!risks || risks.length === 0`. |
| **Intent present, no risks** | Full intent block; `RiskAreas` returns `null` → no bare label, no trailing divider. | Same `RiskAreas` null branch. |
| **No risks (general)** | Risk Areas sub-section is fully absent (not an empty hint). | `RiskAreas` null branch. |
| **in_scope empty, out_of_scope present** (or vice-versa) | The 2-col scope grid renders **one** cell; `auto-fit`+`minmax(200px,1fr)` makes the single cell span full width. The pre-scope divider still shows because at least one list is non-empty. | `IntentContent` conditional blocks (`IntentCard.tsx:118-120,123,137`). |
| **Both scope lists empty** | No divider (`intent.in_scope.length || intent.out_of_scope.length` guard is false), no scope grid; intent summary + Recalculate only. | `IntentContent` divider guard. |
| **No review / no verdict** | `VerdictBanner` not rendered; the `PR BRIEF` label + `briefGrid` (Intent left, Blast right) still render. | `OverviewTab` `{latestReview?.verdict && <VerdictBanner/>}` inside `briefBody`. |
| **No score (verdict set, score null)** | VerdictBanner renders without the `CircularScore` column (self-guards `score != null`). | `VerdictBanner.tsx:50`. |
| **Blast index degraded / partial** | Degraded/partial badge above the card; symbol tree + empty/note states inside the **narrower** right column (now wrapping + scrolling, Phase 2). | `BlastRadius.tsx:41-44,66-75`. |
| **Blast 0 symbols** | `isEmpty` true → single `blast.empty` line ("No impacted symbols found…"). | `BlastRadius.tsx:57,128-129`. |
| **Blast symbols > 0 but 0 callers / 0 endpoints / 0 cron** | Symbol tree still renders; `noDownstream` note shown above it. (Do **not** regress to the old `|| !hasCallers` collapse — see `client/INSIGHTS.md`.) | `BlastRadius.tsx:59,139-143`. |
| **Loading** (intent/blast hooks pending) | Each column renders a height-stable `Skeleton` card instead of `null`, so the grid never flashes a zero-height half. Verdict (prop-driven) needs no skeleton. `RiskAreas` returns `null` while its `useRisks` loads (the intent body above holds height). | `BlastRadius.tsx` loading branch (P2 step 4); `IntentCard` loading branch (see Risks below — convert its `return null` similarly if visible flash observed); `RiskAreas` null-while-loading. |
| **Narrow viewport** | `briefGrid` collapses 2→1 column (`auto-fit` minmax 380px); `scopeSection` collapses 2→1 (minmax 200px); Blast stat row + toggle wrap; long paths ellipsis/scroll. All without `@media`. | `OverviewTab/styles.ts` `briefGrid`; `IntentCard/styles.ts` `scopeSection`; `BlastRadius/styles.ts` (P2). |
| **Long file paths at half width** | Symbol path ellipses (full value in `title=`); caller `file:line` rows horizontally scroll; prior-PR titles wrap. | `BlastRadius/styles.ts` + `.tsx` (P2 steps 2-3); `PriorPrs/styles.ts` (P2 step 5). |
| **repoFullName null** (links unavailable) | Blast caller rows + prior-PR rows render as plain text (existing graceful fallbacks); layout unaffected. | `BlastRadius.tsx:293-305`, `PriorPrs.tsx:81-86`. |

> **IntentCard loading note:** `IntentCard.tsx:29-31` currently `return null` while
> `useIntent` loads. Because the left grid cell would then be empty until intent
> resolves, convert it to the same height-stable skeleton pattern as Blast (render
> the `<section>` + `SectionLabel icon="Target"` + a `<div style={s.card}><Skeleton
> height={88} /></div>`). Fold this into **Phase 3** (which already edits
> `IntentCard.tsx`) so the grid is symmetric. Listed here because it is the
> cross-cutting "avoid half-empty flashing grid" requirement, not a P3-specific change.

## Chip + hover-detail design (Risk Areas) — summary

- **Chip markup:** a `<button type="button">` per risk: severity icon
  (`AlertOctagon`/`AlertTriangle`/`Info`) + ellipsised title; tinted via
  `severityColor[sev]` (text color + bg + border color), reusing the
  high→crit / medium→warn / low→sugg palette.
- **Severity → color:** `severityColor` (separate named export, per the
  `styles.ts`-can't-hold-a-Record rule). Same map as the removed `RisksCard`.
- **Reveal mechanism (no Tooltip primitive exists):**
  - **Click** toggles a pinned inline detail region (`openIdx`), with
    `aria-expanded`/`aria-controls` pointing at `id={detailId}`.
  - **Hover/Focus** transiently reveals the same region (`hoverIdx` via
    `onMouseEnter`/`onMouseLeave`/`onFocus`/`onBlur`).
  - **Native `title=`** on the chip carries the full explanation for a zero-JS
    hover tooltip.
  - The region (`role="region"`, `aria-label={title}`) shows `explanation` +
    `file_refs` (each with a `FileText` icon). No portal — avoids the documented
    scroll-detach gotchas.
- **Accessibility:** real button (Tab + Enter/Space), `aria-expanded` mirrors the
  pinned state only, `aria-controls` links the region, icons `aria-hidden` (title
  text is the non-color signal), single-open accordion keeps focus predictable.

## Test plan

| File | Change | New/updated assertions |
|------|--------|------------------------|
| `OverviewTab/OverviewTab.test.tsx` | modify | Assert `getByText("PR Brief")` renders. Keep `PR SCORE` / `61` / blast-empty / no-score-when-null. (Uses real `brief.json`, so `prBrief` is covered.) After P3, the existing all-null fetch mock already yields no risk chips — no change needed there. |
| `IntentCard/RiskAreas.test.tsx` | **add** | Titles render; explanation hidden until expand; `fireEvent.click` reveals explanation + `file_refs`; `fireEvent.mouseEnter` reveals explanation; `aria-expanded` flips false→true on click; null & empty-array → component renders nothing (`queryByText("Risk Areas")` null). `fireEvent` only; `getByRole("button", { name: /…/ })`. |
| `IntentCard/IntentCard.test.tsx` | modify | Switch the fetch mock to URL-branching (`/risks` → null, `/intent` → fixture) so `useRisks` gets a valid shape. Update the 5a summary assertion to the substring regex `/Add rate limiting to public API endpoints\./`. Scope-grid (P4) and scope-icon (5b) changes leave text nodes intact → existing scope-item assertions unchanged. |
| `RisksCard/RisksCard.test.tsx` | **delete** | Removed with the `RisksCard/` folder in P3; its coverage migrates to `RiskAreas.test.tsx`. |
| `BlastRadius/BlastRadius.test.tsx`, `BlastGraph.test.tsx` | unchanged | P2 only touches styles + `title=` + the loading branch; these tests assert resolved content, so they stay green. Re-run to confirm. |

All client tests are hermetic with `fetch` mocked (per `client/CLAUDE.md` /
`TESTING.md`); no API/DB needed. Remember the next-intl namespace rule: any test that
mounts a component using `useTranslations("<ns>")` must pass that namespace in the
provider `messages` (RiskAreas uses `brief`, already supplied).

## Acceptance criteria

End-to-end, after all five phases:

1. **Typecheck + tests green (the client gate):**
   - `cd client && node_modules/.bin/tsc --noEmit` → no errors.
   - `node_modules/.bin/vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/{OverviewTab,IntentCard,BlastRadius}`
     → all green (OverviewTab, IntentCard, RiskAreas, BlastRadius, BlastGraph).
   - `node_modules/.bin/vitest run` (full client suite) → green; `rg "RisksCard" client/src`
     → **zero hits** (sibling fully removed).
   - (Per `client/INSIGHTS.md`, invoke the package-local binaries directly — `pnpm`
     wrappers hard-fail on the deps-status pre-flight in this environment.)
2. **Visual, wide (≥1080px):** `PR BRIEF` label → full-width verdict card → Intent
   (left: italic-quoted intent, ✓/✗ colored scope columns side-by-side, severity
   chips) and Blast Radius (right) with Prior PRs nested at the bottom of the right
   column; Description full-width below the grid.
3. **Visual, narrow:** the brief grid and the scope columns each collapse to one
   column with no horizontal page scroll and no `@media`; Blast stat row/toggle wrap;
   long symbol paths ellipsis and caller rows scroll within the card.
4. **Risk chips:** clicking a chip expands its explanation + file refs; hovering a
   chip reveals the same; Tab reaches each chip and Enter/Space toggles it;
   `aria-expanded` reflects the pinned state.
5. **Real-data check (Phase 2):** with **cal.com #29672** imported, the half-width
   Blast card renders real long paths without overflowing the column.
6. **No cost line** appears on the verdict card (5d skipped — data absent).

## Risks / out of scope / open questions

- **Risks:**
  - *Grid `min-width` overflow:* if any grid cell omits `minWidth: 0`, long Blast
    paths overflow the track instead of ellipsing/scrolling. The `cell`/`rightCol`
    wrappers exist precisely for this — don't drop them.
  - *Border-shorthand console error:* the chip's per-render `borderColor` must not be
    paired with any `border<Side>Color`; keep `borderStyle`/`borderWidth` as longhands
    and set color via the single `borderColor` (per `client/INSIGHTS.md`).
  - *next-intl silent miss:* forgetting the `brief` namespace in a new test's provider
    logs `MISSING_MESSAGE` to stderr while the test still passes — check stderr.
  - *5a test break:* the curly-quote change breaks the exact-string summary assertion;
    the test update is mandatory, not optional.
  - *Deleting `RisksCard/`:* ensure no other importer exists (`rg RisksCard`) before
    removing — `tsc` will catch a dangling import, but grep first.
- **Out of scope:** any server / `reviewer-core` / DB / contract change; new
  endpoints; the cost line (5d); adding new locales (only `en` exists); refactoring
  `BlastRadius` internals beyond path/overflow hardening; touching `src/vendor/**`.
- **Open questions / assumptions:**
  - *Cost line:* assumed permanently skipped for this effort because `ReviewRecord`
    has no cost/token field. If a future effort wants `$0.014 · 8.2K→1.3K` on the
    verdict, it must thread run-level `cost_usd`/`tokens_in/out` (already on
    `contracts/trace.ts`) into the Overview — a backend/plumbing change explicitly
    excluded here. Escalate rather than improvise.
  - *Single-open vs multi-open chips:* assumed single-open accordion (`openIdx`) for
    predictable focus; if the design wants several details open at once, switch
    `openIdx` to a `Set<number>` — no other change.
  - *Unused `block.risks` / `noRisks` keys* left in `brief.json` after P3; assumed
    harmless. A later cleanup commit may remove them.
  - *Prior-PRs narrow tweak (P2 step 5)* is conditional — verify overflow against
    real data before editing `PriorPrs/styles.ts`.
