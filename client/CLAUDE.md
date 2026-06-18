# client — `@devdigest/web`

Next.js 15 (App Router) studio UI. Data via TanStack Query over the Fastify API.

## Commands

`pnpm dev` (:3000) · `pnpm test` (vitest + jsdom, `fetch` mocked — no API needed) ·
`pnpm typecheck`.

## Conventions (non-obvious)

- **All data access goes through `src/lib/hooks/*` → `src/lib/api.ts`.** Never
  `fetch` the API from a component directly. Base URL = `NEXT_PUBLIC_API_BASE`
  (default `http://localhost:3001`).
- **Pages are thin** (`src/app/**/page.tsx`); feature logic lives in colocated
  `_components/<Name>/`, each with its own `*.test.tsx`.
- **Cross-cutting chrome** (nav, breadcrumbs, `g`-then-key shortcuts) is in
  `src/components/app-shell`.
- **i18n via next-intl**: user-facing strings come from `messages/<locale>/*.json`,
  not hard-coded JSX.
- **Vendored deps**: UI primitives in `src/vendor/ui` (`@devdigest/ui`), shared Zod
  contracts in `src/vendor/shared` (`@devdigest/shared`).

## Do not touch

- `src/vendor/**` — vendored UI primitives + shared contracts (copies; editing one
  desyncs the others). Treat as generated.

## Read when…

- **route map / which API each page calls** → `README.md` (UI route map).
- **component vs browser test boundary** → `README.md` § Testing + `../TESTING.md`.
- **real browser journeys** → `../e2e/CLAUDE.md`.
- **specs for in-progress work** → `specs/`. **Hard-won gotchas** → `INSIGHTS.md`.
