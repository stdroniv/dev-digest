# Plan: Fix two Smart Diff bugs (phantom finding badge + single-line range highlight)

## Understanding
The Smart Diff view (Files-changed tab → "Smart order") has two defects. **Bug 1
(phantom findings):** a file card renders an "N findings" badge whenever the file
has any `finding_annotations`, even when that file has no patch to render
(`prFile` is `null` → `parsePatch(undefined)` returns `[]`), so the badge claims
findings the user can never see highlighted. **Bug 2 (truncated range):** a finding
that spans multiple lines is only highlighted on its first line, because the
`FindingAnnotation` wire contract carries a single `line` field — the finding's
`end_line` (present in the DB and the `Finding` DTO) is dropped at the
`SmartDiffService` → contract boundary, so the client can only key highlights by one
line number. The goal is to make the badge/count reflect only annotations that are
actually anchored to a rendered diff line, and to highlight the full
`start_line..end_line` range.

## Context loaded
- Root `INSIGHTS.md` — vendored contracts are the local source of truth and must be
  hand-synced across `server/` and `client/` copies (no re-vendor script).
- `server/CLAUDE.md`, `server/INSIGHTS.md` — `.nullish()` vs `.nullable()` gotcha
  (line 13: a new **required** contract field breaks literal-fixture tests); the two
  prior Smart Diff service insights (dismissed-finding guard at `smart-diff.service.ts`
  line 62 already present; per-agent dedupe loop already in place); import shared types
  via the `@devdigest/shared` alias, never deep relative paths.
- `client/CLAUDE.md`, `client/INSIGHTS.md` — the del/add pair both resolve to the same
  `lineNo` (so a single annotation already paints two rows; RTL must use
  `getAllByText(/^warning$/i)`); the two distinct badge-click behaviors (file-level
  scroll vs per-line `onNavigateToFinding`); fake-timers + `waitFor` deadlock pattern;
  `parsePatch`/`Line` are re-exported from the `diff-viewer` barrel.
- Source: `client/.../SmartDiffViewer/SmartDiffViewer.tsx`,
  `server/src/modules/reviews/smart-diff.service.ts`,
  `server/src/modules/reviews/smart-diff.classify.ts`,
  `server/src/vendor/shared/contracts/brief.ts` (+ client vendored copy),
  `client/src/components/diff-viewer/helpers.ts` (`parsePatch`, `Line`),
  `server/src/db/schema/reviews.ts` (findings `startLine`/`endLine` both `notNull`).
- Tests: `server/test/smart-diff-routes.it.test.ts`,
  `server/test/smart-diff-classify.test.ts`, `server/test/contracts.test.ts`
  (line 114 builds a `FindingAnnotation` literal **without** `end_line`),
  `client/.../SmartDiffViewer/SmartDiffViewer.test.tsx`.
- Skill: `client-server-communication` — rule 6 "design additive/backward-compatible
  first"; the shared schema is the single source of truth validated at both ends.
- Deliberately skipped: `docs/architecture.md`, `reviewer-core/*` (no review-pipeline,
  prompt, or grounding logic changes); the smart-diff route handler (response shape is
  produced by the service + contract, not the route).

## Approach & tradeoffs
**Contract field as `.nullish()` (optional), not required.** Add
`end_line: z.number().int().nullish()` to `FindingAnnotation` in both vendored copies.
The service always populates it from `finding.endLine`, so real responses always carry
it; making it optional keeps the change additive/backward-compatible
(`client-server-communication` rule 6) and — critically — avoids breaking the
`FindingAnnotation` literal in `server/test/contracts.test.ts:114`, which omits the
field. The client falls back with `a.end_line ?? a.line`.
- *Rejected: required `end_line` (`z.number().int()`).* It mirrors the `Finding` DTO,
  but `server/INSIGHTS.md` (line 13) documents that a new **required** field silently
  breaks every literal-fixture test that omits it — here `contracts.test.ts:114`, which
  the task scope does not list. Not worth the extra churn for a field the service always
  sets anyway.

**Client: derive badge + highlights from annotations anchored to rendered lines.**
Rather than only guarding `hasFinding` on `prFile != null`, compute the set of line
numbers actually present in the parsed diff and treat an annotation as "visible" iff its
`start..end` range intersects that set. The badge visibility AND its count both come
from this `visibleAnnotations` list, and the per-line highlight map registers each
visible annotation under every line number in its inclusive range. This fixes Bug 1's
literal symptom (no patch → empty diff → no visible annotations → no badge) **and** its
title ("no highlighted lines but badge shows N") for the secondary case where a patch
exists but the cited line is outside the diff hunks, while Bug 2 falls out of the
range-expanded map for free.
- *Rejected: gate the badge on `lines.length > 0` only.* Simplest, and matches the
  stated root cause, but leaves the "patch present, finding line not in any hunk" variant
  of the phantom count unfixed and keeps badge-count ≠ highlighted-lines. The
  intersection approach is a few lines more and is correct in both cases.

