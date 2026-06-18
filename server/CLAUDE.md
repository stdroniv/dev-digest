# server — `@devdigest/api`

Fastify API + Drizzle/Postgres. Imports repos & PRs, indexes repos (`repo-intel`),
stores agents, runs the reviewer (`reviewer-core` → grounded findings).

## Commands

`pnpm dev` (:3001) · `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:generate` ·
`pnpm typecheck` · `pnpm test`.
Unit only: `pnpm exec vitest run --exclude '**/*.it.test.ts'` ·
integration only: `pnpm exec vitest run .it.test`.

## Conventions (non-obvious)

- **Adapters behind a DI container** (`platform/container.ts`); ports are
  `src/adapters/*` (llm · github · git · astgrep · tokenizer · secrets). Tests
  swap them via `src/adapters/mocks.ts` — never call externals directly in a service.
- **Modules are self-contained plugins** under `src/modules/<name>/` (own
  `routes.ts` + service), registered statically in `src/modules/index.ts`.
- **Plugins register before modules** (helmet, cors, rate-limit, SSE, error
  handler) so encapsulated module plugins inherit them.
- **Schema-first routes**: Zod `params`/`body` via `fastify-type-provider-zod`
  reject invalid input with `422` before the handler. No hand-rolled parsing.
- **Config**: `loadConfig` (`src/platform/config.ts`) marks every secret optional —
  the server **boots with no keys**. Secrets resolve only through
  `LocalSecretsProvider` (`src/adapters/secrets/local.ts`), never `AppConfig`.
- **Rate limiting**: global 120/min (off under `NODE_ENV=test`), tighter per-route
  on expensive endpoints; SSE + `/health*` exempt.

## Do not touch

- Existing migrations (`src/db/migrations`) — append a new one via `pnpm db:generate`.
- Unused tables in `src/db/schema.ts` — they're reserved for later lessons.
- `src/vendor/shared` — vendored shared contracts; edit upstream, then re-vendor.

## Read when…

- **API surface / which module owns a route** → `README.md` (API map).
- **review context, injection defense, grounding** → `README.md` § Review context
  + `../reviewer-core/CLAUDE.md`.
- **the codebase indexer** → `src/modules/repo-intel/README.md`.
- **env vars / ports / defaults** → `README.md` § Environment.
- **how tests split / testcontainers** → `../TESTING.md`.
- **specs for in-progress work** → `specs/`. **Hard-won gotchas** → `INSIGHTS.md`.
