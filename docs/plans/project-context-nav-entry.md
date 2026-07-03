# Implementation Plan: Project Context — Persistent Sidebar Nav Entry + Breadcrumb (SPEC-01 follow-up)

## Overview
SPEC-01 ("Project Context") was implemented (`docs/plans/project-context.md`, commit
`160f2b6`). The original plan deliberately avoided a sidebar nav entry (its "Q3"
decision) and instead reached the Project Context screen via a slim link on the
Conventions page — because `client/src/vendor/ui/**` is normally "do not touch". SPEC-01
was since amended with a new "Discoverability & navigation" subsection (AC-33/34/35)
that now **requires** a persistent, repo-scoped nav entry. This plan adds that entry
(following the original plan's T15 precedent for a narrow, sanctioned vendored edit),
retires the now-redundant Conventions-page link, and closes the original plan's other
unfulfilled Q3 promise ("plus breadcrumbs") — which investigation found is already
substantially met, so this plan only enhances it.

## Execution mode
single-agent (one pass) — user-selected. The work is small and tightly coupled: the
core change is two vendored files (`nav.ts` + `Sidebar.tsx`) that must be edited together
with care, plus two app-side tweaks. Parallelism buys nothing and the vendored edit wants
a single careful hand. Tasks are an ordered sequence with one real dependency (T2 needs
T1's `repoScoped` flag).

## Requirements (verified)
Source: `specs/SPEC-01-2026-07-01-project-context.md`, "Discoverability & navigation"
subsection (read in full) + the matching new edge-case entry (spec lines 232-233).

- **R1 (SPEC-01 AC-33)** — WHILE a repository is selected/active, present a **persistent**
  navigation entry point to that repository's Project Context screen, alongside the
  repository's other primary navigation entries, discoverable without first opening
  another page.
- **R2 (SPEC-01 AC-34)** — WHEN a user activates that entry, open the Project Context
  screen for the currently active repository **directly**, without an intermediate page.
- **R3 (SPEC-01 AC-35)** — WHILE **no** repository is selected/active, the Project Context
  navigation entry **must not** be shown.
- **R4 (original-plan Q3 loose thread — NOT a spec AC)** — close the original plan's
  unfulfilled "plus breadcrumbs" promise on the Context screen. Investigation found the
  base `repo → Project Context` breadcrumb **already renders** (`ContextWorkspace.tsx:51`
  builds a `Crumb[]` and passes it to `AppShell`), so the substantive promise is already
  met; this plan only enhances it by making the repo segment a clickable link back to that
  repo's PRs (user-confirmed Q5). The spec-creator deliberately gave breadcrumbs no AC of
  their own (AC-33/34 tying entry+screen to the active repo already cover "know where you
  are"); R4 is a plan-hygiene close-out, not new spec scope.
- **R5 (single canonical entry point — user-confirmed Q6)** — with the persistent nav
  entry in place, remove the redundant "View project context →" link bar the original plan
  added on the Conventions page, and its now-unused i18n string.

### Key facts verified against the current code (do not re-derive)
- **No repo-active gating exists today.** The vendored `Sidebar.tsx` renders **every**
  `NAV` item unconditionally. "Pull Requests" / "Conventions" are repo-scoped only by
  their `:repoId` href (`resolveHref` substitutes `_` when `repoId` is null) — they are
  **never hidden** when no repo is active. So AC-35 needs *new* gating logic; there is no
  existing pattern to copy. This is why the sanctioned vendored edit is necessarily
  broader than T15's (two files, see below) — **user-confirmed (Q1)**.
- **`repoId` is `null` only when zero repos exist.** `repo-context.tsx` resolves
  `repoId = fromPath ?? stored ?? list[0]?.id ?? null`, so once any repo exists it falls
  back to the first. AC-35's "no repository active" therefore observably means "no repos
  exist yet" (e.g. the onboarding state). The gating condition is exactly `ctx.repoId == null`.
- **The active-key + shortcut plumbing already anticipates this entry.**
  `app-shell/helpers.ts` `activeKeyFor()` already returns `"context"` for `/context` paths
  (no change needed), and `useGlobalShortcuts` auto-derives the `g`-then-key jump from any
  `NAV` item's `gKey` via `resolveHref(href, repoId)` (so a new `gKey` needs **no** hook
  change — only the `nav.ts` entry + a `SHORTCUTS` help-list line).
- **`gKey: "d"` / `"g d"` is free** (in use: `p`, `s`, `a`, `c`, `,`) — user-confirmed (Q3).
- **`Crumb` already supports links.** `shell/types.ts` `Crumb` has an optional `href`, and
  `Topbar.tsx` renders `c.href ? <Link href={c.href}>…</Link> : text`. So R4's enhancement
  is a pure app-side one-liner (set `href` on the repo crumb) — **no** vendored change.
- **`Icon.FileText` is a valid UI-kit icon** (`src/vendor/ui/icons.tsx`; already used by
  the Conventions→Context link) — user-confirmed (Q4).
- **`Sidebar` is exported from `@devdigest/ui`** (`src/vendor/ui/index.ts` → `./shell` →
  `Sidebar`), so the AC-35 gating can be exercised by a non-vendored render test.

## Open questions & recommendations
- **Q1 (widen the sanctioned vendored exception to two files + a generic `repoScoped`
  flag)** → answered: YES. Because no repo-active gating exists, AC-35 requires editing
  **both** `nav.ts` (append the entry + add `repoScoped?: boolean` to `NavItemDef`) and
  `Sidebar.tsx` (filter `repoScoped` items when `ctx.repoId == null`). This is a
  deliberate, minimal, explicitly-scoped exception to the "`src/vendor/**` — do not touch"
  rule, following the original plan's T15 precedent (single scoped change, grep-verified
  that nothing else in each file moved). Only the NEW entry carries `repoScoped: true`;
  "Pull Requests"/"Conventions" behaviour is unchanged (still always rendered).
- **Q2 (section placement)** → answered: WORKSPACE group, immediately after "Pull
  Requests" (both are the repo's primary entries — "alongside the repository's other
  primary navigation entries", AC-33).
- **Q3 (`gKey`)** → answered: `gKey: "d"` ("g d → Go to Project Context"); verified free.
- **Q4 (icon)** → answered: `Icon.FileText` (verified valid; matches the existing link).
- **Q5 (breadcrumb enhancement)** → answered: make the repo crumb segment a clickable link
  back to `/repos/:repoId/pulls`; document the base breadcrumb requirement as already met.
- **Q6 (remove the redundant Conventions-page link)** → answered: YES — remove the link
  bar and the now-unused `conventionsLink` i18n string; single canonical entry point.
- **Rec 1 (accepted):** use a generic `repoScoped` flag + a one-line filter rather than
  hard-coding `key === "context"` in the Sidebar — keeps the vendored edit principled and
  lets other items opt into gating later without another vendored change.
- **Rec 2 (accepted):** keep the `SHORTCUTS` help-list entry in sync with the new `gKey`
  (same `nav.ts` file) so the `?` shortcuts overlay stays truthful.

## Affected modules & contracts
- **`client/` only.** No server, reviewer-core, mcp, DB, or contract changes.
- **Vendored UI (sanctioned, scoped exception — Q1):** `client/src/vendor/ui/nav.ts`
  (append entry + `repoScoped` flag + `SHORTCUTS` line) and
  `client/src/vendor/ui/shell/Sidebar.tsx` (repo-scoped filter). No cross-package copy of
  the client UI nav exists (unlike the shared *contracts*), so **no re-vendor** is needed.
- **App-side:** `client/src/app/repos/[repoId]/context/_components/ContextWorkspace/`
  (breadcrumb link), `client/src/app/repos/[repoId]/conventions/page.tsx` (remove link
  bar), `client/messages/en/context.json` (drop `conventionsLink`).
- **Contracts:** none.
- **No collision with the in-progress parallel plan** (`docs/plans/project-context-repo-scoping.md`):
  that plan's owned paths do not include `nav.ts`, `Sidebar.tsx`, `NavItem.tsx`,
  `ContextWorkspace`, `conventions/page.tsx`, or `context.json` (re-verified by grep before
  finalizing this plan).

## Architecture changes
- **`NavItemDef` gains an optional `repoScoped?: boolean`** (a data/type change in the
  vendored `nav.ts`). Semantics: an item marked `repoScoped` is rendered only while a repo
  is active. Presentation stays in the vendored shell.
- **`Sidebar.tsx` gains one repo-scope filter** in its `grp.items` render loop:
  `items.filter((it) => !it.repoScoped || ctx.repoId != null)`. This is the single point
  that enforces AC-33 (shown when active) and AC-35 (hidden when not). No group empties as
  a result — only the new WORKSPACE "context" item is flagged, and "Pull Requests" (also in
  WORKSPACE, unflagged) keeps that group non-empty in the no-repo state.
- **No routing change.** `/repos/[repoId]/context/page.tsx` already renders
  `ContextWorkspace` directly, so AC-34 ("opens directly, no intermediate page") is
  satisfied by the entry's `href` alone (`resolveHref` fills `:repoId` from the active repo).
- **`activeKeyFor()` is unchanged** — it already maps `/context` → `"context"`, so the new
  item highlights correctly with no edit to `app-shell/helpers.ts`.

## Phased tasks

### Phase 1 — Persistent repo-scoped sidebar nav entry (AC-33/34/35)

#### T1 — Add the "Project Context" NAV entry + `repoScoped` flag + shortcut (nav.ts)
- **Action:** In `client/src/vendor/ui/nav.ts` (sanctioned, scoped vendored edit #1 of 2):
  (a) add `repoScoped?: boolean;` to the `NavItemDef` interface (documented: "when set, the
  item renders only while a repository is active"). (b) Append **one** item to the
  `WORKSPACE` group's `items`, immediately after the `pulls` entry:
  `{ key: "context", label: "Project Context", icon: "FileText", href: "/repos/:repoId/context", gKey: "d", repoScoped: true }`.
  (c) Append **one** entry to the `SHORTCUTS` array, adjacent to the other Navigation
  shortcuts: `{ keys: "g d", label: "Go to Project Context", group: "Navigation" }`. Do NOT
  flag "Pull Requests"/"Conventions" with `repoScoped` (out of scope — their behaviour is
  unchanged). Make no other change to the file.
- **Module:** client
- **Type:** ui
- **Skills to use:** `ui-frontend-architecture`, `typescript-expert`
- **Owned paths:** `client/src/vendor/ui/nav.ts`
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** `src/vendor/**` is normally "do not touch" (client CLAUDE.md) — this
  is the deliberate, scoped exception per Q1, mirroring the original plan's T15
  `SETTINGS_SECTIONS` precedent. There is NO cross-package copy of this client UI nav
  (unlike the shared *contracts*), so do NOT re-vendor anywhere. `"FileText"` is a verified
  `IconName` (`src/vendor/ui/icons.tsx`); do not invent an icon name (client/INSIGHTS: an
  unknown icon silently renders nothing). `gKey: "d"` is unused (p/s/a/c/`,` are taken) and
  auto-wires through `useGlobalShortcuts` — no hook edit needed.
- **Acceptance:** `cd client && node_modules/.bin/tsc --noEmit` passes. `grep -n
  'key: "context"' src/vendor/ui/nav.ts` shows the entry inside the `WORKSPACE` group with
  `repoScoped: true`, `gKey: "d"`, `icon: "FileText"`, and `href: "/repos/:repoId/context"`;
  `grep -n '"g d"' src/vendor/ui/nav.ts` shows the new `SHORTCUTS` line; `git diff
  src/vendor/ui/nav.ts` shows ONLY the interface field, the one appended `NAV` item, and the
  one appended `SHORTCUTS` line (nothing else moved).

#### T2 — Gate repo-scoped items in the sidebar render (Sidebar.tsx) — AC-33/AC-35
- **Action:** In `client/src/vendor/ui/shell/Sidebar.tsx` (sanctioned, scoped vendored edit
  #2 of 2): in the `grp.items.map(...)` render, filter out repo-scoped items when no repo is
  active — e.g. change `grp.items.map((it) => ...)` to
  `grp.items.filter((it) => !it.repoScoped || ctx.repoId != null).map((it) => ...)`. This is
  the single enforcement point for AC-33 (shown when `ctx.repoId != null`) and AC-35 (hidden
  when `ctx.repoId == null`). Make no other change to the file. Add a new NON-vendored test
  `client/src/components/app-shell/NavGating.test.tsx` (see Acceptance) — do NOT place a test
  inside `src/vendor/**`.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`, `react-testing-library`
- **Owned paths:** `client/src/vendor/ui/shell/Sidebar.tsx`,
  `client/src/components/app-shell/NavGating.test.tsx`
- **Depends-on:** T1 (needs the `repoScoped` flag + the entry it flags)
- **Risk:** low
- **Known gotchas:** Second and final sanctioned vendored edit — keep it to the one filter
  clause; `git diff` must show nothing else changed. `NavItem` renders `item.label` directly
  (a literal English string from `nav.ts`), so the Sidebar render needs **no** next-intl
  provider — but build a COMPLETE fake `ShellContext` for the test (`repos: []`,
  `activeRepo: null`, `theme`, the `onSelectRepo`/`onAddRepo`/`onRemoveRepo`/
  `onToggleTheme`/`onOpenCommandPalette` no-op callbacks, `Link` omitted so `DefaultLink`
  is used) so `RepoSwitcher`/`NavItem` render cleanly. AC-34 needs no code here: the entry's
  `href` is resolved to `/repos/<activeRepoId>/context` by the existing `resolveHref`, and
  that route already renders `ContextWorkspace` directly (verified) — assert the resolved
  href in the test rather than adding wiring.
- **Acceptance:** `cd client && node_modules/.bin/vitest run
  src/components/app-shell/NavGating.test.tsx` (RTL, `import { Sidebar } from
  "@devdigest/ui"`): (1) with `ctx.repoId = "repo-1"`, `getByText("Project Context")` exists
  and its enclosing `<a>` `href` is `/repos/repo-1/context` (AC-33 + AC-34 — direct link, no
  intermediate page); (2) with `ctx.repoId = null`, `queryByText("Project Context")` is
  `null` while `queryByText("Pull Requests")` is still present (AC-35 — only repo-scoped
  items hide, the group does not disappear). `node_modules/.bin/tsc --noEmit` passes.

### Phase 2 — Breadcrumb enhancement + retire the redundant link

#### T3 — Make the Context breadcrumb's repo segment link back to the repo's PRs (R4)
- **Action:** In
  `client/src/app/repos/[repoId]/context/_components/ContextWorkspace/ContextWorkspace.tsx`,
  change the existing crumb (line ~51) so the repo segment carries an `href`:
  `const crumb = [{ label: repoName, mono: true, href: \`/repos/${repoId}/pulls\` }, { label: t("title") }];`.
  The `Crumb.href` field already exists and `Topbar` already renders a linked crumb when
  `href` is set — no other change is required. The base breadcrumb (`repo → Project
  Context`) already existed and satisfied the original Q3 promise; this only adds the
  clickable back-link (Q5).
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `next-best-practices`, `ui-frontend-architecture`
- **Owned paths:**
  `client/src/app/repos/[repoId]/context/_components/ContextWorkspace/ContextWorkspace.tsx`,
  `client/src/app/repos/[repoId]/context/_components/ContextWorkspace/ContextWorkspace.test.tsx`
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** Do not touch the `Crumb` type or `Topbar` (vendored, already support
  `href`). Keep `repoName`'s existing fallback (`activeRepo?.full_name ?? repoId`). When
  extending `ContextWorkspace.test.tsx`, keep every i18n namespace the component uses in the
  test provider `messages` or next-intl silently logs `MISSING_MESSAGE` and renders the key
  (client/INSIGHTS) — the file already wires `context`; do not drop it.
- **Acceptance:** `cd client && node_modules/.bin/vitest run
  "src/app/repos/[repoId]/context/_components/ContextWorkspace/ContextWorkspace.test.tsx"`
  (LITERAL path, no `**` glob — client/INSIGHTS bracket-folder glob gotcha): a new/updated
  case asserts the rendered `repoName` breadcrumb is an anchor whose `href` is
  `/repos/<repoId>/pulls`, and the `Project Context` crumb remains a non-link. Existing cases
  still pass. `node_modules/.bin/tsc --noEmit` passes.

#### T4 — Remove the redundant Conventions-page "View project context →" link (R5)
- **Action:** In `client/src/app/repos/[repoId]/conventions/page.tsx`, remove the slim link
  bar `<div>` that wraps the `<Link href={\`/repos/${params.repoId}/context\`}>…</Link>`
  (the SPEC-01 Q3 workaround), leaving the page as a thin `<ConventionsWorkspace repoId=… />`
  entry. Remove now-unused imports (`Link`, `Icon`, `useTranslations`, and `useParams`/`t`
  if only used for the link — keep whatever `ConventionsWorkspace` still needs) and the
  file's header comment lines that describe the link. In `client/messages/en/context.json`,
  remove the now-unused `conventionsLink` key. Before deleting the string, `grep -rn
  conventionsLink client/src` to confirm no other reference remains.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/app/repos/[repoId]/conventions/page.tsx`,
  `client/messages/en/context.json`
- **Depends-on:** none (independent of T1–T3; the new nav entry from T1/T2 is the
  replacement entry point, but removing this link does not technically require T1/T2 to have
  shipped first)
- **Risk:** low
- **Known gotchas:** After removing the link, ensure no dangling unused import trips
  `tsc`/build. If a Conventions-page test asserts the link's presence, update it to assert
  the link is gone (grep `conventions` test files first). Do NOT touch `ConventionsWorkspace`
  or its own `AppShell`/breadcrumb (out of scope). `grep -rn conventionsLink client/src`
  must return no matches after this task.
- **Acceptance:** `cd client && node_modules/.bin/tsc --noEmit` passes; `grep -rn
  conventionsLink client/src` returns nothing; `git diff` shows the link bar removed from
  `conventions/page.tsx` and the `conventionsLink` key removed from `context.json`; the bare
  `cd client && node_modules/.bin/vitest run` suite is green (run bare, then grep the output
  for any conventions test file — client/INSIGHTS bracket-folder glob gotcha).

## Testing strategy
- **AC-33/34/35 (T2):** a new non-vendored RTL test
  `client/src/components/app-shell/NavGating.test.tsx` renders the vendored `Sidebar`
  (imported from `@devdigest/ui`) with two fake `ShellContext` values — `repoId` set vs
  `null` — asserting the "Project Context" entry appears/does-not-appear and (when present)
  links directly to `/repos/<id>/context`. No next-intl provider needed (NavItem labels are
  literal). Run with the literal path: `node_modules/.bin/vitest run
  src/components/app-shell/NavGating.test.tsx`.
- **R4 breadcrumb (T3):** extend `ContextWorkspace.test.tsx` (RTL) to assert the repo crumb
  is a link to `/repos/<id>/pulls`. Run via the LITERAL bracket path (glob gotcha).
- **R5 cleanup (T4):** typecheck + `grep -rn conventionsLink client/src` (must be empty) +
  the bare test suite green.
- **Whole-client gate:** `cd client && node_modules/.bin/tsc --noEmit` and `cd client &&
  node_modules/.bin/vitest run` (bare — the config's own `include` glob works; per-file
  bracket-path globs do not) and `pnpm build`. No ESLint in this package.
- **Test-command discipline:** for any path containing `[repoId]`, use the LITERAL file
  path (no `**`) or run bare `vitest run` and grep the output — bracket folders break glob
  arguments (client/INSIGHTS).
- **No server/reviewer-core/e2e tests** — this plan changes no non-client code.

## Risks & mitigations
- **Scope-creep in the sanctioned vendored edits (T1/T2)** → each task's Acceptance greps
  its `git diff` to confirm ONLY the intended lines changed (the T15 precedent's rigor);
  the generic `repoScoped` flag keeps the Sidebar change to one filter clause.
- **AC-35 mis-scoped so a whole nav group disappears when no repo is active** → only the new
  "context" item is flagged `repoScoped`; "Pull Requests" stays unflagged, so WORKSPACE
  never empties. The T2 test explicitly asserts "Pull Requests" is still present in the
  no-repo state.
- **Editing the wrong "nav" file** → `client/src/vendor/ui/nav.ts` is the client UI sidebar
  nav (target). It is unrelated to `@devdigest/shared` contracts; there is no cross-package
  copy, so no re-vendor. (Contrast: the parallel plan touches `vendor/shared/*` contracts,
  a different vendored tree — no overlap.)
- **`gKey` collision / dead shortcut** → verified `d`/`g d` unused; `useGlobalShortcuts`
  auto-derives the jump from `NAV`, so the shortcut works with no hook edit; the `SHORTCUTS`
  help entry keeps the `?` overlay truthful.
- **Breadcrumb enhancement drifts into a vendored change** → `Crumb.href` + `Topbar` link
  rendering already exist; T3 is confined to the app-side `ContextWorkspace` crumb literal.
- **Removing the Conventions link leaves a dangling import or broken test (T4)** → task
  removes unused imports and greps for `conventionsLink` + any conventions test asserting
  the link before finalizing.
- **Concurrent execution with the parallel plan** → owned paths are disjoint (verified);
  both plans are on the same branch, so the implementer should still pull/rebase before
  landing to avoid a merge race, but no file is co-owned.

## Red-flags check
- [x] Every requirement maps to at least one task: R1→T1/T2; R2(AC-34)→T1(href)+T2(test
  asserts direct link); R3→T2; R4→T3 (base already met, documented); R5→T4
- [x] No specification was authored or edited — SPEC-01 (amended version, AC-33/34/35) taken
  as input and read in full; this plan restates, never rewrites, its ACs
- [x] Execution mode recorded (single-agent) and the plan is a lean ordered sequence for it
- [x] Dependencies form a DAG (no cycles): T1→T2; T3 and T4 independent
- [x] (single-agent) Owned paths are still listed per task and do not overlap each other
- [x] Every Acceptance is measurable (named test file/command + grep + observable assertion)
- [x] No contracts changed — no `@devdigest/shared` edit, so nothing depends on a contract
- [x] `src/vendor/**` is touched ONLY in T1 (`nav.ts`) and T2 (`Sidebar.tsx`), each a
  deliberate, minimal, grep-verified sanctioned exception per Q1 (the T15 precedent); no
  other vendored file (including `NavItem.tsx`, `Topbar.tsx`, the `Crumb` type) is modified
- [x] No DB tables, migrations, server, reviewer-core, mcp, or config files are touched
- [x] No path overlap with the in-progress `docs/plans/project-context-repo-scoping.md`
  (verified: it owns none of `nav.ts`, `Sidebar.tsx`, `NavItem.tsx`, `ContextWorkspace`,
  `conventions/page.tsx`, `context.json`)
