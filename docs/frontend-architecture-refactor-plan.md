# Frontend Architecture Refactor Plan

> Reviewed with the `ui-frontend-architecture` skill against `client/` (Next.js 15 App
> Router · React 19 · TanStack Query). Date: 2026-06-21.

## Context

We audited the `client/` frontend against the `ui-frontend-architecture` skill's rubric
(folder structure, colocation, the server/client boundary, data-fetching discipline,
constants/placement, imports/aliases, naming, feature isolation).

**Headline: the codebase is already in strong shape.** It follows feature colocation, has
zero direct `fetch()` in components (all data goes through `lib/hooks/* → lib/api.ts`),
keeps constants in colocated `constants.ts`, uses i18n consistently, and has no
cross-feature `_components` imports. This plan is therefore a **small, surgical cleanup of
the few real deviations** — not a restructure. Each change is low-risk and is covered by
the existing Vitest suite, which is the Definition of Done.

### Already compliant (do not touch)
- Route-colocated features under `app/**/_components/<Feature>/` with
  `Feature.tsx + styles.ts + constants.ts + helpers.ts + *.test.tsx + index.ts`.
- All data access via `src/lib/hooks/*` (TanStack Query) → `src/lib/api.ts` (`apiFetch`/`ApiError`).
- Path aliases configured (`@/*`, `@devdigest/ui`, `@devdigest/shared`) and resolved
  identically by `tsconfig.json` and `vitest.config.ts`.
- Provider stack wraps `{children}` at the root boundary (`src/lib/providers.tsx`).
- Named exports throughout; no cross-feature imports.

## Findings → changes

### High priority

1. **Remove an unnecessary `"use client"`**
   - File: `src/app/settings/[section]/_components/SettingsView/_components/SectionTitle/SectionTitle.tsx`
   - Problem: marked `"use client"` but is pure presentational (no state/effects/handlers/
     browser APIs). The skill's rule is to keep the client boundary at interactive leaves;
     this one ships hydration cost for nothing.
   - Change: delete the `"use client"` line. Verify its parent isn't relying on it being a
     client module (it renders only `title`/`body` props — safe).

2. **Normalize the `RunTraceDrawer` default export to a named export + index barrel**
   - File: `src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.tsx`
     and its `index.ts`; consumer `…/[number]/page.tsx`.
   - Problem: uses `export default function RunTraceDrawer(...)` and is imported by default,
     against the repo's named-export convention (Next only *requires* default exports for
     `page.tsx`/`layout.tsx`, not feature components).
   - Change: `export function RunTraceDrawer(...)`; add `export { RunTraceDrawer } from "./RunTraceDrawer";`
     to the folder `index.ts`; update the page to `import { RunTraceDrawer } from "./_components/RunTraceDrawer";`.
     Update `RunTraceDrawer.test.tsx` import accordingly.

3. **Split `FindingsTab` into focused sub-components** (single responsibility)
   - File: `src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx` (~188 lines)
   - Problem: bundles four distinct UX concerns inline — live-run status, lethal-trifecta
     banner, timeline (`RunHistory`), and the review-runs accordion list.
   - Change: extract three sibling components under `FindingsTab/_components/`:
     `LiveRunSection`, `LethalTrifectaBanner`, `TimelineSection` (each with its own
     `styles.ts`/`constants.ts` as needed). `FindingsTab` becomes a thin composition.
     Keep behavior identical; move, don't rewrite. Add/adjust colocated tests for the new
     components if logic moves with them (existing `RunHistory.test.tsx` already covers the timeline).

### Low priority

4. **Remove a redundant default export**
   - File: `src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx`
   - Problem: exports both the named function and an unused `export default`. Consumers use
     the named import.
   - Change: delete the trailing `export default ReviewRunAccordion;`.

5. **Rename `atoms.tsx` → `Atoms.tsx`** (PascalCase for files exporting components)
   - File: `src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/atoms.tsx`
   - Change: rename file, update imports in `TraceBody`. (Note `forceConsistentCasingInFileNames`
     is on — do the rename via `git mv` to avoid case-only issues.)

6. **Normalize the last relative cross-folder imports to `@/`**
   - Files (4, 9 import lines): `src/app/layout.tsx`, `src/app/page.tsx`,
     `src/components/page-shell/PageShell.tsx`, `src/test/smoke.test.tsx`.
   - Problem: use `../lib/...`, `../components/...` where the rest of the codebase uses the
     `@/*` alias.
   - Change: rewrite those imports to `@/lib/...`, `@/components/...`. (Pure import-path
     change; vitest resolves `@/` identically, so tests are unaffected.)

### Out of scope (note, don't do now)
- **No ESLint exists** in `client/` or root. The skill recommends enforcing the
  `shared → features → app` boundary with `import/no-restricted-paths`. Adopting ESLint +
  the import rule + `prettier-plugin-tailwindcss` is a worthwhile follow-up but is a tooling
  addition, not a refactor — track it separately so it doesn't expand this PR's blast radius.

## Execution order

Do the changes in this order (cheapest/safest first), running `pnpm typecheck` after each
group to catch import breakage immediately:

1. Item 1 (delete `"use client"`).
2. Item 6 (import-path normalization) + Item 4 (redundant export) — mechanical.
3. Item 5 (`git mv` rename + import update).
4. Item 2 (named-export migration + index re-export + consumer/test update).
5. Item 3 (FindingsTab split) — the only structural change; keep diffs as pure moves.

Keep each item a separate commit so any regression is easy to bisect. We're on `main` —
branch first (e.g. `chore/frontend-architecture-cleanup`) before committing.

## Definition of Done — tests step (final, mandatory)

The refactor is done only when **all of the following pass with nothing broken and core
functionality working as expected**. Run from `client/`:

1. **Type safety** — `pnpm typecheck` (`tsc --noEmit`) → zero errors. Strict mode +
   `noUncheckedIndexedAccess` are on, so moved/renamed code must stay type-clean.
2. **Unit/component tests** — `pnpm test` (`vitest run`, jsdom, `fetch` mocked) → all 17
   existing test files green. The split-out FindingsTab sub-components and the
   `RunTraceDrawer` named-export change must not break their tests; update test imports as
   part of the relevant item, never weaken assertions to make them pass.
3. **Production build** — `pnpm build` (`next build`) → succeeds with no RSC/"use client"
   boundary errors (this catches any server/client mistake from item 1).
4. **Manual smoke of core flows** — `pnpm dev` and verify the touched surfaces render and
   behave unchanged:
   - Settings section page renders its section titles (item 1).
   - PR detail → Findings tab: live-run status, lethal-trifecta banner, run timeline, and
     the review-runs accordion all render and interact as before (item 3).
   - PR detail → open the Run Trace drawer (item 2/5).
   Use the `verify` skill / `run` skill to drive the app if a deeper check is wanted.

Only when typecheck + tests + build are all green **and** the manual smoke confirms no
behavioral change is the refactor complete.
