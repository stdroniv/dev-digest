# Plan: SmartDiffViewer multi-finding count badge + popover

## Understanding
On a Smart Diff line that has two or more `FindingAnnotation`s sharing the same
start line (`a.line`), the per-line UI today collapses them to a single severity
pill (the most severe one wins via `SEV_RANK`) and clicking it navigates to only
that one finding. The improvement replaces that single pill — only when a line has
**≥ 2** findings — with a neutral "N findings" count badge that opens a small,
self-contained popover listing every finding on that line (severity dot + label +
line range), sorted critical → warning → suggestion. Each popover row navigates to
its own finding via the existing `onNavigateToFinding` prop and closes the popover;
click-outside and Esc also close it. Lines with exactly one finding are completely
unchanged.

## Context loaded
- Root `INSIGHTS.md` and `client/INSIGHTS.md` — the SmartDiffViewer-specific entries
  are load-bearing: (a) a del/add pair at the same logical position both resolve to
  the same `lineNo`, so two rows render the same per-line badge — RTL must use
  `getAllByText`; (b) the two distinct badge-click behaviors (file-level scroll vs
  per-line `onNavigateToFinding` cross-tab nav) — the new popover rows reuse the
  per-line model; (c) `s.fileCard` has `overflow: hidden`, which clips absolutely
  positioned children (the popover-clipping risk, with the documented portal/`fixed`
  remedy); (d) inline-styles-everywhere is the established pattern here; (e) the
  border-shorthand-vs-longhand rerender warning rule; (f) no `@testing-library/user-event`
  in this package — use `fireEvent`.
- `client/CLAUDE.md` — pages thin, feature logic colocated in `_components/<Name>/`,
  i18n via next-intl `messages/<locale>/*.json`, no ESLint/Prettier gate.
- Component `SmartDiffViewer.tsx`, its `styles.ts`, and the existing test file
  `SmartDiffViewer.test.tsx` (read in full).
- `client/src/vendor/shared/contracts/brief.ts` (reference only — DO NOT modify):
  `FindingAnnotation = { line, end_line?: nullish, severity, finding_id }`.
- `client/messages/en/brief.json` — confirmed the `smartDiff` namespace is `brief`
  (NOT `pull` as the request stated) and that `smartDiff.findings` already yields
  "N findings" plural. `en` is the **only** locale (`client/messages/**` glob).
- `client/src/components/diff-viewer/helpers.ts` — `parsePatch` / `Line` shape, to
  reason about which lines render and where `lineNo` comes from.
- Skill `react-best-practices` (read): popover must be a PascalCase component, not a
  render factory; clean up the click-outside/Esc listeners in `useEffect`; icon-only
  buttons need `aria-label`; provide an Esc escape path. Skill `react-testing-library`
  named as relevant but NOT read — `client/INSIGHTS.md` already encodes this package's
  concrete RTL conventions (fireEvent, getAllByText, no user-event), which supersede
  generic guidance.

## Approach & tradeoffs
Extract two module-level PascalCase components inside `SmartDiffViewer.tsx`:
`MultiFindingBadge` (owns the count-badge button, the `open` state, the `wrapRef`,
and the click-outside/Esc effect) and `FindingsPopover` (pure presentational list of
rows). `DiffLine` changes only its trailing badge expression to branch on
`badgeAnnotations.length`: `>= 2` → `<MultiFindingBadge …/>`, otherwise the existing
single-pill JSX verbatim. This keeps `DiffLine` small, keeps all hooks inside an
always-mounted child (no conditional-hook hazard), and touches none of the existing
map-building (`badgeAnnotationsByLine` is reused as-is, per the constraint).

