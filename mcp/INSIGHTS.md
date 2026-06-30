# mcp — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module (`@devdigest/mcp`).
Managed by the `engineering-insights` skill. Add each entry under one section; keep
it actionable cold; never edit or delete existing entries.

## What Works

## What Doesn't Work

- Do NOT author an MCP tool's Zod contract ahead of the server feature it wraps.
  `devdigest_get_blast_radius` shipped a speculative contract (inputs
  `direction: callers|callees|both`, `max_depth: 1-5`; output
  `impacted[].relation: 'caller'|'callee'` + `depth`) that did NOT match the real
  feature once it landed: `BlastService`/`repo-intel` is **callers-only and
  single-hop** — the index stores no callee or depth data, so those inputs/fields
  could never be honestly satisfied. De-stubbing meant a breaking contract
  redesign (drop `direction`/`max_depth`; reshape output to mirror the server's
  `BlastResponse` — symbols grouped with callers + endpoints + crons +
  index/degraded/resolution). Lesson: derive an MCP contract FROM the real service
  shape (`server/src/modules/<feature>/types.ts`), never speculatively before it.

## Codebase Patterns

- Wiring a new tool to an existing server feature needs NO server change when the
  feature's application service is Fastify-free and reachable via the container.
  `BlastService` (server `modules/blast/service.ts`) takes only `Container` and
  `(workspaceId, prId)`, and `container.repoIntel` is already exposed on the same
  `Container` the MCP `bootstrap()` builds. So `devdigest_get_blast_radius` just
  adds `blast: new BlastService(container)` to the bootstrap `Services` bundle and
  calls `deps.services.blast.getBlast(workspaceId, pull.id)` (pull.id comes from
  the existing `resolvePull`). Keep the camelCase→snake_case wire mapping in a pure
  `format.ts` helper (`projectBlast`) so it has a hermetic unit test, mirroring
  `projectFinding`.
- MCP integration tests inject a mock facade exactly like the server does: pass
  `ContainerOverrides` as the 2nd arg of `buildDeps(db, { repoIntel: mockRepoIntel })`
  (`test/helpers/harness.ts` forwards it to `bootstrap` → `Container`). The seeded
  PR `acme/payments-api#482` resolves without extra setup, and a mock `RepoIntel`
  that ignores `changedFiles` needs no `pr_files` rows. Pattern source:
  `server/test/blast-routes.it.test.ts`.

- The stdio server (`node bin/devdigest-mcp.mjs` → `src/index.ts`) boots and answers
  the MCP `initialize` handshake even with NO or wrong `DATABASE_URL` — the Postgres
  connection is lazy, established only on the first tool invocation. Verified
  2026-06-29 by piping an `initialize` request to the server both with and without
  `DATABASE_URL`; both returned the same successful `initialize` result. So
  `DATABASE_URL` only matters at tool-call time (`devdigest_list_agents`,
  `devdigest_review_pr`), never at connect time.

## Tool & Library Notes

## Recurring Errors & Fixes

- MCP Inspector "Connect" failing against this server is NEVER the server or its env:
  Connect only performs the `initialize` handshake, which succeeds regardless of
  `DATABASE_URL` (see Codebase Patterns). The cause is the Inspector proxy/auth layer —
  most often `MCP_PROXY_AUTH_TOKEN`: open the tokenized URL the CLI prints
  (`http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=...`), paste the token into the
  Inspector's Configuration → Proxy Session Token field, or relaunch with
  `DANGEROUSLY_OMIT_AUTH=true npx @modelcontextprotocol/inspector ...`. Also check for a
  stale Inspector holding the ports (6274 = UI, 6277 = proxy):
  `lsof -ti tcp:6274 tcp:6277 | xargs kill`.

## Session Notes

## Open Questions
