# Plan: Blast Radius — design-fidelity + correctness fixes

## Understanding
The Blast Radius panel (PR Overview tab) drifted from its polished design and
carries two confirmed correctness bugs, plus a dishonest empty/partial state.
This plan closes the gap in three approvable tiers: **P1** fixes two real bugs
(endpoint/cron badges rendered at the wrong level, and a global instead of
per-symbol caller cap on the backend); **P2** makes a `partial` repo-intel index
honest (a "0 callers because the index is incomplete" case must look different
from "this code genuinely has no callers"); **P3** lands the design-fidelity
visual fixes scoped strictly to the Blast Radius component (collapsible symbol
tree with per-symbol caller count, code-chip symbol format, per-stat icons,
copy/casing, section icon). Page-level redesign items are explicitly deferred.

## Design verification (against `~/Downloads/DevDigest Design (standalone) (3).html`)
Decoded the design bundle (a gzip+base64 `__bundler/manifest`) and read the real
`BlastRadius` component (`blast.jsx`), its `Badge`/`MonoLink` primitives, and the
PR-overview screen. Decisions below are now grounded in source, not just screenshots.

**Confirmed by source:**
- Section header is `SectionLabel({ icon: "Workflow" }, "Blast radius")` on the
  overview screen → step 8's `Workflow` is exact (the "hexagon" in the screenshot is
  lucide's Workflow glyph). **No vendored-icon edit needed.**
- Stat row = icon+number+label groups: `Code` symbols · `CornerDownRight` callers ·
  `Globe` endpoints · `Clock` cron; label is **"cron"** (singular). Groups use
  `gap:16` — **no `·` middot separators** (drop them).
- Symbol chip = `Code` icon (`var(--accent)`) + mono `name + "()"`; **no `kind`
  label** → confirms the "drop kind" decision. Keep our kind-aware `()` (append only
  for `function`/`method`; the design fixture is all-functions so it appends
  unconditionally, which would wrongly render a `type` as `Foo()`).
- Per-symbol caller count = plain muted text `"{n} callers"`, right-aligned
  (`marginLeft:auto`) — **not a pill**.
- Endpoint/cron badges are **per-symbol**, rendered once under the expanded caller
  list → validates P1.1.
- Graph = hierarchical node-link SVG (matches existing `BlastGraph`) + a 3-item legend.

**Design-exact refinements to fold in (see steps 6, 7, 10):**
1. **Cron badge is amber, not purple** — `color: var(--warn)` on `var(--warn-bg)`;
   current `cronBadge` (purple) is wrong. `--warn` already exists in client.
2. **Badges carry an icon + are larger** — `Globe`/`Clock` size 12 inside the pill;
   `padding:2px 8px; borderRadius:5; fontSize:11.5; fontWeight:600; gap:5`.
