# Plan: DevDigest MCP Server (stdio, 5 tools)

## Understanding
Add a new standalone `mcp/` package (`@devdigest/mcp`) that exposes DevDigest's
existing application services to MCP clients over **stdio only**, with exactly
**5 tools**. The MCP server is a thin presentation/adapter layer (mirrors a
Fastify route): it parses tool args, resolves human-readable identifiers
(agent name, `owner/repo#number`) to internal UUIDs, calls the existing server
services in-process (no HTTP), and maps domain DTOs to structured MCP results.
It contains no business logic. `review_pr` must BLOCK until the (currently
fire-and-forget) review completes, with a configurable timeout fallback.
`get_blast_radius` is a contract-only stub.

## Context loaded
- Root `CLAUDE.md` (auto), root `INSIGHTS.md`, `server/CLAUDE.md`,
  `server/INSIGHTS.md`, `reviewer-core/CLAUDE.md`, `TESTING.md`.
- Skill: `.claude/skills/backend-onion-architecture/SKILL.md` (layering: MCP =
  presentation, reuse application services, inward-only deps). Skimmed
  `client-server-communication` / `zod` conceptually (wire contracts + Zod→JSON
  Schema); not deeply needed beyond what `backend-onion-architecture` covers.
- Services/flow: `server/src/modules/reviews/service.ts` (`runReview` :103 is
  fire-and-forget; `reviewsForPull` :160; `resolveTargets` :46; `listRuns` :70),
  `server/src/modules/reviews/run-executor.ts` (`executeRuns` is an awaitable
  Promise; on completion it calls `runBus.complete(runId)` per run — incl. the
  `failAll` path), `server/src/modules/agents/service.ts` (`list` :58),
  `server/src/modules/conventions/service.ts` + `repository.ts` (`listAccepted`
  :78 = accepted-only).
- Bootstrap/DI: `server/src/app.ts` (`buildApp`; `new Container(config, db)` :67;
  `reapStaleRuns` :81), `server/src/platform/container.ts`,
  `server/src/db/client.ts` (`createDb`), `server/src/platform/config.ts`
  (`loadConfig`), `server/src/platform/sse.ts` (`runBus` singleton + `onDone`).
- Auth/context: `server/src/adapters/auth/local.ts` (`LocalNoAuthProvider`
  ignores the `req` arg) and `server/src/modules/_shared/context.ts` — confirmed
  callable in-process; `AuthProvider.currentWorkspace(req: unknown)`
  (`server/src/vendor/shared/adapters.ts:281-283`).
- Identifier resolution anchors: `server/src/modules/repos/repository.ts:24`
  (`findByFullName`), `server/src/modules/reviews/repository/pull.repo.ts:9`
  (`getPull` by uuid — no by-number helper yet), unique index `pr_repo_number_uq`
  on `(repo_id, number)` (`server/src/db/schema/pulls.ts:31`),
  `server/src/db/schema/repos.ts` (`repos_ws_fullname_uq`).
- Contracts to reuse: `server/src/vendor/shared/contracts/findings.ts`
  (`Severity`, `FindingCategory`, `Finding`, `SeverityCounts`),
  `.../knowledge.ts` (`Agent`, `Provider`, `ReviewStrategy`,
  `ConventionCandidate`), `.../review-api.ts` (`ReviewRunResponse`). DTO mappers:
  `server/src/modules/reviews/helpers.ts` (`reviewToDto`/`findingRowToDto`).
- Tables: `agents.ts`, `reviews.ts` (findings have NO `agent_id` — attribution is
  via `reviews.agent_id`), `knowledge.ts` (`conventions`), `repos.ts`, `pulls.ts`.
- Deliberately skipped: `client/`, `e2e/`, `docs/agent-prompts/`, `repo-intel`
  internals — out of this feature's blast radius.

## Approach & tradeoffs
**Chosen:** a new `mcp/` package that builds the DI `Container` in-process
(`loadConfig` + `createDb` + `new Container`), instantiates the existing
`AgentsService` / `ReviewService` / `ConventionsService`, and wraps them with the
official `@modelcontextprotocol/sdk` `McpServer` + `StdioServerTransport`. Tool
handlers are thin adapters: resolve identifiers → call a service → project the DTO
into a token-lean structured result. Schemas reuse the vendored Zod contracts.

