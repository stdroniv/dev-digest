# mcp — `@devdigest/mcp`

Standalone **stdio MCP server** that exposes DevDigest's review functionality to
MCP clients (e.g. Claude Desktop). It boots the server's DI `Container`
**in-process** (no HTTP, no separate API process) and wraps `AgentsService`,
`ReviewService`, and `ConventionsService` in five tools (`devdigest_list_agents`,
`devdigest_review_pr`, `devdigest_get_findings`, `devdigest_get_conventions`,
`devdigest_get_blast_radius`). Reads the same Postgres DB and
`~/.devdigest/secrets.json` as the API.

## Commands

`pnpm test` (vitest) · `pnpm typecheck` (`tsc --noEmit`) · `pnpm mcp` (run the
stdio server, `tsx src/index.ts`).
Unit only: `node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` ·
integration only (Docker): `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run .it.test`.
**Offline, prefer the `node_modules/.bin/<tool>` binaries over `pnpm <script>`** —
`pnpm` runs a dependency pre-check that hard-fails without network access.

## Conventions (non-obvious)

- **Thin adapter — zero business logic here.** Tools (`src/tools/*`) only
  validate input, call a server application service, and shape the result.
  `bootstrap()` (`src/bootstrap.ts`) mirrors `server/src/app.ts:buildApp` MINUS
  Fastify: same `Container`, same `AgentsService`/`ReviewService`/`ConventionsService`.
  New behavior belongs in the server service, then is called from a tool.
- **stdout is the JSON-RPC channel — ONLY `StdioServerTransport` may write it.**
  Every diagnostic goes to `stderrLogger` (`src/logger.ts`). **No `console.log`
  anywhere**: one stray stdout byte corrupts the stream.
- **Heavy deps resolve from `server/node_modules` via tsconfig path aliases**
  (`@devdigest/api/*` → `../server/src/*`, plus `@devdigest/reviewer-core`).
  `package.json` lists only `@modelcontextprotocol/sdk`, `zod`, `zod-to-json-schema`.
  So **install `server/` deps first** (`cd server && npm install`) or imports won't
  resolve. `vitest.config.ts` re-aliases server source's own `@devdigest/shared`
  to OUR vendored copy.
- **Domain failures return `isError: true` RESULTS, never protocol throws.** Throw
  `McpToolError` (`src/errors.ts`) for recoverable/actionable failures (repo/PR/agent
  not found, mutually-exclusive args); `runTool` maps it to an `isError` result the
  model self-corrects from. Unexpected errors are logged to stderr and replaced with
  a fixed generic message — **never echo internals** (paths, SQL, secrets). Let the
  SDK raise true protocol errors (unknown tool, schema-invalid args).
- **Identifiers are human-readable, resolved server-side** (`src/resolvers.ts`):
  `owner/repo#number`, `owner/repo`, agent name — no UUIDs cross the wire.
- **Secrets come from `~/.devdigest/secrets.json` via `LocalSecretsProvider`**, never
  `process.env`. Only `DATABASE_URL` (required) and `DEVDIGEST_MCP_EMIT_TEXT` are env.
- **`okResult` emits `structuredContent` only by default** (`src/errors.ts`);
  `DEVDIGEST_MCP_EMIT_TEXT=true` also serializes a duplicate `text` block (≈2×
  tokens) for clients that can't read structured content.
- **Bootstrap deliberately does NOT call `reapStaleRuns()`** (unlike `buildApp`) — it
  marks every `status='running'` row failed regardless of owner and would clobber an
  in-flight review owned by a concurrently-running API process.
- **Test split by filename** (same as server): `*.it.test.ts` = DB-backed
  (testcontainers Postgres, Docker required); everything else is hermetic.
- **`devdigest_get_blast_radius` reads the real blast feature** via
  `services.blast.getBlast` (server `BlastService`) → `repoIntel` index, zero AI.
  It is **callers-only and single-hop**: no callee traversal and no multi-depth
  exist in `repo-intel`, so the tool exposes neither (the old speculative
  `direction`/`max_depth` inputs were removed). The `index`/`degraded`/`resolution`
  fields honestly report a partial index or unresolved references.

## Do not touch

- `src/vendor/**` — vendored copies of `@devdigest/shared` contracts, kept
  byte-aligned with the server's copy. Editing one desyncs the others; treat as
  generated.

## Read when…

- **full tool reference (inputs/outputs), prerequisites, client config** → `README.md`.
- **the services the tools call / the DI container** → `../server/CLAUDE.md` + `../server/README.md`.
- **secrets / config / `LocalSecretsProvider`** → root `CLAUDE.md` (Secrets) + `../server/README.md` § Environment.
- **how tests split / testcontainers** → `../TESTING.md`.
- **hard-won gotchas** → `INSIGHTS.md`.
