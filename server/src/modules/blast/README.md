# blast — Blast Radius Module

The `blast` module answers: **"what could break from these PR changes?"** by
surfacing the cross-file callers, HTTP endpoints, and cron jobs reachable from
each changed symbol — all read from the pre-built `repo-intel` index.

## API surface

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/pulls/:id/blast` | Shaped blast-radius payload grouped by changed symbol |
| `GET` | `/pulls/:id/blast/summary` | Optional one-paragraph LLM explanation of impact |

### `GET /pulls/:id/blast`

Returns a `BlastResponse` (see `types.ts`):

```ts
{
  symbols: BlastSymbolGroup[];   // one entry per changed symbol
  totals: { symbols; callers; endpoints; crons };
  impactedEndpoints: string[];   // flat union across all symbols
  impactedCrons: string[];
  index: {
    status: 'full' | 'partial' | 'degraded' | 'failed';
    degraded: boolean;
    reason?: DegradedReason;
    lastIndexedSha: string | null;
  };
  degraded: boolean;             // true when facade ran in ripgrep mode
  reason?: DegradedReason;
}
```

Each `BlastSymbolGroup` carries:
- `callers[]` — cross-file callers of this symbol, sorted rank-desc, capped at 20
- `endpoints[]` / `crons[]` — HTTP endpoints and cron jobs reachable from those caller files

**Core path guarantee: zero AI calls.** The handler delegates to `BlastService`, which:
1. Reads the PR's changed files from persisted `pr_files` (pure Postgres read).
2. Calls `repoIntel.getBlastRadius(repoId, changedFiles)` — reads only through
   the `repo-intel` facade (no clone parsing, no indexing at request time).
3. Calls `repoIntel.getIndexState(repoId)` for the `index` block.
4. Re-shapes the flat `BlastResult` into a per-symbol grouped UI payload.

No new DB tables, no new indexing, no model calls on this path.

### `GET /pulls/:id/blast/summary`

Returns a `BlastSummaryResponse`:

```ts
{
  summary: string | null;
  cached: boolean;
  skipped?: 'no_key' | 'no_data';
}
```

Makes **at most one** LLM call per `(prId, lastIndexedSha)` pair; subsequent
requests return `{ cached: true }` from an in-process `Map`. When no LLM key is
configured, returns `{ summary: null, cached: false, skipped: 'no_key' }` — never
an error. The model is resolved via `resolveCheapLlm` (first configured of
openai/anthropic/openrouter + cheap model), so provider + model come from
`~/.devdigest/secrets.json` only.

> **Tradeoff**: the in-memory cache is lost on server restart and is not shared
> with the MCP process. Acceptable for a local-first single-user app; a future
> migration-backed table would persist it across restarts.

## Architecture

```
GET /pulls/:id/blast
  → BlastService.getBlast(workspaceId, prId)
      → db: read pr_files for this PR
      → repoIntel.getBlastRadius(repoId, changedFiles)   ← facade read
      → repoIntel.getIndexState(repoId)                   ← facade read
      → shape BlastResult into BlastResponse (pure transform)

GET /pulls/:id/blast/summary
  → BlastSummaryService.getSummary(workspaceId, prId)
      → BlastService.getBlast(...)                        ← reuses above
      → check summaryCache Map
      → resolveCheapLlm(container) → LLMProvider.complete(prompt)
      → store in summaryCache; return BlastSummaryResponse
```

The module reads **only inward** (through the `repoIntel` facade and `db`).
It does not write to any table and does not call the clone/git/ast-grep adapters
directly — those are internal concerns of `repo-intel`.

## Client panel placement

The `BlastRadius` panel renders in the **existing Overview tab** next to
`IntentCard` and `RisksCard` (not a separate tab). It is fed by:

- `useBlastRadius(prId)` — TanStack Query hook, always fires on panel mount
- `useBlastSummary(prId, { enabled })` — gated; only fires when the user clicks
  "Explain impact" to avoid an uninvited LLM call

## Indexed-SHA blob-link rationale

Caller file links point to
`github.com/{owner}/{repo}/blob/{indexedSha}/{path}#L{line}`.

The **indexed SHA** (not the PR head SHA) is used because:
- Caller files live **outside** the PR diff.
- Their line numbers come from the `repo-intel` index snapshot.
- Only the commit that was indexed makes `#L{line}` accurate.
- `githubPrFileUrl` (the "Files changed" view) is deliberately NOT used because
  it only contains files touched by the PR — caller files won't appear there.