3. **Endpoint badge text = `var(--accent-text)` (#93bbfc)** on `var(--accent-bg)`
   (lighter than full-accent text).
4. **Toggle = subtle segmented control, not a bright-blue button** — container
   `bg:var(--bg-surface); border:1px var(--border); borderRadius:7; padding:2; gap:2`;
   buttons `padding:3px 10px; fontSize:11.5; fontWeight:600; borderRadius:5;
   border:none; textTransform:capitalize`; active `bg:var(--bg-elevated);
   color:var(--text-primary)`, inactive `transparent; color:var(--text-muted)`.
   Replaces the current `toggleBtnActive` (bright `var(--accent)`/#fff). Because
   `textTransform:capitalize` does the casing, the i18n labels can stay lowercase
   ("tree"/"graph") — making step 5's casing change optional (the `/graph/i` toggle
   test passes either way).
5. **Default expand = first symbol open, rest collapsed** (design hardcodes
   `{rateLimit:true, bucketKey:false}`). Generalize to "index 0 open" — keeps every
   existing test green (the caller-link fixture's only symbol is index 0).
6. **Chevron = one `ChevronRight` rotated 90°** (`transform`, `transition .12s`),
   not swapping `ChevronDown`/`ChevronRight`.
7. **Caller link = `MonoLink`**: default `var(--text-secondary)`, hover
   `var(--accent-text)` + underline (current is always-accent, no underline) —
   optional polish.

**Exact color tokens (design dark theme), for badge/toggle parity:**
`--accent #3b82f6` · `--accent-bg rgba(59,130,246,.12)` · `--accent-text #93bbfc` ·
`--warn #f59e0b` · `--warn-bg rgba(245,158,11,.12)` · `--bg-hover #242424` ·
`--bg-elevated #1c1c1c` · `--bg-surface #141414` · `--border #2a2a2a` ·
`--border-strong #3a3a3a` · `--text-primary #ededed` · `--text-secondary #999999` ·
`--text-muted #6a6a6a`.

## Context loaded
- Root `INSIGHTS.md` — pnpm/test-runner gotcha (run package-local `vitest`/`tsc`
  binaries, not `pnpm test`), vendored-shared "edit each copy by hand" reality.
- `client/INSIGHTS.md` — the BlastRadius `!hasCallers` empty-state history (the
  current `isEmpty` gating is the fixed version, do not regress it); the
  `IndexStatus` dual-type clash (use the local `BlastIndexStatus`, never the
  shared contract one); RTL gotchas for this package: **no `@testing-library/user-event`**
  (use `fireEvent`), interpolated-siblings break `getByText(/whole string/)`,
  duplicate text needs `getAllByText`, icon names must exist in the vendored
  registry (`GitCompare`/`GitMerge`-style "renders nothing" trap).
- `server/INSIGHTS.md` — blast service test seam (`shapeBlastResponse` is exported
  pure for hermetic tests; mirror that for any new pure helper); vendored contracts
  edited per-package; `*.it.test.ts` Ryuk/`TESTCONTAINERS_RYUK_DISABLED=true` rule.
- `client/CLAUDE.md`, `server/CLAUDE.md` — i18n strings live in `messages/`, schema-first
  routes, `src/vendor/**` is do-not-touch, append-only migrations.
- Source read: `BlastRadius.tsx`, `styles.ts`, `BlastGraph.tsx`, `BlastRadius.test.tsx`,
  `messages/en/blast.json`, `OverviewTab/OverviewTab.tsx`, `lib/types.ts:44-104`,
  `lib/hooks/blast.ts`, `vendor/ui/icons.tsx`; backend `blast/service.ts`,
  `blast/types.ts`, `repo-intel/service.ts:189-205,295-391`, `repo-intel/repository.ts:205-239,502-531`,
  `repo-intel/pipeline/full.ts:200-244`, `repo-intel/types.ts:25-50`; tests
  `blast/service.test.ts`, `blast-routes.it.test.ts`, `repo-intel-symbol-clamp.it.test.ts`.
- Skills matched: **react-best-practices** + **react-testing-library** (the panel
  is test-heavy; the test churn is the main risk) and **client-server-communication**
  (the partial-index signal + per-symbol cap shape cross the wire). I did NOT load
  their generic `SKILL.md` files: `client/INSIGHTS.md` already encodes the
  package-specific RTL rules (no user-event, interpolated-siblings, getAllByText)
  that actually govern the test edits — more authoritative here than the generic skill.

## Approach & tradeoffs

**P1.1 (badge level) — move endpoint/cron badges from `CallerItem` to `SymbolRow`.**
`group.endpoints`/`group.crons` are per-symbol fields, so they belong rendered
**once per symbol**, not threaded into every `CallerItem` (current `BlastRadius.tsx:171-172,215-224`).
Rendering them in the symbol header also fixes the disappearing-badge case: today
the caller `<ul>` only renders when `callers.length > 0` (line 163), so a symbol
with endpoints but 0 resolved callers shows no badge at all. Chosen over "render
badges in the `<ul>` header" because the header is always present regardless of
caller count.

**P1.2 (global cap) — cap callers per `viaSymbol` in the facade, not globally.**
`repo-intel/service.ts:386` does `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` on the
flat rank-desc list across ALL symbols, so a 22-symbol PR loses callers before
`shapeBlastResponse` re-slices per symbol. Replace with a per-`viaSymbol` cap.
Extract a pure exported helper `capCallersPerSymbol(callers, cap)` (mirrors the
`shapeBlastResponse` "export the pure bit for hermetic test" pattern) so it is
verifiable **without Docker**. Rejected alternative: simply *delete* the global
slice and let `shapeBlastResponse` do all capping — that leaves `totals.callers`
(`= result.callers.length`) over-counting vs. what is displayed when any symbol
exceeds 20; capping in the facade keeps the flat total and the per-symbol display
consistent and bounds the payload.

**P2 (honest partial) — frontend-only, read the existing `index.status` wire field.**
The signal is already on the wire: `getIndexState` returns the persisted state
faithfully (`repo-intel/service.ts:189-191`), so `index.status === 'partial'`
already reaches the client; `client/src/lib/types.ts:45` already types
`BlastIndexStatus` with `"partial"`; `repository.ts:218` deliberately does NOT set
`degraded` for `partial` ("partial is still a working index"). So **no backend or
contract change is needed** — `BlastRadius.tsx` detects `partial` and renders a
distinct honest badge using the existing `s.degradedBadge` style with new
partial-specific copy. Rejected alternative: set a new flag in `shapeBlastResponse`
or flip `partial` to `degraded` in `tryGetIndexState` — both are larger blast
radius (touch backend types/tests, and conflating partial with degraded loses the
distinction the comment at `repository.ts:215-217` intentionally preserves).

**P3 (visual) — all inside `BlastRadius/` (component + styles + the panel's i18n).**
Collapsible symbol rows **default to expanded** so the existing caller-link tests
keep their DOM; the `↳` connector and per-stat icons are rendered as **separate
elements** (not concatenated into the label/stat text node) to avoid the
interpolated-siblings RTL break. Section icon: use an existing registry icon
(`Workflow`) rather than adding `Network`/`Share2` — `src/vendor/ui/**` is
do-not-touch.

## Implementation steps

### P1 — confirmed bugs (each independently shippable)

1. **Render endpoint/cron badges once per symbol** — `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadius/BlastRadius.tsx`
   - Change type: modify
   - What: In `SymbolRow`, render `group.endpoints`/`group.crons` as badges in the
     symbol header (independent of caller count). Remove the `endpointBadges`/
     `cronBadges` props from `CallerItem` (lines 171-172, 193-194) and delete the
     two badge `.map()` blocks at lines 215-224; `CallerItem` becomes link-only.
     Keep using `s.badge` + `s.endpointBadge`/`s.cronBadge`.
   - Verify: `node_modules/.bin/vitest run` (in `client/`) — add two cases to
     `BlastRadius.test.tsx`: (a) `BLAST_DATA` (1 endpoint, 2 callers) →
     `getAllByText("POST /auth/login")` has length **1** (was duplicated per caller);
     (b) a symbol with `endpoints:["POST /x"]` and `callers:[]` → that badge still
     renders. `node_modules/.bin/tsc --noEmit` passes.

2. **Cap callers per symbol in the facade** — `server/src/modules/repo-intel/service.ts`
   - Change type: modify
   - What: Add `export function capCallersPerSymbol(callers: BlastCallerRow[], cap = MAX_CALLERS_PER_SYMBOL): BlastCallerRow[]`
     that walks the already-rank-desc-sorted `callers` and keeps at most `cap` per
     `viaSymbol` (a `Map<string, number>` counter, preserving order). Replace
     `callers: callers.slice(0, MAX_CALLERS_PER_SYMBOL)` at line 386 with
     `callers: capCallersPerSymbol(callers)`. (Scope: the persistent path only; the
     ripgrep degraded path at `service.ts:297-303` is out of scope.)
   - Verify: new hermetic `server/test/repo-intel-blast-cap.test.ts` (no `.it.`,
     no Docker) importing `capCallersPerSymbol`: 22 distinct `viaSymbol`s × 2 callers
     → output length **44** (the old global slice returned 20); one `viaSymbol`
     with 25 callers → 20; mixed input preserves rank-desc order within a group.
     Run `cd server && node_modules/.bin/vitest run test/repo-intel-blast-cap.test.ts`;
     `node_modules/.bin/tsc --noEmit`.

### P2 — honest partial-index state

3. **Add partial-index copy** — `client/messages/en/blast.json`
   - Change type: modify
   - What: Add a `"partial"` block: `"badge": "Index incomplete — caller data may be missing"`,
     `"explain": "The repo-intel index for this repo is partial (a large repo hit the indexing time budget). Some callers and endpoints may not be resolved yet."`
     Leave the existing `degraded.*` strings unchanged.
   - Verify: valid JSON (`node -e "require('./client/messages/en/blast.json')"`); used in step 4.

4. **Surface the partial badge** — `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadius/BlastRadius.tsx`
   - Change type: modify
   - What: Compute `const isPartial = data?.index?.status === "partial";`. Render
     an honest badge when `isDegraded || isPartial`: keep the existing degraded
     badge for `isDegraded`; when `!isDegraded && isPartial`, render a badge with
     `s.degradedBadge` style and `t("partial.badge")` (role="status",
     `aria-label={t("partial.badge")}`). The symbol tree must still render (do NOT
     gate `isEmpty` on partial — preserve the `client/INSIGHTS.md` lesson that the
     panel must not collapse to one line).
   - Verify: add a `PARTIAL_BLAST` fixture (`index.status:"partial"`, `degraded:false`,
     symbols present, `callers:[]`) and assert the partial badge copy renders AND a
     symbol name still appears (panel not blank). `vitest run` + `tsc --noEmit`.

### P3 — design-fidelity visual fixes (Blast Radius component only)

5. **Stat copy + toggle casing** — `client/messages/en/blast.json`
   - Change type: modify
   - What: `stat.crons` `"cron/jobs"` → `"cron"`; `view.tree` `"tree"` → `"Tree"`;
     `view.graph` `"graph"` → `"Graph"`. Add `"symbolToggle": "Toggle callers for {name}"`
     (used by the chevron in step 7).
   - Verify: valid JSON; test (e) graph toggle still passes (`name: /graph/i` is
     case-insensitive → matches "Graph").

6. **Per-stat icons in the summary row** — `BlastRadius.tsx` + `BlastRadius/styles.ts`
   - Change type: modify
   - What: Replace the single template-literal `statRow` (lines 70-72) with four
     segments, each an icon + its count text rendered as **separate elements**:
     `Code` (`<>`) symbols, `CornerDownRight` (`↳`) callers, `Globe` endpoints,
     `Clock` cron. Import `Icon` from `@devdigest/ui`. Add a `s.statItem` flex style.
     All four icon names exist in `vendor/ui/icons.tsx` (do not add any).
   - Verify: test (a) "header stats line" is updated (see Acceptance/test-delta) to
     query each segment (`getByText(/1 symbols/)`, `getByText(/2 callers/)`)
     individually rather than one combined regex — the segmentation splits the old
     single text node. `tsc --noEmit`.

7. **Collapsible symbol rows + per-symbol caller count + code-chip name** — `BlastRadius.tsx` + `BlastRadius/styles.ts`
   - Change type: modify
   - What: In `SymbolRow` (pass the map index `i` in as a `defaultOpen={i === 0}` prop):
     - Add local `const [open, setOpen] = React.useState(defaultOpen)` (**first
       symbol open, rest collapsed** — matches the design and keeps caller-link tests
       green since their fixture's only symbol is index 0). Header gets a chevron
       `<button>` using **one `ChevronRight` rotated 90° when open**
       (`style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}`,
       `aria-expanded={open}`, `aria-label={t("symbolToggle", { name: group.name })}`)
       that toggles `open`; the caller `<ul>` renders only when `open && callers.length > 0`.
     - Symbol name becomes a code chip: `Code` (`<>`) icon (`var(--accent)`) +
       monospace `displayName(group)` where `displayName` appends `()` for
       `function`/`method` kinds, else the bare name. **Drop the `kind` label**
       (design has none — confirmed; update the "renders the symbol kind badge" test,
       see Test deltas).
     - Add a right-aligned per-symbol count badge `t("callerCount", { count: group.callers.length })`
       (reuse existing `callerCount` string) shown regardless of `open`/count.
     - Each `CallerItem` gets a leading `CornerDownRight` (`↳`) connector rendered as
       a **separate** `<span aria-hidden>`/icon so the `file:line` label stays its own
       text node (caller-link tests unaffected).
     - Add styles: `s.symbolHeader` (flex row), `s.chevronBtn`, `s.symbolCount` badge,
       `s.callerConnector`.
   - Verify: new tests — per-symbol count badge renders (scope the query inside the
     symbol header / use `getAllByText` to avoid colliding with the stat row's
     "N callers"); clicking the chevron hides the callers
     (`queryByText("src/routes/auth.ts:42")` becomes null). Existing caller-link
     tests still pass (default-expanded). `tsc --noEmit`.

8. **Section icon** — `BlastRadius.tsx`
   - Change type: modify
   - What: `<SectionLabel icon="GitMerge">` → `icon="Workflow"`. **Confirmed against
     the design source** — the overview screen uses `SectionLabel({ icon: "Workflow" },
     "Blast radius")`. Do NOT add `Network`/`Share2` to `vendor/ui/icons.tsx`
     (vendored, do-not-touch).
   - Verify: `tsc --noEmit` (no test asserts the section icon); visual check via
     `./scripts/dev.sh` is optional.

9. **Badge + toggle restyle (design-exact)** — `BlastRadius.tsx` + `BlastRadius/styles.ts`
   - Change type: modify
   - What:
     - **Badges**: give `s.badge` an icon slot and bump to design spec
       (`padding:2px 8px; borderRadius:5; fontSize:11.5; fontWeight:600; gap:5`,
       `display:inline-flex; alignItems:center`). Render `Globe` (size 12) inside each
       endpoint badge and `Clock` (size 12) inside each cron badge.
     - **Cron color fix**: `s.cronBadge` purple → amber: `color: var(--warn)`,
       `background: var(--warn-bg)` (fallback `rgba(245,158,11,0.12)`). Endpoint badge:
       `color: var(--accent-text, var(--accent))` on `var(--accent-bg)`.
     - **Toggle**: replace the two separately-bordered pills with one segmented control.
       Wrap both buttons in a container `s.toggleGroup` = `{ display:flex; gap:2;
       background:var(--bg-surface); border:1px solid var(--border); borderRadius:7;
       padding:2 }`. `s.toggleBtn` = `{ padding:"3px 10px"; fontSize:11.5; fontWeight:600;
       borderRadius:5; border:none; background:transparent; color:var(--text-muted);
       cursor:pointer }`. `s.toggleBtnActive` = `{ background:var(--bg-elevated);
       color:var(--text-primary) }` (drop the bright `var(--accent)`/#fff).
   - Verify: existing graph-toggle test (e) still passes (button text unchanged);
     add a case asserting the cron badge renders with the amber `cronBadge` style (or
     at least that a `Clock`-icon cron badge + `Globe`-icon endpoint badge render once
     per symbol — overlaps step 1's badge-level test). `tsc --noEmit`.

10. **Update the test file for the deliberate visual/format changes** — `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadius/BlastRadius.test.tsx`
   - Change type: modify
   - What: Apply the test deltas below alongside steps 1, 4, 6, 7 (same package, one
     `vitest` run). Net: 3 assertions change, ~5 new cases added; all others stay.
   - Verify: `cd client && node_modules/.bin/vitest run src/app/repos/.../BlastRadius/BlastRadius.test.tsx` all green.

**Test deltas (the 14 `it` cases in `BlastRadius.test.tsx`):**
- CHANGED:
  - "renders the symbol name": `getByText("checkRateLimit")` → `getByText("checkRateLimit()")` (P3.5 parens).
  - "renders the header stats line": one combined `/1 symbols · 2 callers/` regex →
    two separate queries `getByText(/1 symbols/)` + `getByText(/2 callers/)` (P3.6 segmentation).
  - "still lists the changed symbols": `getByText("buildSubject")`/`("resolveTitle")`
    → `("buildSubject()")`/`("resolveTitle()")` (P3.5 parens; both are `function` kind).
  - "renders the symbol kind badge": kind label is **dropped** (design has none) →
    replace with an assertion that the `<>`/`Code` chip renders (or simply remove this
    case). The `function`/`type` distinction is no longer shown in the tree.
- UNCHANGED (re-verify they still pass): the 3 caller-link cases (the fixture's only
  symbol is index 0 → default-open keeps callers in DOM; `↳` is a separate node),
  empty state, "no-downstream note", degraded badge, graph toggle (`/graph/i`
  case-insensitive — unaffected by the segmented-control restyle), both
  summary-disclosure cases.
- NEW: P1.1 endpoint-badge-once + endpoint-badge-with-zero-callers; P2 partial-badge +
  symbols-still-listed; P3.4 per-symbol count badge + chevron-collapses-callers.

## Acceptance criteria
- **Frontend gate (client/):** `node_modules/.bin/tsc --noEmit` clean, and
  `node_modules/.bin/vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/BlastRadius/BlastRadius.test.tsx`
  passes with all updated + new cases green (≥18 cases). Specifically: endpoint
  badge appears exactly once for a multi-caller symbol; a 0-caller symbol with an
  endpoint still shows its badge; a `status:"partial"` response shows the partial
  badge while still listing symbols; the chevron collapses/expands callers; the
  symbol renders as `name()`; the stat row shows per-stat icons.
- **Backend gate (server/):** `node_modules/.bin/tsc --noEmit` clean, the existing
  `blast/service.test.ts` and `blast-routes.it.test.ts` still pass, and the new
  hermetic `node_modules/.bin/vitest run test/repo-intel-blast-cap.test.ts` proves
  22 symbols × 2 callers survive (44, not 20) and a 25-caller symbol caps at 20.
  (DB-backed `.it.test.ts` runs need `TESTCONTAINERS_RYUK_DISABLED=true`.)
- **Whole feature:** on `./scripts/dev.sh` + the seeded PR, the panel shows a
  collapsible symbol tree with per-symbol caller counts, code-chip symbol names,
  per-stat icons, correct "cron"/"Tree"/"Graph" copy, a `Workflow` section icon,
  and — for a partial index — an honest "Index incomplete" badge instead of a
  silent zero-callers state.

## Risks / out of scope / open questions
- **Risks:**
  - Test churn is the main risk — the 3 changed assertions and default-expanded
    behavior are load-bearing; if symbols defaulted to *collapsed*, four caller-link
    tests would break. Plan keeps default-expanded.
  - Duplicate "N callers" text (stat row + per-symbol count badge) will trip
    `getByText` — new tests must scope (`within`/`getAllByText`) per `client/INSIGHTS.md`.
  - Do NOT regress the `isEmpty = !data || totals.symbols === 0` gating
    (`client/INSIGHTS.md`): partial/no-callers must still render the tree.
  - Icon names must exist in `vendor/ui/icons.tsx` — `Code`, `CornerDownRight`,
    `Globe`, `Clock`, `ChevronDown`, `ChevronRight`, `Workflow` all verified present;
    a typo silently renders nothing.
- **Backend/frontend sync points:**
  - P1.2 is backend-only; the frontend type comment ("capped at 20",
    `lib/types.ts:68`) and `shapeBlastResponse`'s per-symbol re-slice stay consistent
    with the facade's per-symbol cap — no contract change.
  - P2 uses the existing `index.status` wire field already present in BOTH
    `server/src/modules/blast/types.ts` and `client/src/lib/types.ts`. If a future
    change replaces this with a new flag, both hand-mirrored copies must move
    together (the `IndexStatus` dual-type clash in `client/INSIGHTS.md` is the trap).
- **Out of scope (deferred, not designed):** two-column Overview layout, PR BRIEF /
  PR SCORE gauge / cost card, "Compose review" button, Intent "Recalculate" button,
  RISK AREAS chips-vs-cards styling — all page-level / different components.
  **"Prior PRs touching these files (N)" footer: deferred** — no backing data exists
  on the wire (`BlastResponse` has no such field; grep for `priorPrs`/`relatedPulls`
  found nothing). It could be derived from `pr_files` paths, but that is net-new
  backend work (new query + contract field + endpoint, likely a new index), so it
  is out of scope for this fix pass.
- **Open questions / assumptions:**
  - *Assumption:* `index.status === "partial"` is the right honest-partial trigger
    (grounded: `pipeline/full.ts:210` leaves status `partial` when the soft budget
    trips → empty `file_rank` → 0 resolved callers; `getIndexState` passes it through).
  - *RESOLVED — drop the `kind` label.* User chose drop; design source confirms the
    code chip has no kind word. Step 7 + Test deltas updated.
  - *RESOLVED — section icon is `Workflow`.* Confirmed against the design source
    (overview screen renders `SectionLabel({ icon: "Workflow" }, "Blast radius")`),
    not just inferred — no vendored-icon edit.