**Line-number key parity.** `renderedLineNos` is built with `ln.newNo ?? ln.oldNo` —
identical to `DiffLine`'s existing `lineNo` derivation — so visibility, the highlight
map, and the rendered row all agree on the same key (and the known del/add same-`lineNo`
behavior is preserved, not changed).

## Implementation steps

1. **Add `end_line` to the server `FindingAnnotation` contract** — `server/src/vendor/shared/contracts/brief.ts`
   - Change type: modify
   - What: in the `FindingAnnotation` object (lines 87–92), add
     `end_line: z.number().int().nullish(),` after the existing `line` field. Leave
     `line` as the inclusive start.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` passes; `FindingAnnotation.parse({ line: 1, severity: 'warning', finding_id: 'x' })` still succeeds (optional field) and `.parse({ line: 1, end_line: 3, ... })` succeeds.

2. **Mirror the field in the client vendored contract** — `client/src/vendor/shared/contracts/brief.ts`
   - Change type: modify
   - What: identical edit — add `end_line: z.number().int().nullish(),` to
     `FindingAnnotation` (lines 87–92). The two vendored copies must stay in sync
     (root `INSIGHTS.md`); there is no re-vendor script, so edit both by hand.
   - Verify: `diff <(sed -n '87,92p' server/src/vendor/shared/contracts/brief.ts) <(sed -n '87,93p' client/src/vendor/shared/contracts/brief.ts)` shows the `end_line` line present in both; `cd client && node_modules/.bin/tsc --noEmit` passes.

3. **Populate `end_line` in the SmartDiff service** — `server/src/modules/reviews/smart-diff.service.ts`
   - Change type: modify
   - What: in the annotation-build loop (the `bucket.push({...})` at line 64), add
     `end_line: finding.endLine,` alongside the existing `line: finding.startLine`.
     `finding` is a `FindingRow` (`typeof t.findings.$inferSelect`) whose `endLine`
     column is `notNull` (`server/src/db/schema/reviews.ts:35`), so no null-handling
     is needed. Do not touch the existing dismissed-finding guard (line 62) or the
     per-agent dedupe loop.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` passes; integration assertion added in step 6 confirms the field reaches the HTTP response.

