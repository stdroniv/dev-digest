# Plan: Smart Diff per-line finding annotations (highlight + severity badge + click-to-navigate)

## Understanding
The SmartDiffViewer already groups files (core / wiring / boilerplate) and shows a per-file
"N findings" badge. The design mockup additionally wants per-LINE feedback inside each
expanded file: every diff line that a finding cites gets (a) a severity-colored background
(red = critical/blocker, amber = warning, blue = suggestion), (b) a small severity pill on
the right of that line, and (c) clicking that pill jumps to the "Agent runs" tab and
scrolls to / highlights the specific finding. The blocker is the contract: `SmartDiffFile`
currently carries only `finding_lines: number[]` — bare line numbers, no severity and no
finding id — which is insufficient to color a line by severity or to deep-link to one
finding. We replace it with a richer `finding_annotations` array and thread the new data
through the server assembler and the React viewer.

## Context loaded
- Root routing: `CLAUDE.md` "Read when…" table (auto-loaded). Read `INSIGHTS.md` (root),
  `server/INSIGHTS.md`, `client/INSIGHTS.md` for gotchas.
- Module docs: `server/CLAUDE.md`, `client/CLAUDE.md` (schema-first routes; data access only
  via `lib/hooks → lib/api`; vendored contracts are hand-synced, do-not-touch otherwise).
- Skill: `.claude/skills/client-server-communication/SKILL.md` (wire-boundary: derive types
  from one schema via `z.infer`; the vendored schema is the single source of truth; this GET
  endpoint is local/single-user so a clean breaking rename — all readers updated together —
  is acceptable over carrying a redundant field). `react-best-practices` applies to the
  component edits but was not loaded (changes mirror existing patterns in this folder).
- Contracts: `server/src/vendor/shared/contracts/brief.ts` + `client/.../brief.ts`
  (`SmartDiffFile.finding_lines`), `*/contracts/findings.ts` (`Severity` enum =
  `CRITICAL|WARNING|SUGGESTION`; `Finding.id`).