Popover positioning: an absolutely-positioned `div` inside a `position: relative`
wrapper, anchored under-right of the badge — exactly the "positioned div + useRef +
click-outside useEffect" the request asks for, and it moves with the content on
scroll (no `position: fixed` scroll-detach bug). **Rejected alternative:**
`createPortal` + `position: fixed` (the codebase's `FindingsCell`/`FindingsHoverCard`
pattern). It dodges the `s.fileCard { overflow: hidden }` clipping, but it pulls in
scroll/resize dismiss bookkeeping and a second ref for click-outside; heavier than the
request wants. Kept as the documented fallback under Risks if clipping bites bottom-row
findings. **Rejected:** a third prop / new contract field — unnecessary, every datum
is already on `FindingAnnotation`. **Rejected:** mutating `badgeAnnotationsByLine`/
`topBadgeAnnotation` — the request says keep the map and only change the render branch.

## Implementation steps

1. **Add i18n keys for line-range and count-badge accessibility** — `client/messages/en/brief.json`
   - Change type: modify
   - What: under `smartDiff.annotation` (currently `{ blocker, warning, suggestion }`)
     add three sibling keys:
     - `"line": "line {line}"`
     - `"lineRange": "lines {start}–{end}"`  (the dash is an EN DASH, U+2013)
     - `"findingsOnLine": "{count} findings on line {line}"`  (count-badge `aria-label`)
     Reuse the existing `smartDiff.findings` ("{count, plural, one {# finding} other
     {# findings}}") for the badge's visible text — no new visible-text key needed.
     `en` is the only locale, so this is the only messages file to edit.
   - Verify: `node -e "JSON.parse(require('fs').readFileSync('client/messages/en/brief.json','utf8'))"`
     exits 0 (valid JSON) and the three keys exist under `smartDiff.annotation`.

2. **Add the popover row component `FindingsPopover`** — `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`
   - Change type: add
   - What: a new module-level PascalCase function component placed just below the
     `SEV_RANK` constant / helpers block (so it precedes `DiffLine`). Signature:
     `FindingsPopover({ annotations, onNavigate, t })` where `annotations:
     FindingAnnotation[]` is already severity-sorted by the caller, `onNavigate:
     (findingId: string) => void`, `t: ReturnType<typeof useTranslations<"brief">>`.
     Renders a `<div role="dialog">` styled as an absolutely-positioned floating card
     (`position: "absolute"`, `top: "calc(100% + 4px)"`, `right: 0`, `zIndex: 20`,
     `minWidth: 200`, `maxWidth: 320`, `borderWidth/Style/Color` longhands +
     `var(--border)`, `background: var(--bg-elevated)`, `boxShadow`,
     `display: "flex"`, `flexDirection: "column"`, `gap: 2`, `padding: 6`). For each
     annotation render a full-width `<button type="button">` row containing: a small
     severity dot (`<span>` 8×8, `borderRadius: 2`, `background: SEV_TOKEN[a.severity].color`,
     `flexShrink: 0`) mirroring the existing `roleIndicator` dot; the severity label
     `t(SEV_TOKEN[a.severity].labelKey)` in `color: SEV_TOKEN[...].color`,
     `fontWeight: 600`; and a right-aligned (`marginLeft: "auto"`) muted line-range
     label. Range label: `const end = a.end_line ?? a.line;` then
     `end > a.line ? t("smartDiff.annotation.lineRange", { start: a.line, end })
     : t("smartDiff.annotation.line", { line: a.line })`. Row `onClick`:
     `e.stopPropagation(); onNavigate(a.finding_id);`. Row `key={a.finding_id}`.
     Use border LONGHANDS only on every styled element (no `border`/`borderColor`
     shorthand) per `client/INSIGHTS.md` to avoid the rerender warning.
   - Verify: `node_modules/.bin/tsc --noEmit` (run inside `client/`) passes; component
     is referenced in step 3.

3. **Add the `MultiFindingBadge` component (state + click-outside/Esc)** — `client/.../SmartDiffViewer/SmartDiffViewer.tsx`
   - Change type: add
   - What: module-level PascalCase component just above `DiffLine`. Signature:
     `MultiFindingBadge({ annotations, onNavigateToFinding, t })` with `annotations:
     FindingAnnotation[]` (the raw `badgeAnnotations` for the line, length ≥ 2).
     Internals:
     - `const [open, setOpen] = React.useState(false);`
     - `const wrapRef = React.useRef<HTMLSpanElement>(null);`
     - `const sorted = React.useMemo(() => [...annotations].sort((a, b) =>
       SEV_RANK[a.severity] - SEV_RANK[b.severity]), [annotations]);`
     - A click-outside + Esc effect, guarded on `open`:
       ```
       React.useEffect(() => {
         if (!open) return;
         const onDown = (e: MouseEvent) => {
           if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
         };
         const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
         document.addEventListener("mousedown", onDown);
         document.addEventListener("keydown", onKey);
         return () => {
           document.removeEventListener("mousedown", onDown);
           document.removeEventListener("keydown", onKey);
         };
       }, [open]);
       ```
       (Use `mousedown` so the popover dismisses before a row's `click` lands; the
       opening `click` does not trigger it because the listener is only attached after
       `open` flips true.)
     - Render a `<span ref={wrapRef}>` wrapper styled `position: "relative",
       marginLeft: "auto", alignSelf: "center", flexShrink: 0, marginRight: 8` (so it
       occupies the same slot the existing single pill did). Inside it: a count-badge
       `<button type="button">` with `aria-haspopup="dialog"`, `aria-expanded={open}`,
       `aria-label={t("smartDiff.annotation.findingsOnLine", { count: annotations.length,
       line: sorted[0]!.line })}`, `onClick={(e) => { e.stopPropagation();
       setOpen((o) => !o); }}`, visible text `t("smartDiff.findings", { count:
       annotations.length })`. Style the badge from the most-severe token
       (`SEV_TOKEN[sorted[0]!.severity]`): reuse the existing per-line pill box
       (`padding: "1px 6px"`, `borderRadius: 4`, `fontSize: 11`, `fontWeight: 600`,
       `cursor: "pointer"`, `whiteSpace: "nowrap"`) with `color: token.color`,
       `background: token.bg`, `borderStyle: "solid"`, `borderWidth: 1`,
       `borderColor: token.color` (longhands only). Then, when `open`, render
       `<FindingsPopover annotations={sorted} onNavigate={(id) => {
       onNavigateToFinding?.(id); setOpen(false); }} t={t} />`.
   - Verify: `node_modules/.bin/tsc --noEmit` (in `client/`) passes; used in step 4.

4. **Branch the trailing-badge render in `DiffLine`** — `client/.../SmartDiffViewer/SmartDiffViewer.tsx` (current lines 405–434)
   - Change type: modify
   - What: keep `badgeAnnotations` (line 348), `topBadgeAnnotation` (357–360) and
     `badgeSevToken` (378) exactly as-is. Replace the single trailing
     `{topBadgeAnnotation && badgeSevToken && (<button …/>)}` block with a branch:
     ```
     {badgeAnnotations.length >= 2 ? (
       <MultiFindingBadge
         annotations={badgeAnnotations}
         onNavigateToFinding={onNavigateToFinding}
         t={t}
       />
     ) : (
       topBadgeAnnotation && badgeSevToken && (
         /* …the existing single-pill <button> JSX, unchanged… */
       )
     )}
     ```
     No other change to `DiffLine`; no change to `SmartFileCard`, `SmartDiffGroup`,
     `SmartDiffViewer`, props, or the contract.
   - Verify: `node_modules/.bin/tsc --noEmit` (in `client/`) passes.

5. **Add/adjust RTL tests** — `client/.../SmartDiffViewer/SmartDiffViewer.test.tsx`
   - Change type: modify
   - What: see the "Test cases" section below for the exact fixture, imports, new
     describe blocks, and the rewrite of the existing overlap test.
   - Verify: `node_modules/.bin/vitest run SmartDiffViewer` (in `client/`) — all green.

## Test cases (detail for step 5)

Add `within` to the `@testing-library/react` import on line 11.

New fixture (place beside the other fixtures):
```
const SMART_DIFF_MULTI: SmartDiff = {
  groups: [{ role: "core", files: [{
    path: "src/service.ts", additions: 1, deletions: 1,
    finding_annotations: [
      { line: 11, severity: "suggestion", finding_id: "multi-sugg" },          // single line
      { line: 11, end_line: 13, severity: "critical", finding_id: "multi-crit" }, // range
      { line: 11, severity: "warning", finding_id: "multi-warn" },             // single line
    ],
    pseudocode_summary: null,
  }]}],
  split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
};
```
Note from `parsePatch(SOURCE_FILE_PATCH)`: line 11 is a single context row (start
line for all three findings → `badgeAnnotationsByLine.get(11)` has length 3); lines
12/13 are NOT start lines so they carry no badge. The file-level badge also renders
"3 findings", so always target the per-line count badge by role/`aria-label`, never a
bare `getByText(/3 findings/i)`.

- **Count badge renders when ≥2 findings on the same line.** Render `SMART_DIFF_MULTI`
  + `SOURCE_FILE_PATCH`; `await waitFor(getByText(/Core logic/i))`. Assert
  `screen.getByRole("button", { name: /3 findings on line 11/i })` is in the document.
  Assert NO single severity pill is shown before opening: `queryByText(/^blocker$/i)`,
  `/^warning$/i`, `/^suggestion$/i` all null (the count badge replaced the single pill;
  line 11 is the only annotated start line).

- **Popover opens on click and lists sorted rows with correct ranges.** Click the count
  badge button (queried by its `aria-label`). Assert `getByRole("dialog")` present.
  Within the dialog: severity labels "blocker", "warning", "suggestion" all visible
  (critical → "blocker" label). Range labels: `within(dialog).getByText(/lines 11/i)`
  (the critical range → "lines 11–13") and `within(dialog).getAllByText(/^line 11$/i)`
  length 2 (the suggestion + warning single-line rows). Sorting: collect
  `within(dialog).getAllByRole("button")` and assert their accessible names are ordered
  blocker → warning → suggestion (critical first).

- **Each row navigates to its own finding_id and closes the popover.** `const spy =
  vi.fn();` render with the spy. Open the popover; `fireEvent.click(within(dialog)
  .getByRole("button", { name: /blocker/i }))` → `expect(spy).toHaveBeenCalledWith
  ("multi-crit")` and `queryByRole("dialog")` is null. (Optionally a second case:
  re-open, click the `/warning/i` row → `"multi-warn"`.)

- **Popover closes on outside click and on Esc.** Open the popover (assert dialog
  present). `fireEvent.mouseDown(document.body)` → `queryByRole("dialog")` null.
  Separately: re-open, `fireEvent.keyDown(document, { key: "Escape" })` →
  `queryByRole("dialog")` null. (Use `mouseDown`, matching the handler's event.)

- **Single-finding lines unchanged (regression).** The existing tests at lines
  219–231 ("renders a 'warning' severity pill") and 233–247 ("clicking the severity
  pill calls onNavigateToFinding") stay as-is and keep passing. Add one assertion to
  the single-finding case: with `SMART_DIFF` (1 finding), `queryByRole("button", {
  name: /findings on line/i })` is null and `queryByRole("dialog")` is null (no count
  badge, no popover).

- **Rewrite the existing overlap test** (current lines 404–424, "multiple overlapping
  findings on the same line range"). Its old assertions break under the new behavior:
  `getByText(/2 findings/i)` now matches BOTH the file badge and the per-line count
  badge (→ "multiple elements" throw), and `getAllByText(/^blocker$/i)).toHaveLength(1)`
  is now 0 (the single blocker pill is replaced by the count badge). Rewrite it to:
  assert the per-line count badge `getByRole("button", { name: /2 findings on line 11/i })`
  exists and no blocker/warning pill is shown closed; click it; assert the dialog shows
  one "blocker" row and one "warning" row (both ranges "lines 11–13"); click the blocker
  row → spy called with `"overlap-crit"`. (`SMART_DIFF_OVERLAP` already has start line 11
  for both.)

## Acceptance criteria
Run inside `client/`:
- `node_modules/.bin/tsc --noEmit` → exits 0 (no type errors from the two new
  components or the `DiffLine` branch).
- `node_modules/.bin/vitest run SmartDiffViewer` → the whole file is green, including
  every new/updated case above (count badge appears for ≥2 findings; popover opens,
  lists severity-sorted rows with "line 11" / "lines 11–13" ranges; each row navigates
  with the correct `finding_id` and closes the popover; outside-click and Esc close it;
  single-finding lines still render the original pill with no count badge/popover).
- `node -e "JSON.parse(require('fs').readFileSync('client/messages/en/brief.json','utf8'))"`
  → exits 0 and the three new keys exist under `smartDiff.annotation`.
- (Optional manual) `pnpm build` per `client/INSIGHTS.md` (the full client gate is
  typecheck + test + build; there is no lint).

## Risks / out of scope / open questions
- **Risk — popover clipping (primary).** `s.fileCard` sets `overflow: hidden`
  (`styles.ts:57`), so an absolutely-positioned popover that overflows the card
  (e.g. a finding on the last diff row, opening downward) will be visually clipped.
  `client/INSIGHTS.md` documents this exact class of bug and the remedy:
  `createPortal(node, document.body)` with `position: fixed` coords from the badge's
  `getBoundingClientRect()`, plus scroll/resize dismissal. If visual QA shows clipping,
  switch `FindingsPopover` to that portal pattern (still entirely inside
  `SmartDiffViewer.tsx`; the click-outside check then needs a second ref on the popover
  node, and a `scroll`/`resize` dismiss as in `FindingsHoverCard`).
- **Risk — border shorthand rerender warning.** Per `client/INSIGHTS.md`, never mix the
  `border`/`borderColor` shorthand with a per-side longhand on an element whose style
  changes between renders. All new styles use border longhands only; the count badge's
  color depends on `annotations` (not on `open`), so it does not retrigger the warning.
- **Risk — duplicate count badge on del/add pairs.** When a finding's start line is one
  where a del and an add both resolve to the same `lineNo` (e.g. line 12 in the test
  patch), BOTH rows render their own `MultiFindingBadge` (mirroring today's duplicate
  single pill, per `client/INSIGHTS.md`). This is acceptable (consistent with existing
  behavior); tests must therefore target the badge by role/`aria-label` and use
  `getAllByRole`/`getAllByText` where duplication is possible. The chosen fixture uses
  start line 11 (a single context row) specifically to keep the count-badge assertions
  unambiguous.
- **Out of scope.** No server, contract, or `*/src/vendor/**` change; no new props or
  endpoints; no change to the file-level "N findings" badge, to highlight/border logic
  (`annotationsByLine` / `topAnnotation`), or to the single-finding render path beyond
  the `length >= 2` branch. No new locale beyond `en`. No keyboard-arrow navigation
  within the popover (Esc-to-close only) and no focus trap — beyond the requested scope.
- **Open questions / assumptions.**
  - The request referenced `useTranslations("pull")`; the component actually uses the
    `brief` namespace (`SmartDiffViewer.tsx:70`) and strings live in
    `client/messages/en/brief.json`. **Assumption:** add the keys there under
    `smartDiff.annotation`; the request's "pull" was a mislabel.
  - Count-badge visible text reuses `smartDiff.findings` ("N findings"); since the
    branch only fires for ≥ 2, it always renders the plural form. **Assumption:** that
    matches the "N findings" spec; no separate non-plural key is needed.
  - **Assumption:** the count badge is tinted by the most-severe finding's
    `SEV_TOKEN` (so a critical-containing cluster reads red), rather than a neutral
    grey. Swap to neutral (`var(--text-secondary)` / `var(--bg-elevated)` /
    `var(--border)`) if the design prefers a non-severity aggregate chip — a one-line
    style change, no logic impact.
