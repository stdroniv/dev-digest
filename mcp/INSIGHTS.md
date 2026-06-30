# mcp — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module (`@devdigest/mcp`).
Managed by the `engineering-insights` skill. Add each entry under one section; keep
it actionable cold; never edit or delete existing entries.

## What Works

- **The `devdigest_get_blast_radius` `no_data` bug (matching "What Doesn't Work" below) was fixed entirely server-side in `platform/config.ts` — no MCP change needed.** Anchoring relative `DEVDIGEST_CLONE_DIR` to `import.meta.url` (→ `SERVER_ROOT`) instead of `process.cwd()` means the MCP process (cwd pinned to `mcp/`) and the API (cwd=`server/`) now resolve the identical `cloneDir` without any env vars in `.mcp.json`. The secondary contributor (PRs with empty `pr_files`) remains a separate open issue.

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

- `devdigest_get_blast_radius` returns `no_data`/0 symbols for a PR whose UI Blast
  Radius panel shows real symbols — this is NOT an MCP bug but a clone-dir
  resolution mismatch in the shared server code. `RipgrepCodeIndex`
  (`server/src/adapters/codeindex/ripgrep.ts`) resolves the clone via
  `config.cloneDir` (`server/src/platform/config.ts`), which reads
  `DEVDIGEST_CLONE_DIR` relative to `process.cwd()` and loads `.env` from cwd ONLY.
  The MCP server runs from `bin/devdigest-mcp.mjs`, which PINS cwd to `mcp/`, and
  `.mcp.json` passes only `DATABASE_URL` — with no `mcp/.env`, the MCP process's
  `cloneDir` defaults to `~/.devdigest/workspace` (nonexistent) instead of the
  API's `server/clones`, so the directory walk finds nothing → empty blast. The API
  (cwd=`server/`, `server/.env` has `DEVDIGEST_CLONE_DIR=./clones`) finds the clone
  and returns symbols. Both call the IDENTICAL `BlastService.getBlast`. Proven by
  A/B: same bootstrap code → 0 symbols with MCP defaults, but #29557→2 / #28926→70
  once `DEVDIGEST_CLONE_DIR` pointed at `server/clones`. Fix server-side (use
  persisted `repos.clone_path` / cwd-independent `cloneDir`) or give the MCP process
  the same `DEVDIGEST_CLONE_DIR` as the API (avoid hardcoding a machine-absolute
  path into repo-committed `.mcp.json`). SECONDARY contributor: the tool also
  returns `no_data` when a PR's `pr_files` is empty — only the UI's `GET /pulls/:id`
  detail-load populates `pr_files` from GitHub (`server/src/modules/pulls/routes.ts`);
  `resolvePull` (`src/resolvers.ts`) doesn't, so a PR imported via the list endpoint
  and never opened in the UI has `changedFiles=[]` → empty blast even after the
  clone dir is fixed.

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

- The MCP server a Claude Code session is connected to is a LONG-RUNNING process
  spawned ONCE at session start, and `tsx src/index.ts` loads the TS source into
  memory at spawn time. So even though `bin/devdigest-mcp.mjs` runs straight from
  source (no build step), editing/committing MCP source mid-session — or starting a
  session before a source change landed — leaves the connected client returning the
  OLD behavior. Observed this session: the connected `devdigest_get_blast_radius`
  returned the OLD `{status:'not_implemented', …}` stub (a string that no longer
  exists anywhere in `src/`) while the current source returns the real
  `{symbols, totals, index, …}` shape. Don't trust the session's connected tool to
  reflect current source: restart the MCP server / Claude Code session, or verify
  behavior by running `tsx src/index.ts` fresh (drive it over stdio) or via a
  standalone `bootstrap()` script (`DATABASE_URL=… tsx scratch.mts`) that calls the
  service directly. Tell-tale that you're on a stale process: `ps -eo pid,lstart,command | grep devdigest-mcp`
  shows a start time earlier than your last source edit.

## Session Notes

## Open Questions