- Server: `smart-diff.service.ts` (builds `findingLinesByPath` from each agent's newest
  review's findings), `smart-diff.classify.ts` (`assembleSmartDiff`), `smart-diff.constants.ts`,
  `reviews/routes.ts` (`GET /pulls/:id/smart-diff`), `db/schema/reviews.ts`
  (`findings.severity` text, `findings.startLine`, `findings.id`).
- Client: `SmartDiffViewer/{SmartDiffViewer.tsx,styles.ts,index.ts,SmartDiffViewer.test.tsx}`,
  `DiffTab/DiffTab.tsx`, `pulls/[number]/page.tsx` (tab state in `?tab`; `focusFindingId`
  state + `setParam`; the "findings" tab key is labelled "Agent runs" in `PrDetailHeader`),
  `FindingsTab.tsx` + `FindingsPanel.tsx` (consume `focusFindingId` → open accordion + scroll
  to `data-finding-id`), `lib/hooks/brief.ts` (`useSmartDiff`), `messages/en/brief.json`
  (only `en` locale exists), `components/diff-viewer/helpers.ts` (`parsePatch`, `Line`),
  `vendor/ui/primitives/tokens.ts` (`SEV` map → `--crit`=#ef4444 red, `--warn`=#f59e0b amber,
  `--sugg`=#3b82f6 blue; re-exported from `@devdigest/ui`).
- Tests in blast radius: `server/test/smart-diff-classify.test.ts`,
  `server/test/smart-diff-routes.it.test.ts`, `server/test/contracts.test.ts` (has a
  `SmartDiff.parse({… finding_lines …})` fixture at ~L114), `SmartDiffViewer.test.tsx`.
- Confirmed every reader of `finding_lines` (grep): the two contract copies, the two server
  files, the one client component, and the four test files above. Nothing else (no
  `reviewer-core` copy; old `docs/plans/*.md` mention it but are not code). So a clean rename
  is safe — no need to derive a back-compat `finding_lines`.

## Approach & tradeoffs
**Chosen:** clean rename `finding_lines: number[]` → `finding_annotations: FindingAnnotation[]`,
where `FindingAnnotation = { line: int; severity: 'critical'|'warning'|'suggestion';
finding_id: string }`. Add `FindingAnnotation` (and a `FindingAnnotationSeverity` enum) as
exported Zod schemas in both vendored `brief.ts` copies so server, client, and tests derive
one type via `z.infer`. The server maps each finding's stored `severity` (uppercase
`CRITICAL|WARNING|SUGGESTION`) to the lowercase annotation enum, and carries `finding.id`
through. The viewer renders per-line highlight + pill from `finding_annotations`, and the
pill click calls a new `onNavigateToFinding(findingId)` callback drilled
page → DiffTab → SmartDiffViewer; the page handler sets `focusFindingId` state and switches
to the `findings` ("Agent runs") tab, reusing the EXISTING `focusFindingId` machinery
(`FindingsTab → ReviewRunAccordion → FindingsPanel`) that already opens the right accordion
and scrolls to `data-finding-id`.

**Rejected — keep `finding_lines` AND add `finding_annotations` for back-compat:** the only
readers are inside this PR's blast radius and are all updated here; carrying both invites
drift (two fields that must agree) for zero benefit in a local single-user app. The
client-server-communication skill prefers additive change *when external consumers exist* —
none do here.

**Rejected — drive navigation purely via URL hash (`?tab=findings#finding-<id>`):** `page.tsx`
reads `window.location.hash` only once on mount (`useEffect([])`), so an in-page tab switch
would not re-trigger the scroll. The existing `focusFindingId` React state is already the
prop the focus machinery consumes, so setting it directly is simpler and reliable. (Hash
deep-linking from OTHER pages keeps working unchanged.)

**Rejected — reuse the `<DiffViewer>` line renderer:** SmartDiffViewer already renders its own
`DiffLine` from `parsePatch`; adding annotation props there is far less invasive than
retrofitting the shared diff-viewer.

## Implementation steps

> Order matters: contract first (both copies identically), then server producer, then client
> consumer + navigation, then i18n, then tests. Import shared types via the `@devdigest/shared`
> alias on the server — never a deep `../vendor/shared/...` path (server/INSIGHTS.md).

1. **Add `FindingAnnotation` schema + swap the field — server contract copy** —
   `server/src/vendor/shared/contracts/brief.ts`
   - Change type: modify
   - What: in the `// ---- Smart Diff ----` block, before `SmartDiffFile`, add:
     ```ts
     export const FindingAnnotationSeverity = z.enum(['critical', 'warning', 'suggestion']);
     export type FindingAnnotationSeverity = z.infer<typeof FindingAnnotationSeverity>;

     export const FindingAnnotation = z.object({
       line: z.number().int(),
       severity: FindingAnnotationSeverity,
       finding_id: z.string(),
     });
     export type FindingAnnotation = z.infer<typeof FindingAnnotation>;
     ```
     Then in `SmartDiffFile` replace the line `finding_lines: z.array(z.number().int()),`
     with `finding_annotations: z.array(FindingAnnotation),`.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` reports no error from this file;
     `grep -n "finding_annotations" src/vendor/shared/contracts/brief.ts` shows the field +
     the two new exported schemas.

2. **Mirror the contract change — client contract copy** —
   `client/src/vendor/shared/contracts/brief.ts`
   - Change type: modify
   - What: apply the byte-identical change from step 1 (same two new exports + the
     `finding_annotations` field). Keep the two copies in sync by hand (server/INSIGHTS.md:
     vendored contracts are edited per-package, not generated).
   - Verify: `diff <(grep -A4 "FindingAnnotation = z.object" server/src/vendor/shared/contracts/brief.ts) <(grep -A4 "FindingAnnotation = z.object" client/src/vendor/shared/contracts/brief.ts)`
     prints nothing (identical block).

3. **Map severity + build annotations in the assembler** —
   `server/src/modules/reviews/smart-diff.classify.ts`
   - Change type: modify
   - What: import `FindingAnnotation` (and type) from `@devdigest/shared`. Change
     `assembleSmartDiff(files, findingLinesByPath: Map<string, number[]>)` →
     `assembleSmartDiff(files, annotationsByPath: Map<string, FindingAnnotation[]>)`. In the
     per-file map, replace the `rawLines`/`finding_lines` block with:
     ```ts
     const finding_annotations = [...(annotationsByPath.get(f.path) ?? [])]
       .sort((a, b) => a.line - b.line);
     ```
     and emit `finding_annotations` (drop `finding_lines`) in the returned file object. Update
     the JSDoc that says "finding_lines per file are sorted ascending and deduplicated" to
     describe annotations sorted by `line` ascending. (No dedup needed: each finding yields
     exactly one annotation with its own `finding_id`.)
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` passes; the function no longer
     references `finding_lines`.

4. **Produce annotations from findings (severity + id)** —
   `server/src/modules/reviews/smart-diff.service.ts`
   - Change type: modify
   - What: import `FindingAnnotation` type from `@devdigest/shared`. Add a small mapper near
     the top of the file:
     ```ts
     const SEVERITY_TO_ANNOTATION: Record<string, FindingAnnotation['severity']> = {
       CRITICAL: 'critical',
       WARNING: 'warning',
       SUGGESTION: 'suggestion',
     };
     ```
     Replace `findingLinesByPath: Map<string, number[]>` with
     `annotationsByPath = new Map<string, FindingAnnotation[]>()`. In the per-finding loop,
     instead of pushing `finding.startLine`, push
     `{ line: finding.startLine, severity: SEVERITY_TO_ANNOTATION[finding.severity] ?? 'suggestion', finding_id: finding.id }`.
     Pass `annotationsByPath` to `assembleSmartDiff`. Keep the existing per-`agentId`
     dedupe loop (server/INSIGHTS.md: aggregate the newest review per agent — do NOT revert
     to `.find()`).
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` passes; `finding.id`,
     `finding.severity`, `finding.startLine` are all read (they exist on the row per
     `db/schema/reviews.ts`).

5. **Render per-line highlight + severity pill + thread the nav callback** —
   `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`
   - Change type: modify
   - What:
     - Import `FindingAnnotation`, `FindingAnnotationSeverity` types from `@devdigest/shared`
       and `SEV` from `@devdigest/ui` (re-exported via the primitives barrel — client/INSIGHTS.md).
     - Add `onNavigateToFinding?: (findingId: string) => void` to `SmartDiffViewerProps`; thread
       it through `SmartDiffViewer → SmartDiffGroup → SmartFileCard → DiffLine`.
     - Add a severity→token map keyed by the lowercase annotation enum, using existing CSS
       vars so colors match the rest of the app (no redefining severity maps — client/INSIGHTS.md):
       `critical → {color:'var(--crit)', bg:'var(--crit-bg)', labelKey:'smartDiff.annotation.blocker'}`,
       `warning → {var(--warn)/var(--warn-bg), 'smartDiff.annotation.warning'}`,
       `suggestion → {var(--sugg)/var(--sugg-bg), 'smartDiff.annotation.suggestion'}`. A
       `SEV_RANK = { critical: 0, warning: 1, suggestion: 2 }` orders "most severe wins".
     - In `SmartFileCard`: replace `findingSet = new Set(smartFile.finding_lines)` with
       `annotationsByLine = useMemo(() => Map<number, FindingAnnotation[]>, [smartFile.finding_annotations])`.
       `hasFinding = smartFile.finding_annotations.length > 0`. Update the file-level badge
       count to `smartFile.finding_annotations.length` and its click to scroll to
       `smartFile.finding_annotations[0]?.line`. Pass `annotationsByLine` + `onNavigateToFinding`
       to each `DiffLine`.
     - In `DiffLine`: take `annotations: FindingAnnotation[]` (those whose `line === lineNo`) and
       `onNavigateToFinding`. Pick the most-severe annotation (min `SEV_RANK`). When present:
       set `rowStyle.background` to that severity's `bg` and `outline` to `1px solid <color>`
       (replace the current `var(--code-del)` hardcode); render a right-aligned pill
       (`marginLeft:'auto'`) with the severity color/bg and the i18n label, whose `onClick`
       does `e.stopPropagation(); onNavigateToFinding?.(annotation.finding_id)`. Keep the
       existing `id={lineDomId(path, lineNo)}` anchor.
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` passes; component no longer
     references `finding_lines`.

6. **Wire the nav callback through DiffTab** —
   `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`
   - Change type: modify
   - What: add `onNavigateToFinding?: (findingId: string) => void` to `DiffTabProps` and pass
     it to `<SmartDiffViewer prId={prId} files={files} hideHeader onNavigateToFinding={onNavigateToFinding} />`.
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` passes.

7. **Page handler: switch to "Agent runs" tab + focus the finding** —
   `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`
   - Change type: modify
   - What: define `const navigateToFinding = (findingId: string) => { setFocusFindingId(findingId); setTab("findings"); };`
     (both already exist in this file: `setFocusFindingId` from the hash `useState`, `setTab`
     wrapping `setParam("tab", …)`). Pass `onNavigateToFinding={navigateToFinding}` to the
     `<DiffTab … />` in the `tab === "diff"` branch. (No change to the existing mount-time hash
     reader — external `#finding-<id>` deep links keep working.)
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` passes; in a browser, clicking a
     per-line pill in Files-changed → Smart order switches the header to "Agent runs" and the
     cited finding's card opens + scrolls into view.

8. **Add badge label i18n keys** — `client/messages/en/brief.json`
   - Change type: modify
   - What: under the `"smartDiff"` object add:
     ```json
     "annotation": { "blocker": "blocker", "warning": "warning", "suggestion": "suggestion" }
     ```
     (critical severity intentionally labels "blocker" per the design.) Only the `en` locale
     exists (`client/messages/**/brief.json` glob).
   - Verify: `node -e "JSON.parse(require('fs').readFileSync('client/messages/en/brief.json','utf8'))"`
     exits 0; keys present under `smartDiff.annotation`.

9. **Update assembler unit tests to annotations** — `server/test/smart-diff-classify.test.ts`
   - Change type: modify
   - What: the `assembleSmartDiff(files, new Map())` calls stay valid (empty map). Rewrite the
     three finding-specific cases: "maps finding_lines …" → build a
     `Map([['src/service.ts', [{line:30,severity:'warning',finding_id:'f1'}, {line:10,severity:'critical',finding_id:'f2'}, {line:20,severity:'suggestion',finding_id:'f3'}]]])`
     and assert `coreFile.finding_annotations.map(a => a.line)` equals `[10, 20, 30]` (sorted
     ascending) with the matching severities/ids carried through; "finding_lines is empty …"
     → assert `finding_annotations` is `[]`; "result satisfies SmartDiff.parse" → swap the
     `findingLinesByPath` fixture to an annotations map.
   - Verify: `cd server && node_modules/.bin/vitest run test/smart-diff-classify.test.ts` green.

10. **Update the contracts fixture** — `server/test/contracts.test.ts`
    - Change type: modify
    - What: in the `it('SmartDiff (data.jsx DIFF)')` case (~L114), replace
      `finding_lines: [28, 52]` with
      `finding_annotations: [{ line: 28, severity: 'warning', finding_id: 'f1' }, { line: 52, severity: 'critical', finding_id: 'f2' }]`.
    - Verify: `cd server && node_modules/.bin/vitest run test/contracts.test.ts` green.

11. **Update the route integration test to assert annotation shape** —
    `server/test/smart-diff-routes.it.test.ts`
    - Change type: modify
    - What: in "core file lands in core group …", replace
      `expect(coreFile!.finding_lines).toContain(FINDING_START_LINE)` with an assertion that
      `coreFile!.finding_annotations` contains
      `{ line: FINDING_START_LINE, severity: 'warning', finding_id: <string> }` (the fixture
      finding has `severity: 'WARNING'` → maps to `'warning'`); assert `finding_id` is a
      non-empty string. In the multi-agent test, assert `fileA` has an annotation
      `{ line: FINDING_LINE_A, severity: 'warning' }` and `fileB` has
      `{ line: FINDING_LINE_B, severity: 'critical' }` (Agent B fixture is `'CRITICAL'`) —
      proving aggregation across agents AND severity mapping. Use
      `expect(file.finding_annotations.some(a => a.line === L && a.severity === S && typeof a.finding_id === 'string')).toBe(true)`.
    - Verify: `cd server && TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run test/smart-diff-routes.it.test.ts`
      green (Ryuk disabled per server/INSIGHTS.md; Docker socket reachable).

12. **Update the viewer RTL tests + add badge/nav coverage** —
    `client/.../SmartDiffViewer/SmartDiffViewer.test.tsx`
    - Change type: modify
    - What: in the `SMART_DIFF` fixture, replace the core file's `finding_lines: [12]` with
      `finding_annotations: [{ line: 12, severity: 'warning', finding_id: 'find-1' }]` and the
      boilerplate `finding_lines: []` with `finding_annotations: []`. Keep the existing
      "boilerplate collapsed", "1 finding badge", and file-badge `scrollIntoView` tests (they
      still hold — line 12 = the `+ return x + 1;` add line of `SOURCE_FILE_PATCH`, and the
      core file is open by default). Add two cases: (a) the open core file renders a per-line
      pill with label `warning` (`screen.getByText(/warning/i)`); (b) clicking that pill calls
      a `onNavigateToFinding` spy with `'find-1'` — render `renderViewer` with the spy passed
      through and assert `spy` was called once with `'find-1'`.
    - Verify: `cd client && node_modules/.bin/vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx`
      green.

## Acceptance criteria
_TBD_

## Risks / out of scope / open questions
_TBD_
