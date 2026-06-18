# DevDigest

Local-first AI pull-request review studio. Import a repo + PR → run an agent
review → grounded structured findings. All local; outbound calls only to GitHub
and the LLM. This is the **course starter**; later lessons (L01–L08) add features.

> **Before working, read `INSIGHTS.md`** (root + the module you're touching). Treat
> its entries as high-confidence guidance unless told otherwise — they're hard-won
> lessons that save you from re-discovering known gotchas.

## Stack

- **Node ≥ 22 · pnpm ≥ 10 · Docker** (Postgres only) · **TypeScript 5.7**
- server: Fastify 5 · Drizzle ORM · `postgres` · pgvector · Zod 3
- client: Next.js 15 (App Router) · React 19 · TanStack Query · Tailwind 4 · next-intl
- reviewer-core: pure TS (OpenAI SDK + Zod), consumed as **source**, emits no JS
- LLM providers: OpenAI / Anthropic / OpenRouter (OpenAI-compatible)

## Layout (4 standalone packages — no monorepo workspace)

| Folder | Package | Role | Port |
|--------|---------|------|------|
| `server/` | `@devdigest/api` | Fastify API + Postgres; hosts `repo-intel` indexer | 3001 |
| `client/` | `@devdigest/web` | Next.js studio UI | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | pure review engine: diff→prompt→LLM→findings | — |
| `e2e/` | `@devdigest/e2e` | deterministic browser flows (agent-browser, no LLM) | — |

Each package has its own `package.json`/lockfile; cross-package code is shared via
**tsconfig path aliases**, not published modules. Shared Zod contracts
(`@devdigest/shared`) are **vendored** (copied, not symlinked) into each package's
`src/vendor/shared`.

## Commands

```sh
./scripts/dev.sh           # zero→running: Postgres + migrate + seed + API + web
docker compose up -d       # Postgres + pgvector only
```
Per package (run inside the folder): `pnpm dev` · `pnpm test` · `pnpm typecheck`.
Server DB: `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:generate`.

## Non-default conventions (what you can't guess from the code)

- **Migrations are NOT applied on boot** — run `cd server && pnpm db:migrate`.
  pgvector is enabled by migration `0000`.
- **The DB schema already contains EVERY table**; unused ones sit empty until a
  later lesson fills them — **do not delete them.**
- **Routes are schema-first**: declare Zod `params`/`body` via
  `fastify-type-provider-zod`; never hand-roll `Schema.parse(req.body)` in a handler.
- **Test split by filename**: `*.it.test.ts` = DB-backed (testcontainers Postgres);
  everything else is hermetic. A DB-backed test MUST use the `.it.test.ts` suffix.
- **Secrets** (LLM keys, `GITHUB_TOKEN`) live in `~/.devdigest/secrets.json`
  (mode `0600`), never in git, the DB, or `AppConfig`.
- **`repo-intel` indexes TS/JS only** (`.ts .tsx .js .jsx .mjs .cjs` via ast-grep);
  other languages degrade to diff-only reviews.

## Do not touch

- `*/src/vendor/**` — vendored copies of shared contracts / UI primitives; changing
  one copy desyncs the others. Treat as generated.
- Unused DB tables / existing migrations — append new migrations, never edit old ones.

## Read when…

- **changing the review flow / prompt / grounding** → read `docs/architecture.md`
  and `reviewer-core/CLAUDE.md`.
- **adding or changing an API route, module, or the DB schema** → read `server/CLAUDE.md`.
- **editing UI, pages, hooks, or i18n messages** → read `client/CLAUDE.md`.
- **touching tests or CI** → read `TESTING.md`.
- **writing browser e2e flows** → read `e2e/CLAUDE.md`.
- **editing a reviewer agent's system prompt** → read `docs/agent-prompts/README.md`.
- **before debugging a known gotcha** → read `INSIGHTS.md` and the module's `INSIGHTS.md`.

## Before you finish

**Update `INSIGHTS.md` when you learned something non-obvious** — invoke the
`engineering-insights` skill to append the lesson to the right module's `INSIGHTS.md`.
Don't skip this step: it's what closes the loop so the next session starts knowing what
this one discovered.