4. **Expand the client annotation map to cover the full range + fix the phantom badge** — `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`
   - Change type: modify
   - What: inside `SmartFileCard` (around lines 187–213):
     - After `const lines = React.useMemo(() => parsePatch(prFile?.patch), [prFile?.patch]);`
       add a memo `renderedLineNos: Set<number>` built by iterating `lines` and adding
       `ln.newNo ?? ln.oldNo` (skip `null`).
     - Add a memo `visibleAnnotations` = `smartFile.finding_annotations.filter(a => { const end = a.end_line ?? a.line; for (let n = a.line; n <= end; n++) if (renderedLineNos.has(n)) return true; return false; })`.
     - Rebuild `annotationsByLine` (lines 190–198) from `visibleAnnotations`, pushing
       each annotation under **every** line `n` in `[a.line, a.end_line ?? a.line]`
       (nested loop), not just `a.line`.
     - Replace `const hasFinding = smartFile.finding_annotations.length > 0;` (line 213)
       with `const hasFinding = visibleAnnotations.length > 0;`.
     - In the badge label (line 254), pass `count: visibleAnnotations.length`.
     - In `handleFindingsBadgeClick` (lines 200–211), read the first element of
       `visibleAnnotations` instead of `smartFile.finding_annotations[0]` so the scroll
       targets a line that actually exists in the DOM.
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` passes; component tests in
     step 7 cover both behaviors.

5. **(Optional) assert range pass-through in the classifier unit test** — `server/test/smart-diff-classify.test.ts`
   - Change type: modify
   - What: `assembleSmartDiff` is agnostic to `end_line` (it only sorts by `line`), so no
     production change is needed there. Strengthen the "maps finding_annotations" test
     (lines 144–162) by adding `end_line` to one fixture annotation and asserting it
     survives the sort/copy unchanged. Keeps the unit layer honest about the new field.
   - Verify: `cd server && node_modules/.bin/vitest run test/smart-diff-classify.test.ts` is green.

6. **Add an integration assertion for `end_line` in the route response** — `server/test/smart-diff-routes.it.test.ts`
   - Change type: modify
   - What: the fixtures already insert `endLine: FINDING_START_LINE + 2` (line 99) and
     `endLine: FINDING_LINE_A/B + 2` (lines 169–207). In the "core file … finding_annotations
     populated" test (lines 285–289) extend the `.some(...)` predicate to also assert
     `a.end_line === FINDING_START_LINE + 2`, and add the analogous `end_line` checks in
     the multi-agent test (lines 318–332). This locks in step 3.
   - Verify: `cd server && TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run test/smart-diff-routes.it.test.ts` is green (requires Docker socket access per `server/INSIGHTS.md`).

7. **Add client regression tests for both bugs** — `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx`
   - Change type: modify
   - What:
     - **Bug 1 (phantom badge):** add a test whose `SmartDiff` fixture has a core file
       with a `finding_annotations` entry but whose matching `PR_FILES` entry has
       `patch: null` (or an annotation `line` outside the patch's hunk) → assert the
       "finding" badge is **not** rendered (`screen.queryByText(/finding/i)` is null) and
       no severity pill appears.
     - **Bug 2 (full range):** extend the existing `SMART_DIFF` fixture's annotation to
       `{ line: 11, end_line: 13, severity: "warning", finding_id: "find-1" }` against
       `SOURCE_FILE_PATCH` (which renders new-side lines 10–14) and assert the severity
       pill renders on more than one line via `getAllByText(/^warning$/i)` with
       `length >= 2` (honoring the del/add same-`lineNo` note in `client/INSIGHTS.md`).
     - Keep the existing badge/scroll tests working with the `visibleAnnotations`-derived
       count (line 12 stays inside the patch, so they remain green).
   - Verify: `cd client && node_modules/.bin/vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx` is green.

## Acceptance criteria
1. Type safety across both packages: `cd server && node_modules/.bin/tsc --noEmit`
   and `cd client && node_modules/.bin/tsc --noEmit` both exit 0.
2. Server suite (unit + the smart-diff integration test) green:
   `cd server && node_modules/.bin/vitest run test/smart-diff-classify.test.ts test/contracts.test.ts`
   and `cd server && TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run test/smart-diff-routes.it.test.ts`
   — the integration test confirms each annotation now carries the correct
   `end_line` (`start_line + 2`).
3. Client suite green: `cd client && node_modules/.bin/vitest run SmartDiffViewer` —
   including the new Bug 1 test (annotation on a file with no/`null` patch → **no** badge,
   **no** phantom count) and the new Bug 2 test (a `line..end_line` range highlights
   `>= 2` rows).
4. Behavioral end-to-end (manual, optional): via `./scripts/dev.sh`, on a PR whose
   review has a multi-line finding, the Files-changed → "Smart order" view highlights
   every line of the finding's range, and a file with findings but no rendered patch
   shows no badge.

## Risks / out of scope / open questions
- **Risks:** (a) Forgetting to edit **both** vendored `brief.ts` copies leaves the
  client type without `end_line` and the build/red — step 2's `diff` verify guards this.
  (b) Using `.nullable()` instead of `.nullish()` would break `contracts.test.ts:114`
  (server `INSIGHTS.md` line 13). (c) Building `renderedLineNos` with a different key
  than `DiffLine`'s `ln.newNo ?? ln.oldNo` would desync visibility from highlighting —
  keep them identical.
- **Out of scope:** the `Finding` DTO / `findings.ts` contract (already has both
  `start_line`/`end_line`); `findingRowToDto` in `helpers.ts` (already maps both); the
  smart-diff route handler and `useSmartDiff` hook (unchanged); `assembleSmartDiff`
  production logic (range-agnostic pass-through); reviewer-core, prompts, grounding; any
  DB schema or migration (findings already store `start_line`/`end_line`).
- **Open questions / assumptions:** (1) Finding `start_line`/`end_line` are treated as
  new-side (right/added) line numbers, consistent with how the existing single-line
  highlight already anchors via `ln.newNo ?? ln.oldNo`; no remap between old/new sides is
  attempted. (2) `end_line` is assumed `>= start_line` (DB invariant; the inclusive loop
  degrades to a single line if `end_line == start_line` or is null). (3) Rendering a
  severity pill on every line of a range is the intended "highlight the whole range"
  behavior; if product wants a single pill per finding with a full-height bar instead,
  that is a follow-up styling change, not a contract/data change.
