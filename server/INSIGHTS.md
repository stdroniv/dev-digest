# server — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module (`@devdigest/api`,
includes `repo-intel`). Managed by the `engineering-insights` skill. Add each entry
under one section; keep it actionable cold; never edit or delete existing entries.

## What Works

## What Doesn't Work

## Codebase Patterns

- Vendored shared contracts are **edited directly per-package**, not generated. `server/src/vendor/shared/contracts/*.ts` and `client/src/vendor/shared/contracts/*.ts` are NOT byte-identical (comments/imports differ) and there is no upstream `shared/` dir or re-vendor script despite CLAUDE.md saying "edit upstream, then re-vendor". When adding a field (e.g. `cost_usd` on `RunStats`/`RunSummary`/`PrMeta`), edit each package's copy by hand and keep the field sets in sync. Precedent: commit `d45ab0d` did exactly this. reviewer-core has no vendored copy — it imports the types via the `@devdigest/shared` alias.
- `GET /repos/:id/pulls` (`server/src/modules/pulls/routes.ts`) only syncs PRs from GitHub when `container.github()` resolves; with no token configured it throws and the route silently serves persisted PRs. In integration tests that DON'T pass a `github` override (e.g. `reviews.it.test.ts`'s `appWith`), the list returns exactly the DB-inserted PRs — safe for asserting computed columns (score, `cost_usd` aggregate) without GitHub-import noise.

## Tool & Library Notes

- Run package tests via the local binary `./node_modules/.bin/vitest run ...`, NOT `pnpm test` / `pnpm exec vitest`. The pnpm wrappers run a deps-status precheck that fires `pnpm install`, which fails offline/sandboxed ("Run pnpm approve-builds") and never reaches the tests. (`client` happens to pass because its deps are current; `server`/`reviewer-core` fail this way.)
- `.it.test.ts` testcontainers Postgres fails to boot with `Error: Log stream ended and message "/.*Started.*/" was not received` unless run with `TESTCONTAINERS_RYUK_DISABLED=true` (the Ryuk reaper container can't start under the sandbox). The pg image (`pgvector/pgvector:pg16`) is already pulled locally — the failure is Ryuk, not a missing image. These suites also need the Bash sandbox disabled to reach the Docker socket.

## Recurring Errors & Fixes

## Session Notes

## Open Questions
