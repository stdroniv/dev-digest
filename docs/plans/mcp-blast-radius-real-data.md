# Plan — Wire `devdigest_get_blast_radius` to real data

**Status:** ready to implement
**Scope size:** Medium — **MCP-package-only**. No server, client, DB, or
reviewer-core changes. The whole feature already exists server-side; this plan
replaces the MCP stub with a thin adapter over it and **redesigns the wire
contract** to match what the feature actually produces.

---

## 1. Problem

`mcp/src/tools/get-blast-radius.ts` is a stub: it validates the PR resolves, then
always returns `status: "not_implemented"` with `impacted: []`. The contract was
authored **speculatively** before the blast-radius feature shipped, so it promises
capabilities the real engine does not have.

The real feature is fully built and shipped to the web UI:

```
BlastService.getBlast(workspaceId, prId)            server/src/modules/blast/service.ts
  → container.repoIntel.getBlastRadius(repoId, files)   (Postgres index read, 0 AI)
  → container.repoIntel.getIndexState(repoId)
  → shapeBlastResponse(...) : BlastResponse
```

`container.repoIntel` is already exposed on the same `Container` the MCP bootstrap
builds (`server/src/platform/container.ts:114`), and `BlastService` depends on
nothing Fastify-specific — it takes `(container)` and `(workspaceId, prId)`. So the
MCP process can call it directly. **No server changes are required.**

### The contract mismatch (the real work)

| Stub contract (speculative) | Real feature (`BlastResponse`) |
|---|---|
| input `direction: callers\|callees\|both` | engine computes **callers only** — no callee traversal exists anywhere |
| input `max_depth: 1–5` | engine returns **direct, single-hop** callers — no multi-level BFS |
| output `impacted[].relation: 'caller'\|'callee'` | callers carry no relation; all are callers |
| output `impacted[].depth` | no depth concept; effectively always 1 |
| flat `impacted[]` | **grouped by changed symbol**, plus `endpoints`, `crons`, `index`, `degraded`, `resolution` |

`direction: callees/both`, `max_depth`, `relation: 'callee'`, and `depth` **cannot
be honestly satisfied** — the underlying `repo-intel` index stores no callee/depth
data. Shipping them as no-op parameters would contradict this module's own
"honest signal" ethos (the index-incomplete badge, the Tier-4 resolution signal).

**Decision (confirmed with the user): honest redesign.** Drop the unsatisfiable
inputs/fields; reshape the MCP output to mirror the real `BlastResponse`. Since the
tool currently returns `not_implemented` and `mcp/CLAUDE.md` explicitly says "don't
wire UI/clients to expect real output yet," there are **no real consumers** of the
old shape to break.

### Rejected alternatives

- **Minimal map into the existing schema** (caller→`{relation:'caller', depth:1}`,
  ignore `direction`/`max_depth`): smallest diff, but ships dead parameters and
  drops the richest signals (endpoints/crons/index/degraded). Dishonest.
- **Extend `repo-intel` to compute callees + multi-hop depth**: faithful to the old
  schema but a large change to the facade contract, repository queries, the
  persistent path, and the indexer. Out of scope; not what the feature is.

---

## 2. New contract

### Input (`getBlastRadiusInput`)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `pr` | string | required | `owner/repo#number` |
| `symbol` | string | — | Restrict to one **changed** symbol by exact name; omit for all |

`direction` and `max_depth` are **removed**.

### Output (`getBlastRadiusOutput`) — mirrors `BlastResponse`, snake_cased

```jsonc
{
  "pr": "acme/payments-api#482",
  "symbol": null,                       // echo of the input filter, or null
  "symbols": [
    {
      "file": "src/payments.ts",
      "name": "processPayment",
      "kind": "function",
      "callers": [                       // rank-desc, capped at 20 (server-side)
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
    "status": "full",                    // full | partial | degraded | failed
    "degraded": false,
    "reason": null,                      // DegradedReason string, or null
    "last_indexed_sha": "def789abc"      // null if never indexed
  },
  "degraded": false,                     // facade ran in ripgrep mode
  "reason": null,
  "resolution": { "limited": false, "reason": null }
}
```