- **In-process vs HTTP (locked decision #1):** in-process wins — no port, no auth
  round-trip, direct access to the `runBus` for awaiting completion, and the
  services already encapsulate all business logic. Cost: `mcp/` must carry the
  same heavy runtime dependency set the `Container` transitively imports (octokit,
  simple-git, ast-grep, tiktoken, openai, anthropic, drizzle, postgres, …) — see
  Package setup. Rejected: calling the REST API over HTTP (re-implements a client,
  needs the API process running, and can't await the async run cleanly).
- **Blocking mechanism (locked decision #2):** subscribe to the in-process
  `runBus.onDone(runId)` for each created run and `Promise.race` against a
  timeout — event-driven, zero new server code, reuses the exact bus the SSE route
  uses. Rejected primary: DB polling of `agent_runs.status` (latency + load);
  rejected: exposing/awaiting the private `ReviewRunExecutor` (needs a server
  refactor). The timeout fallback is mandatory because an unexpected
  `executeRuns` crash logs in `runReview`'s `.catch` without signalling `onDone`.
- **Identifiers (locked decision #4):** reuse `RepoRepository.findByFullName`
  (presentation→infrastructure is a legal inward arrow and mirrors the container
  already exposing `agentsRepo`/`reviewRepo`), `AgentsService.list` + name match,
  and ONE new read `getPullByNumber`. Rejected: raw drizzle queries inside `mcp/`
  tool handlers (data-access leaking into presentation). Tradeoff noted: stricter
  onion would add `ReposService`/`ReviewService` passthroughs instead of touching
  the repository directly; one new repository read is the minimal change.
- **Schemas:** define each tool's input/output as Zod object shapes that are thin
  projections of the vendored contracts; let `McpServer.registerTool` convert to
  JSON Schema (it uses `zod-to-json-schema` internally) and validate
  `structuredContent` against the declared `outputSchema`. Keeps the wire contract
  in sync with the contracts that already drive the API + LLM output.

## Architecture

### Package layout (`mcp/`)
```
mcp/
  package.json            # @devdigest/mcp; own deps + lockfile; bin + scripts
  tsconfig.json           # own paths aliases (mirror server)
  src/
    index.ts              # bin entry: bootstrap → register tools → stdio transport
    bootstrap.ts          # loadConfig + createDb + new Container + services + shutdown
    context.ts            # in-process workspace/user resolution (no FastifyRequest)
    logger.ts             # stderr-only Logger (NEVER stdout)
    resolvers.ts          # owner/repo#number → ids; agent name → id; not-found → McpToolError
    errors.ts             # McpToolError → isError result mapping helpers
    schemas.ts            # Zod input/output shapes (projections of vendored contracts)
    format.ts             # concise|detailed projection + severity rollup + truncation notes
    tools/
      list-agents.ts
      review-pr.ts
      get-findings.ts
      get-conventions.ts
      get-blast-radius.ts
    vendor/shared/        # OWN copy of @devdigest/shared (do NOT edit server's)
  test/
    *.test.ts             # hermetic unit (schema/format/resolver/error mapping)
    *.it.test.ts          # DB-backed (testcontainers) end-to-end tool calls
```
Each tool file exports `{ name, config, handler }`; `index.ts` registers them with
`server.registerTool(name, config, handler)`. No tool imports Drizzle/Fastify or
talks to the DB except through a service or a resolver.

### In-process bootstrap (`bootstrap.ts`)
Mirror `buildApp` minus Fastify (`server/src/app.ts:41-67`):
```
const config = loadConfig();                 // server/src/platform/config.ts
const handle = createDb(config.databaseUrl); // server/src/db/client.ts
const container = new Container(config, handle.db); // platform/container.ts:80
const services = {
  agents: new AgentsService(container),
  reviews: new ReviewService(container),
  conventions: new ConventionsService(container),
};
return { container, services, shutdown: () => handle.close() };
```
- Secrets (LLM keys, `GITHUB_TOKEN`) resolve through the same
  `LocalSecretsProvider` reading `~/.devdigest/secrets.json` — no change.
- **Do NOT call `reapStaleRuns()`** here (unlike `app.ts:81`):
  `reapStaleRunningRuns` marks EVERY `status='running'` row failed
  (`run.repo.ts:131-140`) regardless of owner, so it would clobber an in-flight
  review owned by a concurrently-running API process (the `app.ts` comment notes
  the single-instance assumption). The MCP server's own blocking runs complete
  in-process and need no reaping.
- The `runBus` the MCP `ReviewService` uses is the module singleton
  (`platform/sse.ts:103`; `Container` sets `this.runBus = runBus`), so the same
  object the executor signals (`runBus.complete`) is the one MCP subscribes to.

### Service reuse / layering (onion)
- MCP = **presentation**. Tools call **application services**
  (`AgentsService`/`ReviewService`/`ConventionsService`). The only direct
  infrastructure touches are read-only resolvers (`RepoRepository.findByFullName`,
  the new `getPullByNumber`) — a legal Presentation→Infrastructure inward arrow.
- No business logic in `mcp/`: severity rollups reuse `rollupSeverities` /
  `groupSeverities` (`server/src/modules/pulls/status.ts`); DTO shapes reuse
  `reviewToDto`/`findingRowToDto`. `reviewer-core` stays pure (untouched).

## Tool specifications

All tool names are namespaced `devdigest_*` and match `^[a-zA-Z0-9_.-]{1,128}$`.
Every input field carries a `.describe(...)`; closed domains use enums. Every tool
declares an `outputSchema` and returns `structuredContent`. Descriptions are
written to onboard a new hire (DevDigest jargon spelled out). Shared enums reused
verbatim from contracts: `Severity` = `CRITICAL|WARNING|SUGGESTION`,
`FindingCategory` = `bug|security|perf|style|test`, `Provider` =
`openai|anthropic|openrouter`, `ReviewStrategy` = `single-pass|map-reduce|auto`.

### 1. `devdigest_list_agents`
- **Title:** List PR review agents
- **Description:** "List the AI code-review agents configured in this local
  DevDigest workspace. A DevDigest *agent* is a named reviewer = an LLM provider +
  model + system prompt + linked skills. Returns concise metadata so you can pass
  an agent's `name` to `devdigest_review_pr` or `devdigest_get_findings`.
  Read-only."
- **Input schema:**
  - `enabled_only` — `boolean`, default `false`. "When true, return only agents
    that are currently enabled to run."
- **Output schema:** `{ agents: Array<{ name: string; description: string;
  enabled: boolean; strategy: ReviewStrategy; provider: Provider; model: string
  }>; count: number }`
- **Annotations:** `readOnlyHint:true, idempotentHint:true,
  destructiveHint:false, openWorldHint:false`.
- **Backs onto:** `AgentsService.list(workspaceId)`
  (`server/src/modules/agents/service.ts:58`); filter by `enabled` in the mapper
  when `enabled_only`.
- **Token efficiency:** OMIT `system_prompt`, `output_schema`, `id`, `version`
  (large/low-signal); expose `name` as the stable handle (human-readable id →
  fewer round-trips + less hallucination). Typically <10 agents — no pagination.

### 2. `devdigest_review_pr`
- **Title:** Run a review agent on a pull request
- **Description:** "Run one named review agent — or every enabled agent — against
  an already-imported pull request and BLOCK until the review finishes, returning a
  findings summary. `pr` is `owner/repo#number` (e.g. `acme/payments-api#482`).
  Provide either `agent` (a name from `devdigest_list_agents`) or `all:true`. If
  the review exceeds `timeout_seconds` the tool returns the run ids with a
  still-running status instead of hanging — call `devdigest_get_findings` later to
  collect results. This performs work (LLM + git/GitHub calls) and is not
  idempotent."
- **Input schema:**
  - `pr` — `string`. "Pull request reference `owner/repo#number`."
  - `agent` — `string`, optional. "Exact agent name (case-insensitive) from
    `devdigest_list_agents`. Omit and set `all:true` to run all enabled agents."
  - `all` — `boolean`, default `false`. "Run every enabled agent on the PR."
  - `response_format` — enum `concise|detailed`, default `concise`. "`concise` =
    file:line + severity + title per finding; `detailed` adds rationale +
    suggestion."
  - `timeout_seconds` — `number` int, default `120`, min `10`, max `600`. "Max
    seconds to block before returning a still-running result."
  - Cross-field rule: exactly one of `agent` / `all:true` (else `isError` with a
    fix message).
- **Output schema:** `{ pr: string; completed: boolean; runs: Array<{ run_id:
  string; agent_name: string; status: 'done'|'failed'|'cancelled'|'running';
  error: string|null }>; summary: { critical:number; warning:number;
  suggestion:number; total:number; blockers:number }; findings:
  Array<ConciseOrDetailedFinding>; message: string|null }`. On timeout:
  `completed:false`, `runs[].status:'running'`, `findings:[]`, `message` =
  guidance to call `devdigest_get_findings`.
- **Annotations:** `readOnlyHint:false, idempotentHint:false,
  destructiveHint:false, openWorldHint:true` (LLM/GitHub are external,
  open-world).
- **Backs onto:** resolve targets via `ReviewService.resolveTargets(workspaceId,
  {agentId|all})` (`service.ts:46`) → `ReviewService.runReview(...)`
  (`service.ts:103`) for run ids → block on `runBus.onDone` (see Challenge 1) →
  read findings via `ReviewService.reviewsForPull(workspaceId, prId)`
  (`service.ts:160`), filtered to the returned `run_id`s. Severity rollup via
  `rollupSeverities` (`pulls/status.ts`); `blockers` = critical count (matches
  `run.repo.ts:92`).
- **Token efficiency:** `concise` by default (~⅓ savings — drops
  `rationale`/`suggestion` markdown bodies); cap returned findings (e.g. 50) and
  emit a truncation note ("showing 50 of N; call devdigest_get_findings with
  severity=CRITICAL to narrow"); never inline the run trace or raw model output.

### 3. `devdigest_get_findings`
- **Title:** Get findings for a pull request
- **Description:** "Fetch grounded review findings for an already-reviewed pull
  request, newest review per agent by default. `pr` is `owner/repo#number`. Filter
  server-side by `agent` name, `severity`, `category`, or `file`; results are
  paginated. Use `response_format:detailed` only when you need the rationale and
  suggested fix. Read-only."
- **Input schema:**
  - `pr` — `string`. "`owner/repo#number`."
  - `agent` — `string`, optional. "Restrict to one agent's findings (by name).
    Findings have no agent column — attribution flows through the review's agent."
  - `severity` — enum `CRITICAL|WARNING|SUGGESTION`, optional.
  - `category` — enum `bug|security|perf|style|test`, optional.
  - `file` — `string`, optional. "Restrict to findings whose `file` equals this
    path."
  - `include_dismissed` — `boolean`, default `false`. "Include findings the user
    dismissed."
  - `all_runs` — `boolean`, default `false`. "Include historical reviews; default
    keeps only the newest review per agent so re-runs don't duplicate findings."
  - `response_format` — enum `concise|detailed`, default `concise`.
  - `limit` — `number` int, default `20`, min `1`, max `100`.
  - `cursor` — `string`, optional. "Opaque pagination cursor from a prior
    response."
- **Output schema:** `{ pr: string; findings: Array<ConciseOrDetailedFinding>;
  total_matched: number; returned: number; has_more: boolean; next_cursor:
  string|null; truncated_note: string|null }`.
- **Annotations:** `readOnlyHint:true, idempotentHint:true, destructiveHint:false,
  openWorldHint:false`.
- **Backs onto:** `ReviewService.reviewsForPull(workspaceId, prId)`
  (`service.ts:160`, underlying `review.repo.ts:58`) — returns every review +
  findings for the PR; the agent filter selects reviews where
  `review.agent_id === resolvedAgentId` (the findings→reviews attribution, per
  `server/INSIGHTS.md`). Apply severity/category/file/dismissed filters and the
  newest-per-agent dedupe in `format.ts` before paginating.
- **Token efficiency:** pagination on by default; ALL filters pushed server-side
  (params, not return-then-filter); concise default; newest-per-agent dedupe
  avoids stale duplicates (mirrors the Smart-Diff per-agent dedupe lesson in
  `server/INSIGHTS.md`); cursor = base64 of `{offset}` (stateless). MUST honor the
  `dismissedAt != null` guard (per `server/INSIGHTS.md`: `reviewsForPull` returns
  dismissed findings).

### 4. `devdigest_get_conventions`
- **Title:** Get a repo's accepted conventions
- **Description:** "Return the coding conventions the user has ACCEPTED for a repo
  (status='accepted'). A *convention* is a house rule (e.g. error handling, naming)
  the Conventions Extractor proposed and the user approved. `repo` is `owner/repo`.
  Pending/rejected candidates are never returned. Read-only."
- **Input schema:**
  - `repo` — `string`. "`owner/repo`."
  - `category` — `string`, optional. "Restrict to one convention category."
  - `response_format` — enum `summary|detailed`, default `summary`. "`summary` =
    rule + category + evidence path/lines + confidence; `detailed` adds the
    evidence snippet."
  - `limit` — `number` int, default `20`, min `1`, max `100`.
  - `cursor` — `string`, optional.
- **Output schema:** `{ repo: string; conventions: Array<{ rule: string; category:
  string|null; evidence_path: string|null; evidence_start_line: number|null;
  evidence_end_line: number|null; confidence: number|null; evidence_snippet?:
  string }>; total: number; returned: number; has_more: boolean; next_cursor:
  string|null }`.
- **Annotations:** `readOnlyHint:true, idempotentHint:true, destructiveHint:false,
  openWorldHint:false`.
- **Backs onto:** decision #3 = accepted-only → add a thin
  `ConventionsService.listAccepted(workspaceId, repoId)` passthrough to
  `ConventionsRepository.listAccepted` (`server/src/modules/conventions/repository.ts:78`)
  — do NOT use `ConventionsService.list` (`service.ts:72`), which returns
  pending+accepted. Repo id resolved from `owner/repo`.
- **Token efficiency:** `summary` omits the potentially-large `evidence_snippet`;
  pagination on; consider returning a `resource_link` to the assembled
  `repo-conventions` skill body (via `ConventionsService.buildSkillPreview`,
  `service.ts:142`) for the full text instead of inlining many snippets (flagged as
  a follow-up, not required for v1).

### 5. `devdigest_get_blast_radius` (STUB — contract only)
- **Title:** Get the blast radius of changed symbols (not yet implemented)
- **Description:** "Return the impact/blast radius (callers and callees affected)
  of the symbols changed in a pull request. NOTE: not yet implemented in this
  build — the tool returns a structured `not_implemented` status so clients can
  integrate against the final contract now."
- **Input schema (full, real-looking):**
  - `pr` — `string`. "`owner/repo#number`."
  - `symbol` — `string`, optional. "Restrict to one changed symbol (function/
    class) by name; omit to analyze all changed symbols."
  - `direction` — enum `callers|callees|both`, default `both`. "Traverse who calls
    the symbol, what it calls, or both."
  - `max_depth` — `number` int, default `2`, min `1`, max `5`. "Graph traversal
    depth."
- **Output schema:** `{ status: 'ok'|'not_implemented'; message: string; pr:
  string|null; symbol: string|null; impacted: Array<{ file: string; symbol:
  string; relation: 'caller'|'callee'; depth: number }> }`.
- **Annotations:** `readOnlyHint:true, idempotentHint:true, destructiveHint:false,
  openWorldHint:false`.
- **Behavior:** validate `pr` (resolve to confirm it exists — gives an early
  actionable error), then return `isError:false` with `structuredContent =
  { status:'not_implemented', message:"Blast-radius analysis is not yet available
  in this DevDigest build. The contract is final; use devdigest_get_findings or
  devdigest_review_pr meanwhile.", pr, symbol: symbol ?? null, impacted: [] }`.
- **Backs onto:** nothing (confirmed: "blast radius" appears only in internal
  repo-intel/codeindex export-extraction, not a user feature). A future real impl
  would source from `container.repoIntel` caller/callee graph
  (`run-executor.ts:470` `getCallerSignatures` is the nearest existing capability).
- **Token efficiency:** stub returns a tiny fixed payload; the permanent cost is
  the schema itself — kept minimal but complete.

## Technical challenges & approaches

### Challenge 1 — Blocking on the async review (riskiest)
`ReviewService.runReview` (`service.ts:103-138`) creates `agent_runs` rows
up-front, returns `{ runs:[{run_id,...}], reviews:[] }` immediately, and fires
`executor.executeRuns(...)` with `void ... .catch(...)` (fire-and-forget). The
executor (`run-executor.ts:62-218`) does the slow work and, when finished
(success, per-agent failure, OR the `failAll` diff-load path), calls
`this.container.runBus.complete(runId)` for every run.

**Mechanism (in-process, event-driven):**
1. Call `runReview` → capture `runs[]`.
2. For each `run_id`, register `container.runBus.onDone(run_id, resolve)`
   (`sse.ts:90-100`; it fires immediately for an already-completed run via
   `queueMicrotask`, so there is no subscribe-after-complete race).
3. `await Promise.race([ Promise.all(donePromises), timeout(timeout_seconds) ])`.
4. On all-done: read `ReviewService.reviewsForPull(workspaceId, prId)`, keep
   reviews whose `run_id` is in `runs[]`, build the severity summary + findings.
   Read final per-run status via `ReviewService.listRuns` (`service.ts:70`) so the
   result reflects `done|failed|cancelled`.
5. On timeout: return `completed:false` + the `run_id`s with `status:'running'` +
   a "still running, call devdigest_get_findings later" message. **Do NOT cancel**
   the runs (they keep running in the MCP process); detach the `onDone` listeners
   (their unsubscribe fns) to avoid leaks.

**Why a timeout is mandatory:** if `executeRuns` throws before its completion loop
(an unexpected crash, not the handled `failAll`), `runReview`'s `.catch`
(`service.ts:133-135`) only logs — `onDone` never fires. The timeout is the safety
net. Default 120s, configurable per call, hard-capped at 600s.

### Challenge 2 — In-process bootstrap & lifecycle
- Build `config`/`db`/`container`/services as in Architecture › bootstrap (no
  Fastify, no `app.listen`). Construct services directly (`new
  ReviewService(container)` etc.) — the pattern `server/INSIGHTS.md` documents as
  supported for in-process use.
- **stdout is the JSON-RPC channel.** Pass a stderr-only `Logger`
  (`logger.ts`, satisfying the `Logger` type at `run-executor.ts:28-33`) into
  `runReview`/services so their logs never touch stdout; use `console.error` for
  any diagnostics; the SDK's `StdioServerTransport` owns stdout. No `console.log`
  anywhere in `mcp/`.
- **Graceful shutdown:** on `transport.onclose` (stdin EOF) and on
  `SIGINT`/`SIGTERM`, call `server.close()` then `handle.close()` (closes the
  postgres pool, `db/client.ts:23`). Mirror the guarded double-close in
  `server.ts:12-26`.

### Challenge 3 — Identifier resolution (`resolvers.ts`)
- **workspaceId:** `await container.auth.currentWorkspace(undefined)` —
  `LocalNoAuthProvider` ignores the arg (`adapters/auth/local.ts:28-37`) and
  caches; `AuthProvider.currentWorkspace(req: unknown)` permits `undefined`
  (`vendor/shared/adapters.ts:282-283`). (userId via `currentUser(undefined)` if
  needed.)
- **`owner/repo#number` parse:** regex `^([^/]+)/([^#]+)#(\d+)$` → `{owner, name,
  number}`; malformed → `isError` "Could not parse '<pr>'. Use owner/repo#number,
  e.g. acme/payments-api#482."
- **repo:** `new RepoRepository(container.db).findByFullName(workspaceId,
  ` `${owner}/${name}` `)` (`repos/repository.ts:24`); not found → `isError` "Repo
  '<owner/repo>' is not imported. Add it in the DevDigest web UI first."
- **PR:** NEW read `getPullByNumber(db, workspaceId, repoId, number)` in
  `pull.repo.ts` (select on `pr_repo_number_uq`), exposed as
  `ReviewRepository.getPullByNumber` and used via `container.reviewRepo`; not
  found → `isError` "PR #<n> not found in '<owner/repo>'. Import the PR first."
- **agent (by name):** `AgentsService.list(workspaceId)` (`service.ts:58`),
  case-insensitive match on `name` → the agent's `id`; not found → `isError`
  "Agent '<name>' not found. Call devdigest_list_agents to see available agents."
  (Pass the resolved `id` to `resolveTargets`.)
- Every not-found path returns a **tool execution error** (`isError:true`) with an
  actionable message, never a thrown protocol error (see Challenge 4 / errors).

### Challenge 4 — Schema generation & error mechanics
- **Schemas:** in `schemas.ts`, define each tool's input as a Zod raw shape and
  output as a `z.object`, reusing vendored enums/contracts (`Severity`,
  `FindingCategory`, `Provider`, `ReviewStrategy` from
  `vendor/shared/contracts/findings.ts` + `knowledge.ts`). Pass them to
  `server.registerTool(name, { title, description, inputSchema, outputSchema,
  annotations }, handler)`; the SDK converts Zod→JSON Schema (via
  `zod-to-json-schema`) for the `tools/list` payload AND validates returned
  `structuredContent` against `outputSchema`. Keep the finding output type a thin
  projection of `Finding` so it tracks the contract; if a standalone JSON Schema is
  needed (e.g. a `resource` payload) call `zodToJsonSchema(...)` directly.
- **Two error mechanisms:**
  - *Protocol errors* (JSON-RPC) — unknown tool / schema-invalid args. The SDK
    raises these automatically from the registered schema; let it.
  - *Tool execution errors* — domain failures (PR/agent/repo not found, both/
    neither of agent|all, timeouts surfaced as data not errors) → return
    `{ isError:true, content:[{type:'text', text:<actionable message>}] }`. The
    model self-corrects from `isError` results, not from thrown protocol errors —
    so all resolver/not-found failures use `isError`, never `throw`. Implement via
    an `McpToolError` caught in a per-tool wrapper in `errors.ts`.
- **Response shape & token cost:** return `structuredContent` (conforms to
  `outputSchema`). The spec's backward-compat rule says to ALSO serialize the JSON
  into a `content` text block — but that **doubles tokens**. Since this is an
  internal stdio server whose client we control, gate the duplicate text block
  behind a config flag `DEVDIGEST_MCP_EMIT_TEXT` (default `false` = structured
  only). Document the flag for clients that can't read `structuredContent`.

## Package setup

### `mcp/package.json`
- `"name": "@devdigest/mcp"`, `"private": true`, `"type": "module"`.
- `"bin": { "devdigest-mcp": "./bin/devdigest-mcp.mjs" }` — tiny shim that execs
  `tsx src/index.ts` (the repo consumes TS as source via `tsx`; no JS build step,
  mirroring how `server` runs `tsx src/server.ts`).
- `"scripts"`: `"mcp": "tsx src/index.ts"`, `"typecheck": "tsc --noEmit -p
  tsconfig.json"`, `"test": "vitest run"`.
- **dependencies** (NEW): `@modelcontextprotocol/sdk` (latest stable; provides
  `McpServer` + `StdioServerTransport`; zod-v3 compatible), `zod-to-json-schema`,
  `zod ^3.24.1` (match server). **Plus** the transitive runtime set the
  `Container` + services import — mirror the relevant entries from
  `server/package.json`: `drizzle-orm ^0.38.3`, `postgres ^3.4.5`, `openai
  ^4.77.0`, `@anthropic-ai/sdk ^0.33.1`, `octokit ^4.0.3`, `simple-git ^3.27.0`,
  `@ast-grep/napi 0.43.0`, `@vscode/ripgrep ^1.15.9`, `js-tiktoken ^1.0.21`,
  `dependency-cruiser ^17.4.3`, `graphology ^0.26.0`, `graphology-metrics ^2.4.0`,
  `p-queue ^8.0.1`, `dotenv ^16.4.7`. (Verify against the import graph of
  `platform/container.ts` during step 1; pin to the same versions to avoid two
  resolved copies of drizzle/zod across packages.)
- **devDependencies:** `tsx ^4.19.2`, `typescript ^5.7.2`, `@types/node ^22.10.0`,
  `vitest ^2.1.8`, `testcontainers ^10.16.0`, `@testcontainers/postgresql
  ^10.16.0`.

### `mcp/tsconfig.json`
- Copy `server/tsconfig.json` compiler options verbatim (`strict`,
  `noUncheckedIndexedAccess`, `moduleResolution: Bundler`, `module: ESNext`,
  `target: ES2022`, `verbatimModuleSyntax: false`) so server source consumed by
  `mcp/` type-checks identically.
- `paths`:
  - `@devdigest/shared` → `./src/vendor/shared/index.ts`
  - `@devdigest/shared/*` → `./src/vendor/shared/*`
  - `@devdigest/reviewer-core` → `../reviewer-core/src/index.ts`
  - `@devdigest/reviewer-core/*` → `../reviewer-core/src/*`
  - `@devdigest/api/*` → `../server/src/*` (import server services/repos/platform).
- `include`: `["src/**/*.ts"]` (tsc follows imports into `../server/src` and
  `../reviewer-core/src`). Note: when server source is compiled under this
  tsconfig, its `@devdigest/shared` import resolves to `mcp/`'s vendored copy — so
  that copy MUST be field-for-field compatible with server's (same situation as
  `reviewer-core` aliasing into server's vendor).

### Vendored shared
- Copy `server/src/vendor/shared/**` → `mcp/src/vendor/shared/**` (own copy).
  **Do not edit `server/src/vendor/**`.** Treat the new copy as generated; if a
  contract changes upstream, re-copy.

### Launch (stdio)
- A client spawns the server over stdio. Example client config:
  ```json
  { "command": "tsx",
    "args": ["/abs/path/dev-digest/mcp/src/index.ts"],
    "env": { "DATABASE_URL": "postgres://devdigest:devdigest@localhost:5432/devdigest" } }
  ```
- **Sandbox/local gotcha** (`root INSIGHTS.md`): `pnpm <script>` runs a deps
  precheck that hard-fails offline. To launch/verify without pnpm, exec the local
  binary directly: `node_modules/.bin/tsx src/index.ts`. Document both.
- Prereq: Postgres up + migrated + seeded (`cd server && pnpm db:migrate &&
  pnpm db:seed`) — the MCP server reads the same DB; migrations are NOT applied on
  boot and this feature adds none.

## Testing approach
Per `TESTING.md`: hermetic by default; DB-backed tests use the `*.it.test.ts`
suffix; reach for `server/src/adapters/mocks.ts` instead of real keys/network.

- **Unit (hermetic, `mcp/test/*.test.ts`):**
  - `schemas.test.ts` — every tool input/output is valid Zod and produces JSON
    Schema (call the SDK's converter / `zodToJsonSchema`); enums match the vendored
    contracts.
  - `format.test.ts` — concise vs detailed projection, severity rollup,
    pagination/cursor math, truncation note, `dismissedAt`/newest-per-agent dedupe.
  - `resolvers.test.ts` — `owner/repo#number` parsing happy + malformed; not-found
    → `McpToolError` with the expected actionable text.
  - `errors.test.ts` — `McpToolError` maps to `{isError:true, content:[text]}`;
    the agent|all XOR rule.
- **Integration (`mcp/test/*.it.test.ts`, real Postgres via testcontainers):**
  build the `Container` against a migrated+seeded DB (reuse the harness pattern in
  `server/test/helpers/pg.ts`), inject mock adapters via `ContainerOverrides`
  (`MockLLMProvider` for the review run; no GitHub token so degraded paths apply),
  then call each tool's handler directly:
  - `list-agents.it.test.ts` — seeded agents returned; `enabled_only` filters.
  - `review-pr.it.test.ts` — run a single named agent on the seeded PR #482 with an
    injected `MockLLMProvider` (`structuredBySchema: { Review: REVIEW_FIXTURE }`
    per `server/INSIGHTS.md`); assert `completed:true`, the severity summary, and
    findings; assert the timeout path returns `completed:false` + `running` status.
  - `get-findings.it.test.ts` — agent/severity/file filters + pagination
    (`has_more`/`next_cursor`); `include_dismissed` guard.
  - `get-conventions.it.test.ts` — accepted-only (seed an accepted + a pending
    candidate; assert only the accepted one returns).
  - `get-blast-radius.it.test.ts` — returns `not_implemented`, `isError:false`.
- **Run commands** (`root INSIGHTS.md`): `node_modules/.bin/vitest run` for unit;
  `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run .it.test` for
  integration (avoids the pnpm deps precheck and the Ryuk reaper failure).

## Implementation steps
1. **Scaffold the package** — `mcp/package.json`, `mcp/tsconfig.json`,
   `mcp/bin/devdigest-mcp.mjs`.
   - Change type: add
   - What: deps/scripts/bin per Package setup; tsconfig paths + compiler options
     mirroring `server/tsconfig.json`.
   - Verify: `cd mcp && node_modules/.bin/tsc --noEmit` runs (will error only on
     missing src until later steps); `node bin/devdigest-mcp.mjs --help`-style
     smoke once `index.ts` exists.
2. **Vendor shared contracts** — copy `server/src/vendor/shared/**` →
   `mcp/src/vendor/shared/**`.
   - Change type: add
   - Verify: `import { Finding, Agent, Severity } from '@devdigest/shared'`
     resolves under `mcp/tsconfig.json` (typecheck a scratch import).
3. **Server read helper `getPullByNumber`** — `server/src/modules/reviews/repository/pull.repo.ts`
   (+ expose on `ReviewRepository`, `server/src/modules/reviews/repository.ts`).
   - Change type: modify (additive read; no schema change)
   - What: `getPullByNumber(db, workspaceId, repoId, number)` selecting on
     `pr_repo_number_uq`; `ReviewRepository.getPullByNumber(...)` passthrough.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit`; a server it-test
     asserts it returns the seeded PR #482 and `undefined` for a missing number.
4. **Server `ConventionsService.listAccepted`** — `server/src/modules/conventions/service.ts`.
   - Change type: modify (thin passthrough to `repository.listAccepted` :78)
   - Verify: `cd server && node_modules/.bin/tsc --noEmit`; returns only
     accepted rows in a unit/it-test.
5. **`logger.ts`** — stderr-only `Logger`.
   - Change type: add
   - What: object with `info/warn/error/debug` writing via `console.error`
     (matches `run-executor.ts:28-33`).
   - Verify: unit test asserts nothing is written to stdout.
6. **`bootstrap.ts`** — `loadConfig` + `createDb` + `new Container` + services +
   `shutdown`. Does NOT call `reapStaleRuns`.
   - Change type: add
   - Verify: an it-test boots it against the testcontainer DB and resolves
     `services.agents.list(workspaceId)` non-empty on seeded data.
7. **`context.ts`** — `getWorkspaceId(container)` via
   `container.auth.currentWorkspace(undefined)` (cached).
   - Change type: add
   - Verify: it-test returns the seeded default workspace id.
8. **`errors.ts` + `resolvers.ts`** — `McpToolError`, isError mapping, and
   resolvers (PR ref parse, repo, PR, agent name → id).
   - Change type: add
   - Verify: unit tests in `resolvers.test.ts` / `errors.test.ts` (step Testing).
9. **`schemas.ts` + `format.ts`** — Zod input/output shapes (projections of
   vendored contracts) and the concise/detailed + rollup + pagination helpers.
   - Change type: add
   - Verify: `schemas.test.ts` + `format.test.ts` green.
10. **Tool: `tools/list-agents.ts`** — `AgentsService.list` → concise mapper.
    - Change type: add
    - Verify: `list-agents.it.test.ts`.
11. **Tool: `tools/review-pr.ts`** — resolve → `resolveTargets` → `runReview` →
    `runBus.onDone` race(timeout) → `reviewsForPull` + `listRuns` → summary.
    - Change type: add
    - Verify: `review-pr.it.test.ts` (completed + timeout paths).
12. **Tool: `tools/get-findings.ts`** — `reviewsForPull` + server-side filters +
    pagination.
    - Change type: add
    - Verify: `get-findings.it.test.ts`.
13. **Tool: `tools/get-conventions.ts`** — resolve repo → `listAccepted` →
    summary/detailed + pagination.
    - Change type: add
    - Verify: `get-conventions.it.test.ts`.
14. **Tool: `tools/get-blast-radius.ts`** — validate `pr`, return
    `not_implemented` structured result.
    - Change type: add
    - Verify: `get-blast-radius.it.test.ts`.
15. **`index.ts`** — bootstrap, `new McpServer(...)`, register the 5 tools (each
    wrapped by the `errors.ts` isError adapter), connect `StdioServerTransport`,
    wire shutdown (`transport.onclose` + SIGINT/SIGTERM).
    - Change type: add
    - What: ensure ONLY the transport writes stdout; everything else → stderr.
    - Verify: launch + handshake (Acceptance criteria).
16. **Docs touch (optional, in-scope)** — add a one-line entry to root layout/docs
    referencing the `mcp/` package if a package index exists.
    - Change type: modify (only if such an index file exists; otherwise skip)
    - Verify: link resolves.

## Acceptance criteria
Prereq: `cd server && pnpm db:migrate && pnpm db:seed`; Postgres running.

1. **Boot + handshake (stdio):** launch `node_modules/.bin/tsx src/index.ts` and
   send an MCP `initialize` + `tools/list` over stdio (e.g. with the SDK client or
   the MCP Inspector). Expected: handshake succeeds and `tools/list` returns
   exactly 5 tools named `devdigest_list_agents`, `devdigest_review_pr`,
   `devdigest_get_findings`, `devdigest_get_conventions`,
   `devdigest_get_blast_radius`, each with a non-empty `inputSchema`,
   `outputSchema`, and annotations. **No non-JSON bytes appear on stdout.**
2. **list-agents:** call `devdigest_list_agents` → `structuredContent.agents`
   includes the seeded reviewer agents with `name/provider/model` and NO
   `system_prompt`.
3. **review-pr (blocking):** with a `MockLLMProvider` configured (or a real key),
   call `devdigest_review_pr { pr:"acme/payments-api#482", agent:"<seeded agent>",
   timeout_seconds:120 }` → `completed:true`, a `summary` with severity counts,
   and a non-empty `findings` array; a second call with `timeout_seconds:10`
   against a slow/mock-delayed run returns `completed:false` with
   `runs[].status:"running"` and a "call devdigest_get_findings" message (no hang).
4. **get-findings:** `devdigest_get_findings { pr:"acme/payments-api#482",
   severity:"CRITICAL", limit:5 }` → only CRITICAL findings, `returned<=5`, correct
   `has_more`/`next_cursor`; a follow-up with the cursor returns the next page.
5. **get-conventions:** `devdigest_get_conventions { repo:"acme/payments-api" }` →
   only `status='accepted'` conventions (seed/insert one accepted + one pending and
   confirm the pending one is absent).
6. **get-blast-radius:** `devdigest_get_blast_radius { pr:"acme/payments-api#482" }`
   → `isError:false`, `structuredContent.status:"not_implemented"`.
7. **Errors:** `devdigest_review_pr { pr:"acme/nope#999" }` → `isError:true` with
   an actionable not-found message (not a protocol throw).
8. **Suites green:** `cd mcp && node_modules/.bin/vitest run` (unit) and
   `TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run .it.test`
   (integration) both pass; `node_modules/.bin/tsc --noEmit` clean in both `mcp`
   and `server`.

## Risks / out of scope / open questions
- **Risks:**
  - *Run reaping clobber* — never call `reapStaleRuns` from `mcp/`; it would fail a
    concurrently-running API process's in-flight runs (`run.repo.ts:131-140`). If
    the MCP client disconnects mid-run (stdin EOF), the in-process run is abandoned
    and a later API boot will reap it as failed — acceptable, but documented.
  - *Dependency duplication / drift* — `mcp/` mirrors much of `server`'s heavy dep
    set and keeps its own vendored `shared` copy; version skew (esp. `drizzle-orm`,
    `zod`) could yield two resolved copies and subtle type/`instanceof` issues
    (cf. the app's ZodError shape check at `app.ts:138-142`). Pin to server's
    versions; keep the vendored copy byte-aligned with server's.
  - *`onDone` reliance* — depends on `executeRuns` always reaching its
    `complete()` calls; the timeout fallback covers the crash path, but a run that
    silently never completes will only surface via timeout. Keep timeout default
    conservative.
  - *stdout corruption* — any stray `console.log` (or a dependency that logs to
    stdout) breaks the JSON-RPC channel. Mitigation: stderr-only logger, an
    `index.ts` guard, and an acceptance test asserting clean stdout.
- **Out of scope:** HTTP/SSE transport (stdio only); auth/multi-workspace (single
  default workspace); write tools beyond `review_pr` (no accept/dismiss, no repo/PR
  import); a real blast-radius implementation; streaming partial review progress to
  the client; publishing `@devdigest/mcp` as an npm package.
- **Open questions / assumptions:**
  - Assumes the repo + PR are already imported and (for conventions) extracted via
    the web UI — the MCP tools read existing DB state and do not import from
    GitHub; not-found returns an actionable `isError`.
  - Assumes one new server read (`getPullByNumber`) + one thin service passthrough
    (`ConventionsService.listAccepted`) are acceptable; if a strict zero-server-edit
    constraint is imposed, fall back to constructing the repositories inside `mcp/`
    with a local drizzle query (less clean — flagged).
  - Assumes the installed `@modelcontextprotocol/sdk` version targets spec rev
    2025-06-18 and accepts Zod-v3 shapes in `registerTool` with `outputSchema` +
    `structuredContent` support; if the pinned SDK differs, adapt the registration
    call (the tool contracts themselves are unchanged).
  - Assumes `MockLLMProvider` is importable from `server/src/adapters/mocks.ts`
    into `mcp/` tests via the `@devdigest/api/*` alias (it is plain TS).
