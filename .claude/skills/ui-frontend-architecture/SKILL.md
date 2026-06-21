---
name: ui-frontend-architecture
description: "React + Next.js frontend ARCHITECTURE — deciding where files and code belong. Covers folder structure (feature-based vs layer-based), the shared→features→app dependency rule, module boundaries and per-feature public APIs, where to put constants/utils/types/hooks/business-logic, barrel-file and import-alias policy, and the Next.js App Router server/client boundary and Data Access Layer. Use this whenever scaffolding a frontend, deciding where a new file should live, organizing or splitting a feature, naming folders, setting up path aliases, reviewing project structure, or asking 'where does this go?'. For component coding patterns (props, hooks, memoization, JSX) use react-best-practices; for routing/RSC/metadata mechanics use next-best-practices."
metadata:
  version: 1.0.0
  tags: react, nextjs, architecture, folder-structure, project-structure, frontend, code-organization, app-router, module-boundaries
  updated: 2026-06-21
---

# UI Frontend Architecture

This skill is about **where things go** in a React + Next.js codebase — the
architectural layer above day-to-day component coding. It answers questions like
"which folder does this helper belong in?", "should this be a hook, a util, or a
service?", "how do I split this into features?", and "where does the `"use client"`
boundary go?".

It is deliberately scoped to **structure and placement**. For the layers next to it:

- **Component coding** (props destructuring, hooks misuse, memoization, JSX pitfalls,
  derive-don't-store) → use the **`react-best-practices`** skill.
- **Next.js routing/RSC mechanics** (file conventions, async params, metadata, error
  boundaries, image/font, hydration) → use the **`next-best-practices`** skill.

This skill cross-links to both rather than repeating them.

## Core principles

These are the durable rules. Everything in `references/` is an elaboration of one of them.

1. **Organize by feature, not by file type.** Past a toy app, layer-folders
   (`components/`, `hooks/`, `utils/` holding the *whole* app) scatter one feature's
   code across the tree. Group code by the feature/domain it serves; reserve
   type-folders for genuinely shared code. ([bulletproof-react][bp-structure], [Wieruch][rw-folders])

2. **Colocate.** Keep code as close as possible to where it's used — tests, styles,
   helpers, local types next to the component. Promote something to a shared location
   only when a **second** consumer actually needs it, not in anticipation. ([Kent C. Dodds][kcd-coloc])

3. **Dependencies flow one way: `shared → features → app`.** Shared code knows nothing
   about features; features import only from shared; the app composes features.
   **Features never import each other** — a cross-feature need means the code belongs
   one layer up (shared) or should be composed at the page/app level. Enforce with
   ESLint `import/no-restricted-paths`. ([bulletproof-react][bp-structure], [Wieruch][rw-folders])

4. **Each feature exposes a small public API; internals stay private.** Consumers
   import from the feature's entry point, not its deep files. Keep that entry point
   small and pure (see the barrel-file caveat in [imports-and-boundaries][r-imports]).

5. **Business logic lives outside JSX.** Derive values during render, lift stateful
   logic into custom hooks, push I/O into service/API modules or a Data Access Layer.
   (The component-coding side of this is in `react-best-practices`; the *placement*
   side is in [placement.md][r-placement].)

6. **In Next.js, default to Server Components and push `"use client"` to the leaves.**
   The server/client split is an architectural boundary, not a per-file detail — it
   decides what ships to the browser and where secrets are allowed. ([Next.js docs][next-sc])

## "Where does this go?" — quick decision guide

| You have… | Put it… |
|---|---|
| A value reused or unexplained (magic number/string) | A named constant — colocated `constants.ts` if feature-local, `config/` if app-wide. [placement][r-placement] |
| A pure, stateless transform (no hooks) | A plain function in the feature's `utils/` (or shared `utils/` once 2+ features use it). **No `use` prefix.** [placement][r-placement] |
| Stateful/lifecycle logic reused across components | A custom hook (`useX`) — feature `hooks/` if local, shared `hooks/` if cross-feature. [placement][r-placement] |
| I/O, data fetching, external-system access | A service/API module (`features/x/api`) or, in Next.js, the **Data Access Layer**. [nextjs-architecture][r-nextjs] |
| A preconfigured third-party client (axios, query client, db) | `lib/` (not `utils/`). [placement][r-placement] |
| A type used by one feature | `features/x/types`. Shared across features → `src/types`. [placement][r-placement] |
| A component reused app-wide | Shared `components/`. Used by one feature → that feature's folder. [folder-structure][r-folders] |
| Anything one feature owns | Inside that feature's folder, colocated. [folder-structure][r-folders] |

## Reference files

Read the one that matches your task:

- **[references/folder-structure.md][r-folders]** — feature-based vs layer-based, the
  bulletproof-react `src/` layout, the dependency rule and how to enforce it, the
  small→large scaling model, naming conventions, when to split a component / extract a
  hook, and why container/presentational is mostly obsolete.
- **[references/placement.md][r-placement]** — detailed placement rules for constants,
  `lib/` vs `utils/`, types, hooks, and the pure-function vs hook vs service triage for
  business logic, plus the promotion strategy.
- **[references/nextjs-architecture.md][r-nextjs]** — App Router organization strategies,
  private `_folders` for colocation, the server/client boundary (donut/`children`
  pattern, providers deep), where data fetching goes (Server Components vs Server Actions
  vs Route Handlers), and the server-only Data Access Layer + env-var rules.
- **[references/imports-and-boundaries.md][r-imports]** — `@/*` path aliases, the
  barrel-file policy (avoid arbitrary app-wide barrels), and feature isolation /
  public-API enforcement.
- **[references/this-repo.md][r-thisrepo]** — how **DevDigest's `client/`** adapts the
  generic standard (route-colocated `_components`, named exports, `styles.ts`, the
  `lib/hooks → lib/api` data layer). Read this when working in this repo.

For concrete good-vs-bad code across all topics, see **[examples.md](./examples.md)**.

[r-folders]: ./references/folder-structure.md
[r-placement]: ./references/placement.md
[r-nextjs]: ./references/nextjs-architecture.md
[r-imports]: ./references/imports-and-boundaries.md
[r-thisrepo]: ./references/this-repo.md
[bp-structure]: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
[rw-folders]: https://www.robinwieruch.de/react-folder-structure/
[kcd-coloc]: https://kentcdodds.com/blog/colocation
[next-sc]: https://nextjs.org/docs/app/getting-started/server-and-client-components
