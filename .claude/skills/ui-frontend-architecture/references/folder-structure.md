# Folder structure

## Feature-based vs layer-based

There are two ways to slice a frontend:

- **Layer-based (by file type):** top-level `components/`, `hooks/`, `utils/`,
  `services/` that hold the entire app. Fine for tiny apps. It scales badly because a
  single feature's files end up scattered across every folder — to understand or delete
  one feature you hunt through the whole tree, and unrelated features sit next to each
  other with nothing in common.

- **Feature-based (by domain):** a `features/` directory where each feature is a
  self-contained module that mirrors the app's structure internally. This is the
  recommended default for anything beyond a toy app. ([bulletproof-react][bp], [Wieruch][rw])

Reserve layer-folders for code that is **genuinely shared** across features.

## The bulletproof-react `src/` layout

A widely used reference layout ([bulletproof-react][bp]):

```
src/
├── app/         # routes, app entry, providers, router setup
├── assets/      # static files (images, fonts)
├── components/  # shared components used across the app
├── config/      # global config and env exports
├── features/    # feature modules — the bulk of the app
├── hooks/       # shared hooks
├── lib/         # preconfigured third-party libraries (axios, query client, ...)
├── stores/      # global state stores
├── testing/     # test utilities and mocks
├── types/       # shared TypeScript types
└── utils/       # shared generic helpers
```

Each **feature** mirrors that structure, scoped to itself:

```
features/awesome-feature/
├── api/         # data fetching / mutations for this feature
├── assets/
├── components/  # components scoped to this feature
├── hooks/
├── stores/
├── types/
└── utils/
```

Not every feature needs every folder — add them as the feature grows.

## The dependency rule (the core constraint)

Code flows in **one direction only**:

```
shared (components/ hooks/ lib/ utils/ types/)  →  features/  →  app/
```

- Shared code must not import from `features/` or `app/`.
- A feature may import from shared, but **not from another feature**.
- The app may import from features and shared, and is where features are composed.

When one feature seems to need another feature's code, that's the signal to either
**lift the shared piece up** into `components/`/`hooks/`/`utils/`, or **compose both
features at the page/app level** instead of importing across them. ([Wieruch][rw])

Enforce it mechanically so it doesn't rot — ESLint `import/no-restricted-paths`
([bulletproof-react project standards][bp-std]); see [imports-and-boundaries.md](./imports-and-boundaries.md).

## Scaling model — don't start at "enterprise"

Structure should grow with the app, not lead it ([Wieruch][rw]):

1. **Small:** single files; split a component into its own file once it's reused.
2. **Medium:** component *folders* (`Component.tsx` + colocated `Component.test.tsx` +
   styles), plus technical folders `hooks/`, `context/`, `utils/`, `lib/`.
3. **Large:** introduce `features/`, each feature self-contained; keep `components/`
   for **reusable UI only**.
4. **Enterprise:** monorepo (`apps/`, `packages/`, shared domains).

Don't pre-build the large structure for a small app — that's premature abstraction.
Promote code upward only when a real second consumer appears.

## Naming conventions

- **Component identifiers:** `PascalCase` (`UserCard`).
- **Files/folders:** pick one convention and be consistent. bulletproof-react enforces
  **kebab-case** for files and `src/` folders via `check-file` ([project standards][bp-std]);
  Wieruch favors kebab-case for cross-OS reliability. (Note: this repo uses PascalCase
  component *files* — see [this-repo.md](./this-repo.md).)
- **Variables/functions:** `camelCase`.
- **Constants:** `UPPER_SNAKE_CASE`.
- **Hooks:** `use` + Capital (`useOnlineStatus`) — and **only** prefix with `use` if the
  function actually calls hooks; otherwise it's a plain function. ([React docs][react-hooks])
- **Feature folders:** singular domain nouns (`features/customer`, not `customers`).

## When to split a component

Split by **single responsibility, not line count.** A piece of UI becomes its own
component when it grows complex enough to own a distinct responsibility (e.g. a table
header that gains sorting → extract `TableHeader`). Let the data model's shape guide the
component hierarchy. Avoid premature extraction — wait for real complexity or real
repetition. ([React: Thinking in React][react-thinking])

## When to extract a custom hook

Extract a hook when stateful logic is **duplicated across components** or when you're
**stepping outside React** (subscribing to an external system, e.g. `useOnlineStatus`,
`useChatRoom`). Don't extract a hook for trivial duplication (a one-line `useState`
wrapper), and avoid generic lifecycle wrappers like `useMount`/`useEffectOnce` — prefer
concrete, intention-revealing hooks. If a function calls no hooks, make it a plain
function. ([React: Reusing Logic with Custom Hooks][react-hooks])

## Container/presentational is mostly obsolete (2025)

The old "container component fetches, presentational component renders" split adds wrapper
boilerplate that hooks made unnecessary. Modern React achieves the same separation with
**custom hooks / service modules** (the logic) consumed by **presentational components**
(the rendering). Keep the *principle* (separate logic from rendering); drop the
container-component *mechanism*. ([Patterns.dev][patterns])

## Sources

- bulletproof-react — Project Structure — https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
- bulletproof-react — Project Standards (aliases, naming, lint rules) — https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md
- Robin Wieruch — React Folder Structure — https://www.robinwieruch.de/react-folder-structure/
- Robin Wieruch — Feature-based React Architecture — https://www.robinwieruch.de/react-feature-architecture/
- Kent C. Dodds — Colocation — https://kentcdodds.com/blog/colocation
- React docs — Thinking in React — https://react.dev/learn/thinking-in-react
- React docs — Reusing Logic with Custom Hooks — https://react.dev/learn/reusing-logic-with-custom-hooks
- Patterns.dev — Container/Presentational Pattern — https://www.patterns.dev/react/presentational-container-pattern/

[bp]: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
[bp-std]: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md
[rw]: https://www.robinwieruch.de/react-folder-structure/
[react-hooks]: https://react.dev/learn/reusing-logic-with-custom-hooks
[react-thinking]: https://react.dev/learn/thinking-in-react
[patterns]: https://www.patterns.dev/react/presentational-container-pattern/