Field name mapping (camelCase → wire snake_case): `impactedEndpoints` →
`impacted_endpoints`, `impactedCrons` → `impacted_crons`, `index.lastIndexedSha` →
`index.last_indexed_sha`. All `undefined` optionals (`reason`, `resolution.reason`)
are normalized to `null` so the SDK validates `structuredContent` cleanly.

The `status: 'ok'|'not_implemented'` envelope field is **dropped** — domain
failures already flow through `isError` results (`runTool`), so a success envelope
is redundant.

---

## 3. Implementation steps

### Step 1 — Expose `BlastService` from the MCP bootstrap
**`mcp/src/bootstrap.ts`**
- Import: `import { BlastService } from '@devdigest/api/modules/blast/service.js';`
- Add `blast: BlastService;` to `interface Services`.
- Construct it alongside the others: `blast: new BlastService(container),`.

This keeps the CLAUDE.md convention intact ("tools call a server application
service; zero business logic in MCP"). `BlastService` is a cheap, stateless holder
of `container`, so constructing it once at bootstrap (like the other services) is
fine.

### Step 2 — Redesign the schemas
**`mcp/src/schemas.ts`** (replace the `get_blast_radius` block, lines ~209–246)
- New `getBlastRadiusInput` = `{ pr, symbol? }` (drop `direction`, `max_depth`).
- New output Zod objects:
  - `BlastCallerOut = z.object({ file, symbol, line: int, rank: number })`
  - `BlastSymbolGroupOut = z.object({ file, name, kind, callers: BlastCallerOut[], endpoints: string[], crons: string[] })`
  - `BlastIndexOut = z.object({ status: z.enum(['full','partial','degraded','failed']), degraded: bool, reason: string|null, last_indexed_sha: string|null })`
  - `getBlastRadiusOutput = { pr: string, symbol: string|null, symbols: BlastSymbolGroupOut[], totals: {symbols,callers,endpoints,crons: int}, impacted_endpoints: string[], impacted_crons: string[], index: BlastIndexOut, degraded: bool, reason: string|null, resolution: z.object({ limited: bool, reason: string|null }) }`
- Mirror the index `status` enum locally (`z.enum([...])`) with a comment that it
  tracks `repo-intel`'s `IndexStatus`; keep `reason` as `string|null` rather than
  coupling to the server's `DegradedReason` union.
- Remove the now-unused `ImpactedOut`.

### Step 3 — Add a pure mapping helper
**`mcp/src/format.ts`** (new exported function, mirrors `projectFinding`)
- `projectBlast(prRef: string, response: BlastResponse, symbolFilter?: string): BlastRadiusOut`
- Behavior:
  - **No filter:** pass `response.totals`, `response.impactedEndpoints`,
    `response.impactedCrons` through **verbatim** (these are the server's own
    faithful counts — `totals.callers` is the pre-cap facade count, not the sum of
    capped groups). Map every symbol group + normalize `undefined`→`null`.
  - **Filter set:** keep only groups whose `name === symbolFilter` (exact,
    case-sensitive — symbol identity is case-sensitive in code). Recompute
    `totals` and `impacted_endpoints`/`impacted_crons` as the union over the
    filtered groups so the numbers stay internally consistent. A filter that
    matches nothing yields `symbols: []` + zeroed totals — **graceful, not an
    error** ("no such changed symbol / no callers" is a valid answer). `index`,
    `degraded`, `resolution` always reflect the real index state regardless.
- Import the `BlastResponse` type from `@devdigest/api/modules/blast/types.js`.

### Step 4 — Rewrite the tool
**`mcp/src/tools/get-blast-radius.ts`**
- Rewrite `DESCRIPTION`: describe the real behavior and state the honest limits —
  "cross-file **callers** of changed symbols (single-hop), plus the HTTP endpoints
  and cron jobs reachable from those caller files. Read-only, zero AI."
- Drop `NOT_IMPLEMENTED_MESSAGE` and the stub return.
- Update `config.title` (remove "(not yet implemented)").
- Handler:
  1. `const input = GetBlastRadiusInput.parse(rawArgs)`
  2. `const workspaceId = await getWorkspaceId(deps.container)`
  3. `const ref = parsePrRef(input.pr); const prRef = \`${ref.fullName}#${ref.number}\``
  4. `const { pull } = await resolvePull(deps, workspaceId, ref)` (keeps the
     actionable "PR not found" `McpToolError`; also means `BlastService`'s own
     `NotFoundError` is never reached)
  5. `const response = await deps.services.blast.getBlast(workspaceId, pull.id)`
  6. `return okResult(projectBlast(prRef, response, input.symbol))`
- Keep the `annotations` block (read-only/idempotent) unchanged.

### Step 5 — Tests
- **`mcp/test/schemas.test.ts`**: replace the `get_blast_radius applies defaults`
  case (asserts `direction`/`max_depth`) with one asserting `{ pr }` parses and
  `symbol` is optional. Keep `get_blast_radius` in the input/output map asserts.
- **`mcp/test/format.test.ts`** (hermetic, no DB): add a `projectBlast` describe
  block — feed a hand-built `BlastResponse` fixture and assert: snake_case
  mapping, `undefined`→`null` normalization, verbatim totals when unfiltered,
  recomputed totals + filtered groups when `symbolFilter` is set, and empty result
  for a non-matching filter.
- **`mcp/test/get-blast-radius.it.test.ts`** (rewrite): follow the server's
  `blast-routes.it.test.ts` pattern — build a mock `RepoIntel` returning a
  deterministic `BlastResult` + `IndexState`, inject via
  `buildDeps(pg.handle.db, { repoIntel: mockRepoIntel })` (the harness already
  forwards `ContainerOverrides`). Seed gives `acme/payments-api#482`; the mock
  ignores `changedFiles`, so no `pr_files` setup is needed. Assert:
  - valid PR → `isError` undefined; grouped `symbols`, `callers` rank-desc,
    `endpoints` attributed, `totals`, `impacted_endpoints`, `index.status`,
    `index.last_indexed_sha` present.
  - `symbol` filter narrows `symbols` and recomputes totals.
  - missing PR (`#999999`) → `isError: true`, message matches `/not found/i`
    (unchanged).

### Step 6 — Docs & insights
- **`mcp/CLAUDE.md`**: replace the "`devdigest_get_blast_radius` is a stub" bullet
  (lines 54–55) with a one-liner describing real behavior + the callers-only /
  single-hop / no-callee-no-depth limitation.
- **`mcp/README.md`**: rewrite the `devdigest_get_blast_radius` section
  (lines 268–294) with the new input table (`pr`, `symbol`) and a real output
  example; remove the stub bullet at line 317–318 from "Notes and limitations" and
  replace with the callers-only limitation note.
- **`mcp/INSIGHTS.md`**: append (via the `engineering-insights` skill) the lesson —
  *a speculatively-frozen MCP contract (`direction`/`max_depth`/`callees`) had to be
  redesigned because the shipped `repo-intel` feature is callers-only/single-hop;
  prefer deriving MCP contracts from the real service shape, not ahead of it.*

---

## 4. Verification

From inside `mcp/` (offline — use the `node_modules/.bin` binaries, not `pnpm`):

```sh
node_modules/.bin/tsc --noEmit                                   # types
node_modules/.bin/vitest run --exclude '**/*.it.test.ts'         # hermetic: schemas + format
TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run .it.test   # DB-backed (Docker)
```

Manual smoke (optional): run the stdio server against a DB with an indexed repo and
call the tool via MCP Inspector for a PR whose repo has a `full`/`partial` index.

---

## 5. Risks & notes

- **No callees / no depth — by design.** If a consumer genuinely needs callee or
  multi-hop traversal, that is a separate, larger `repo-intel` work item (new facade
  method + repository queries + indexer support), explicitly out of scope here.
- **Degraded / un-indexed repos return honestly**, not as errors: an un-indexed repo
  yields `degraded: true`, empty `symbols`, and an `index` block stating the status.
  The tool surfaces these so the model can explain *why* the radius is empty.
- **Token weight:** the grouped payload is larger than the stub. Per-symbol callers
  are already capped at 20 server-side; no extra MCP-side cap is added. If payloads
  prove heavy in practice, a follow-up could add a `response_format: concise|detailed`
  toggle (concise = drop `callers[]`, keep counts) — not needed for v1.
- **`getBlast` makes zero AI calls** (the summary endpoint is the only LLM path and
  is intentionally NOT exposed by this tool).
