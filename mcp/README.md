# `@devdigest/mcp` — stdio MCP server

A standalone, local-first stdio MCP server that exposes DevDigest's review
functionality to MCP clients (e.g. Claude Desktop). It boots the server's DI
`Container` in-process — no HTTP, no separate process — and wraps
`AgentsService`, `ReviewService`, and `ConventionsService` in five tools. It
reads the same Postgres database and `~/.devdigest/secrets.json` secrets as the
API; the API process does not need to be running.

- **Transport:** stdio only (`StdioServerTransport`)
- **Tools:** `devdigest_list_agents`, `devdigest_review_pr`,
  `devdigest_get_findings`, `devdigest_get_conventions`,
  `devdigest_get_blast_radius`
- **Identifiers:** human-readable (`owner/repo#number`, `owner/repo`, agent
  name) resolved server-side — no UUIDs needed
- **Errors:** domain failures (repo/PR/agent not found, bad args) return
  `isError: true` with an actionable message, not a protocol throw

## Prerequisites

1. **Node ≥ 22** on PATH.
2. **Postgres running** and migrated:

   ```sh
   cd server && pnpm db:migrate && pnpm db:seed
   ```

   Migrations are not applied on boot; `db:seed` is idempotent (seeds
   `acme/payments-api`, PR #482, two built-in agents).

3. **`DATABASE_URL`** in env pointing at the database.
4. **LLM keys and `GITHUB_TOKEN`** in `~/.devdigest/secrets.json` (mode
   `0600`), not in `process.env` — they are loaded by `LocalSecretsProvider`.
5. **Repo + PR already imported** via the DevDigest web UI. The MCP tools read
   existing database state; they do not import from GitHub. For
   `devdigest_get_conventions`, conventions must also be extracted and accepted
   in the web UI.

## Install

The `mcp/` package only lists `@modelcontextprotocol/sdk`, `zod`, and
`zod-to-json-schema` as direct dependencies. Heavy transitive deps (drizzle,
postgres, openai, anthropic, etc.) are resolved from `server/node_modules` via
`tsconfig.json` path aliases — so server's deps must be installed first.

```sh
# from the repo root
cd server && npm install    # installs heavy transitive deps
cd ../mcp  && npm install   # installs sdk + zod + dev deps
```

## Running the server

Launch directly for testing or troubleshooting:

```sh
cd mcp
DATABASE_URL=postgres://devdigest:devdigest@localhost:5432/devdigest \
  node_modules/.bin/tsx src/index.ts
```

Prefer `node_modules/.bin/tsx src/index.ts` over `pnpm mcp` when running
offline: `pnpm <script>` runs a dependency pre-check that hard-fails without
network access.

All diagnostics go to **stderr**. The stdout channel belongs exclusively to the
`StdioServerTransport`; any stray byte there corrupts the JSON-RPC stream.

## MCP client configuration

Configure any stdio-compatible MCP client to spawn the server with
`DATABASE_URL` in its environment. Example for Claude Desktop
(`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "node",
      "args": ["/absolute/path/to/dev-digest/mcp/bin/devdigest-mcp.mjs"],
      "env": {
        "DATABASE_URL": "postgres://devdigest:devdigest@localhost:5432/devdigest"
      }
    }
  }
}
```

Replace `/absolute/path/to/dev-digest` with your actual repo root. The
`bin/devdigest-mcp.mjs` shim spawns `mcp/node_modules/.bin/tsx src/index.ts`
internally — no build step required.

Alternatively, point the client directly at `tsx`:

```json
{
  "command": "/absolute/path/to/dev-digest/mcp/node_modules/.bin/tsx",
  "args": ["/absolute/path/to/dev-digest/mcp/src/index.ts"],
  "env": {
    "DATABASE_URL": "postgres://devdigest:devdigest@localhost:5432/devdigest"
  }
}
```

## Tools reference

### `devdigest_list_agents` — List PR review agents

Read-only. Lists the AI review agents configured in the local DevDigest
workspace. A DevDigest agent is an LLM provider + model + system prompt +
linked skills.

**Input**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled_only` | boolean | `false` | When `true`, return only agents that are currently enabled |

**Output**

```json
{
  "agents": [
    {
      "name": "standard-reviewer",
      "description": "...",
      "enabled": true,
      "strategy": "single-pass",
      "provider": "openai",
      "model": "gpt-4o"
    }
  ],
  "count": 1
}
```

`system_prompt`, `output_schema`, `id`, and `version` are deliberately omitted
(large / low signal). Use `name` as the stable handle for the other tools.

---

### `devdigest_review_pr` — Run a review agent on a pull request

Run one named agent or every enabled agent against an already-imported PR and
block until the review finishes. Makes LLM and GitHub calls; not idempotent.

**Input**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pr` | string | required | `owner/repo#number` (e.g. `acme/payments-api#482`) |
| `agent` | string | — | Exact agent name (case-insensitive) from `devdigest_list_agents` |
| `all` | boolean | `false` | Run every enabled agent on the PR |
| `response_format` | `concise` \| `detailed` | `concise` | `concise` = file:line + severity + title; `detailed` adds rationale + suggestion |
| `timeout_seconds` | integer (10–600) | `120` | Max seconds to block before returning a still-running result |

Exactly one of `agent` or `all: true` is required. Providing both or neither
returns `isError: true` with a fix message.

**Output**

```json
{
  "pr": "acme/payments-api#482",
  "completed": true,
  "runs": [
    { "run_id": "...", "agent_name": "standard-reviewer", "status": "done", "error": null }
  ],
  "summary": { "critical": 1, "warning": 3, "suggestion": 5, "total": 9, "blockers": 1 },
  "findings": [ ... ],
  "message": null
}
```

`blockers` equals the CRITICAL count (mirrors the run gate). At most 50
findings are inlined; if truncated, `message` instructs you to call
`devdigest_get_findings` with a severity filter to narrow.

When `timeout_seconds` elapses before completion, `completed` is `false`,
`runs[].status` is `"running"`, `findings` is `[]`, and `message` tells you to
call `devdigest_get_findings` later. The review continues running in the MCP
process.

---

### `devdigest_get_findings` — Get findings for a pull request

Read-only. Fetches grounded review findings for an already-reviewed PR.
Defaults to the newest review per agent so re-runs don't surface stale
duplicates. Supports server-side filtering and pagination.

**Input**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pr` | string | required | `owner/repo#number` |
| `agent` | string | — | Restrict to one agent's findings (by name) |
| `severity` | `CRITICAL` \| `WARNING` \| `SUGGESTION` | — | Filter by severity |
| `category` | `bug` \| `security` \| `perf` \| `style` \| `test` | — | Filter by category |
| `file` | string | — | Restrict to findings whose `file` equals this path |
| `include_dismissed` | boolean | `false` | Include findings the user dismissed in the UI |
| `all_runs` | boolean | `false` | Include findings from all historical reviews, not only the newest per agent |
| `response_format` | `concise` \| `detailed` | `concise` | `concise` = head fields only; `detailed` adds rationale + suggestion |
| `limit` | integer (1–100) | `20` | Max findings per page |
| `cursor` | string | — | Opaque cursor from a prior response's `next_cursor` |

**Output**

```json
{
  "pr": "acme/payments-api#482",
  "findings": [ ... ],
  "total_matched": 42,
  "returned": 20,
  "has_more": true,
  "next_cursor": "eyJvZmZzZXQiOjIwfQ==",
  "truncated_note": "Showing 20 of 42 matching findings; pass next_cursor for the next page."
}
```

Each finding in `concise` format: `{ id, severity, category, title, file,
start_line, end_line }`. `detailed` adds `rationale`, `suggestion`, and
`confidence`.

---

### `devdigest_get_conventions` — Get a repo's accepted conventions

Read-only. Returns only conventions with `status = 'accepted'` (approved in
the web UI). Pending and rejected candidates are never returned.

**Input**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `repo` | string | required | `owner/repo` (e.g. `acme/payments-api`) |
| `category` | string | — | Restrict to one convention category |
| `response_format` | `summary` \| `detailed` | `summary` | `summary` omits the evidence code snippet; `detailed` includes it |
| `limit` | integer (1–100) | `20` | Max conventions per page |
| `cursor` | string | — | Opaque pagination cursor |

**Output**

```json
{
  "repo": "acme/payments-api",
  "conventions": [
    {
      "rule": "All async functions must declare an explicit return type",
      "category": "style",
      "evidence_path": "src/service.ts",
      "evidence_start_line": 12,
      "evidence_end_line": 14,
      "confidence": 0.9
    }
  ],
  "total": 5,
  "returned": 5,
  "has_more": false,
  "next_cursor": null
}
```

`detailed` format adds `evidence_snippet` (the actual source lines).

---

### `devdigest_get_blast_radius` — Get the blast radius of changed symbols

For each symbol changed by a PR, returns its cross-file **callers** plus the HTTP
endpoints and cron jobs reachable from those caller files. Reads only the
`repo-intel` index (zero AI calls). The analysis is **callers-only and
single-hop** — there is no callee or multi-depth traversal in DevDigest's index,
so those inputs do not exist. The tool validates the PR exists first (actionable
`isError` if not).

**Input**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pr` | string | required | `owner/repo#number` |
| `symbol` | string | — | Restrict to one **changed** symbol by exact name; omit for all. A non-matching name returns an empty result (not an error) |

**Output**

```json
{
  "pr": "acme/payments-api#482",
  "symbol": null,
  "symbols": [
    {
      "file": "src/payments.ts",
      "name": "processPayment",
      "kind": "function",
      "callers": [
        { "file": "src/api/checkout.ts", "symbol": "handleCheckout", "line": 42, "rank": 9 }
      ],
      "endpoints": ["POST /api/checkout"],
      "crons": []
    }
  ],
  "totals": { "symbols": 1, "callers": 2, "endpoints": 2, "crons": 0 },
  "impacted_endpoints": ["POST /api/checkout", "POST /api/refunds"],
  "impacted_crons": [],
  "index": {
    "status": "full",
    "degraded": false,
    "reason": null,
    "last_indexed_sha": "def789abc"
  },
  "degraded": false,
  "reason": null,
  "resolution": { "limited": false }
}
```

`callers` are rank-desc, capped at 20 per symbol. The `index`, `degraded`, and
`resolution` fields honestly report when the index is partial/degraded or when
many cross-file references stayed unresolved (some callers may be missing).

## Configuration

| Env var | Required | Default | Description |
|---------|----------|---------|-------------|
| `DATABASE_URL` | yes | — | Postgres connection string |
| `DEVDIGEST_MCP_EMIT_TEXT` | no | `false` | When `"true"`, also serialises `structuredContent` into a duplicate `text` content block. Enables clients that cannot read `structuredContent`. Approximately doubles token usage. |

LLM keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) and
`GITHUB_TOKEN` go in `~/.devdigest/secrets.json`, not in env — they are read
by `LocalSecretsProvider`.

## Notes and limitations

- **stdio only.** HTTP/SSE transport is not supported.
- **Single workspace.** The server resolves the default seeded workspace on
  every call. Multi-workspace auth is out of scope.
- **`devdigest_review_pr` blocks.** If the timeout fires, the review keeps
  running in the MCP process. Disconnect (stdin EOF) abandons any in-flight
  run; the API will mark it failed on its next boot.
- **No importing.** The MCP tools do not import repos, PRs, or run the
  conventions extractor. Use the DevDigest web UI for those operations.
- **`devdigest_get_blast_radius` is callers-only and single-hop.** It surfaces the
  cross-file callers of changed symbols (plus reachable endpoints/crons); it does
  not compute callees or traverse multiple hops, because the `repo-intel` index
  stores no callee/depth data.
- **No `reapStaleRuns`.** Unlike the API, the MCP bootstrap deliberately does
  not call `reapStaleRunningRuns` — doing so would clobber in-flight reviews
  owned by a concurrently-running API process.

## Testing

Run from inside `mcp/`:

```sh
# Hermetic unit tests — no Docker required
node_modules/.bin/vitest run

# DB-backed integration tests — requires Docker
TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run .it.test
```

Prefer the `node_modules/.bin/vitest` binary directly over `pnpm test` when
running offline, for the same reason as above.

Type-check without emitting:

```sh
node_modules/.bin/tsc --noEmit
```
