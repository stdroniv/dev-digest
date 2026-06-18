# server — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module (`@devdigest/api`,
includes `repo-intel`). Managed by the `engineering-insights` skill. Add each entry
under one section; keep it actionable cold; never edit or delete existing entries.

## What Works

## What Doesn't Work

- The demo seed (`server/src/db/seed.ts`) creates PR #482's sample review DECOUPLED from the timeline run: it inserts the `review` (+ findings) with NO `run_id` and NO `agent_id`, then later inserts the `agent_runs` row separately (only `findings_count`/`blockers` are denormalized onto it). So any feature that attributes a run's data via `reviews.run_id` (e.g. per-run `findings_counts` in `run.repo.ts` `listRunsForPull`, which joins `findings → reviews ON reviews.run_id = agent_run.id`) gets NOTHING for seeded runs → null → the UI shows the em-dash fallback. Real runs are fine (`run-executor` sets `review.runId`); only the seed is unrealistic. Fix: after creating the seeded run, `db.update(t.reviews).set({ runId, agentId })` for that PR's review — place it OUTSIDE the `!existingRun` guard so re-running `pnpm db:seed` repairs an already-seeded DB (idempotent). Linking `agent_id` also fixes the Review-runs row showing a generic "Agent" instead of the agent name.
- Adding a new contract field as `.nullable()` (REQUIRED, value-or-null) instead of `.nullish()` (optional) silently breaks existing tests that build the object literally. Concretely: making `RunSummary.findings_counts` `.nullable()` failed `contracts.test.ts`'s `RunSummary.parse({...})` fixture and the client `run()`/`pr()` test builders with a Zod "Required" error, because those omit the new key. Fix: either use `.nullish()`, or update every literal fixture/builder to include the field. (`PrMeta` used `.nullish()` and needed no fixture change.)

## Codebase Patterns

- Vendored shared contracts are **edited directly per-package**, not generated. `server/src/vendor/shared/contracts/*.ts` and `client/src/vendor/shared/contracts/*.ts` are NOT byte-identical (comments/imports differ) and there is no upstream `shared/` dir or re-vendor script despite CLAUDE.md saying "edit upstream, then re-vendor". When adding a field (e.g. `cost_usd` on `RunStats`/`RunSummary`/`PrMeta`), edit each package's copy by hand and keep the field sets in sync. Precedent: commit `d45ab0d` did exactly this. reviewer-core has no vendored copy — it imports the types via the `@devdigest/shared` alias.
- `GET /repos/:id/pulls` (`server/src/modules/pulls/routes.ts`) only syncs PRs from GitHub when `container.github()` resolves; with no token configured it throws and the route silently serves persisted PRs. In integration tests that DON'T pass a `github` override (e.g. `reviews.it.test.ts`'s `appWith`), the list returns exactly the DB-inserted PRs — safe for asserting computed columns (score, `cost_usd` aggregate) without GitHub-import noise.
- Per-severity findings counters (PR list FINDINGS column + Agent-runs rows) are computed ON READ, not denormalized onto `agent_runs`. Reuse `rollupSeverities` / `groupSeverities` from `server/src/modules/pulls/status.ts` (pure, unit-tested). PR list: in `pulls/routes.ts`, alongside the latest-review-per-PR score loop, also collect the latest review id PER `(prId, agentId)` and tally their findings → aggregates across reviewer agents (matches the multi-agent detail view); SCORE stays single-latest-review. Runs: in `reviews/repository/run.repo.ts` `listRunsForPull`, join `findings → reviews` on `reviews.run_id IN (runIds)`. Mirrors the existing latest-review-score read pattern and needs NO migration. Counts INCLUDE dismissed findings (kept consistent with the run's `findings_count`/`blockers`).

## Tool & Library Notes

- Run package tests via the local binary `./node_modules/.bin/vitest run ...`, NOT `pnpm test` / `pnpm exec vitest`. The pnpm wrappers run a deps-status precheck that fires `pnpm install`, which fails offline/sandboxed ("Run pnpm approve-builds") and never reaches the tests. (`client` happens to pass because its deps are current; `server`/`reviewer-core` fail this way.)
- `.it.test.ts` testcontainers Postgres fails to boot with `Error: Log stream ended and message "/.*Started.*/" was not received` unless run with `TESTCONTAINERS_RYUK_DISABLED=true` (the Ryuk reaper container can't start under the sandbox). The pg image (`pgvector/pgvector:pg16`) is already pulled locally — the failure is Ryuk, not a missing image. These suites also need the Bash sandbox disabled to reach the Docker socket.

## Recurring Errors & Fixes

- An `.it.test.ts` that inserts its OWN fully-linked fixtures can stay green while the feature is broken for real users, because the demo seed (which users actually run via `pnpm db:seed`) builds the data DIFFERENTLY. Real case: `findings-counts.it.test.ts` set `reviews.run_id` on its hand-built rows, so per-run `findings_counts` passed — but the seed left `run_id` null, so the live app showed "—". Fix/guard: when a feature READS seed-shaped data, add a test that runs against `seed()` output (call `seed(db)` then query the seeded entity, e.g. PR #482) — not just hand-built rows. The two fixture shapes diverge; test both.

## Session Notes

## Open Questions
