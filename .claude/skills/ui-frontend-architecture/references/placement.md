# Placement: constants, utils, types, hooks, business logic

The governing idea is **colocation + promotion**: code starts next to its single user and
moves to a shared location only when a second user appears. ([Kent C. Dodds][kcd])

## Constants

- **Feature-local** constants live in a colocated `constants.ts` inside the feature/
  component folder. Keep them near where they're used so deleting the feature deletes them.
- **App-wide** constants and environment exports live in `config/` (or `lib/config`).
- Don't create a single global `constants.ts` junk-drawer — it becomes an import magnet
  that couples unrelated parts of the app and never gets cleaned up.
- Extract any **magic number or repeated string** to a named constant
  (`UPPER_SNAKE_CASE`). For an enumerated set of string values prefer an `as const`
  object over a TS `enum` (plainer output, better tree-shaking):

  ```ts
  export const STATUS = { idle: 'idle', loading: 'loading', error: 'error' } as const;
  export type Status = (typeof STATUS)[keyof typeof STATUS];
  ```

## `lib/` vs `utils/` — a real distinction

bulletproof-react draws a useful line ([project structure][bp]):

- **`lib/`** = *preconfigured third-party libraries*. The axios instance, the TanStack
  Query client, a configured date library, the db/ORM client. These wrap an external
  dependency with your app's settings so the rest of the code imports the configured
  version, not the raw package.
- **`utils/`** = *your own generic, dependency-free helpers*. Pure functions like
  `formatCurrency`, `groupBy`, `clamp`.

If you're unsure: "is this wrapping a library?" → `lib/`. "Is this my own logic?" →
`utils/` (feature-local first, shared `utils/` once reused).

## Types

- Types used by a single feature → `features/x/types`.
- Types shared across features → top-level `src/types`.
- Types describing an API contract are best derived from a schema (e.g. `z.infer<...>`)
  and live with that contract, not hand-duplicated.

## Hooks

- A hook used by **one** component stays in that component's file (or its folder).
- A hook **reused** within one feature → `features/x/hooks`.
- A hook reused **across** features → shared `hooks/`.
- Only `use`-prefix functions that actually call hooks. ([React docs][react-hooks])

## Business logic: pure function vs hook vs service

Triage by what the logic *does*, not by where you happen to need it:

| The logic is… | It belongs in… | Why |
|---|---|---|
| A stateless transform / calculation (no React state, no I/O) | A **plain pure function** in `utils/` (no `use` prefix) | Testable in isolation, callable anywhere — even conditionally or in loops. ([React: You Might Not Need an Effect][ymnnae]) |
| Stateful or lifecycle-bound, and reused | A **custom hook** | Hooks are how you package stateful logic for reuse and tie into the render lifecycle. ([React: Custom Hooks][react-hooks]) |
| I/O — data fetching, mutations, talking to external systems | A **service / API module** (`features/x/api`), wrapped in a query hook for components | Isolates side effects and the network boundary from rendering. In Next.js this is the **Data Access Layer** ([nextjs-architecture](./nextjs-architecture.md)). |

A common, healthy stack: a pure function does the computation, a service module does the
I/O, and a thin custom hook composes them for the component to consume.

**Keep the logic out of JSX.** Compute derived values during render; don't mirror them
into `useState` and sync with an Effect ("derive, don't store"). The component-coding
detail of this lives in `react-best-practices`; here the point is *where* the logic goes —
into a function/hook/service, not inlined into the component body or markup.

## Promotion strategy

1. Write it colocated with its first and only user.
2. When a **second** user needs it, move it up to the nearest shared level both users
   reach (feature-shared, then app-shared).
3. Don't promote in anticipation — premature shared utilities accrete unrelated callers
   and become hard to change.

## Sources

- bulletproof-react — Project Structure (`lib` vs `utils`, feature folders) — https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
- Kent C. Dodds — Colocation — https://kentcdodds.com/blog/colocation
- React docs — Reusing Logic with Custom Hooks — https://react.dev/learn/reusing-logic-with-custom-hooks
- React docs — You Might Not Need an Effect (derive, don't store) — https://react.dev/learn/you-might-not-need-an-effect
- ESLint — no-magic-numbers — https://eslint.org/docs/latest/rules/no-magic-numbers

[bp]: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
[kcd]: https://kentcdodds.com/blog/colocation
[react-hooks]: https://react.dev/learn/reusing-logic-with-custom-hooks
[ymnnae]: https://react.dev/learn/you-might-not-need-an-effect
