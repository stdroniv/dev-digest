# Implementation Plan: Export Review Agents to CI (SPEC-05)

## Overview
Let a maintainer export a debugged review agent to a repo's GitHub Actions CI through a
guided wizard, so it reviews every pull request automatically with the same engine and
grounding gate that runs locally — delivered as a single reviewable PR, minimal by
construction (least-privilege, no secret to fork PRs, no marketplace action). CI results
are **pulled** back into the studio and digested into the existing run model, surfaced on a
dedicated CI Runs page and each agent's CI tab. Sourced from SPEC-05; nothing invented.

## Execution mode
**multi-agent (parallel)** — user chose multi-agent. The feature spans a new shared
contract, a new standalone `runner/` package, a new server `ci` module + GitHub-adapter
extension, and three client surfaces (wizard, CI Runs page, CI tab) — well over 15 files
with clean seams. The plan defines all wire contracts in an early Phase 0 and threads the
exact signatures into every downstream task so subagents that share no memory agree on the
interface. Dependency order: shared contract → (runner ∥ server ci-module ∥ github-adapter
extension) → (client foundation → components → page/tab wiring) → seed/tests.

## Requirements (verified)
Every AC is restated verbatim from `specs/SPEC-05-2026-07-12-export-agents-to-ci.md`
(approved). Each maps to an owning task in the Phased tasks section.

**Export wizard — Target & Preview**
- **AC-1** — WHILE the Export wizard is open, the system shall present GitHub Actions as a selectable target badged "recommended", and CircleCI, Jenkins, and Generic CLI as visible but non-selectable ("coming soon") targets.
- **AC-2** — WHEN the maintainer reaches the Preview step, the system shall list exactly the files that will be committed — the agent manifest at `.devdigest/agents/<slug>.yaml`, one file per linked skill at `.devdigest/skills/<slug>.md`, the empty `.devdigest/memory.jsonl`, the bundled agent-runner file(s), and the generated workflow at `.github/workflows/devdigest-review-<slug>.yml`.
- **AC-3** — WHEN the maintainer selects a file in the Preview tree, the system shall show that file's full contents and mark it editable, so the maintainer can inspect and adjust it before installing.
- **AC-4** — The system shall include the bundled agent-runner as a committed file in the Preview tree and the resulting PR, and shall reference no external or marketplace action in the workflow (the runner ships in the same PR).
- **AC-5** — The exported `.devdigest/memory.jsonl` shall be empty on export.

**Export wizard — Configure**
- **AC-6** — WHEN the maintainer reaches the Configure step, the system shall default the triggers to `pull_request:opened` and `pull_request:synchronize`, and offer `pull_request:reopened` as an optional addition.
- **AC-7** — The system shall offer three "Post results as" choices — GitHub review (default), PR comment, None (exit code only) — and shall label GitHub review as the only choice that yields a review verdict.
- **AC-8** — The Configure step shall display guidance stating that blocking a merge requires setting "Fail CI on" and adding a repository required status check, and that no GitHub App is needed.

**Export wizard — Install (open a PR / zip)**
- **AC-9** — WHEN the maintainer confirms "Open a PR with these files", the system shall make a single atomic commit of all generated files onto a `devdigest/ci` branch and open a pull request titled "Add DevDigest CI review", without committing anything to the default branch directly.
- **AC-10** — WHERE the "Copy files as a zip" path is chosen, the system shall provide the same generated file set for manual installation.
- **AC-11** — IF opening the PR fails (e.g. no write access, or the CI token cannot create a PR), THEN the system shall report the failure and offer the zip path as a fallback, without leaving a partial or half-committed export.
- **AC-12** — IF a skill linked to the agent cannot be resolved at export time, THEN the system shall block the export and name the unresolved skill, so no manifest referencing a skill absent from the bundle is ever committed.

**Manifest — one contract, two consumers**
- **AC-13** — The system shall serialize the agent (name, provider, model, system prompt, linked skill slugs, strategy, and "Fail CI on" policy) into the manifest, and shall validate that manifest against the same schema the CI runner uses to read it.
- **AC-14** — IF the manifest fails validation against the shared schema, THEN the system shall refuse to export rather than commit an invalid manifest.

**Idempotency, slugs & multiple agents per repo**
- **AC-15** — The system shall derive each agent's slug from its name and make it unique within the workspace, appending a disambiguating suffix when two agents would otherwise produce the same slug.
- **AC-16** — WHEN a maintainer exports two different agents to the same repository, the system shall give each its own manifest (`.devdigest/agents/<slug>.yaml`) and its own workflow (`.github/workflows/devdigest-review-<slug>.yml`), so neither overwrites the other and both run independently.
- **AC-17** — WHEN a maintainer re-exports an agent to a repository it is already installed in, the system shall update the existing installation in place — reusing the same `devdigest/ci` branch and existing open PR — and shall not create a duplicate installation or a second PR.

**CI runner — reviewing a PR**
- **AC-18** — WHEN a pull request event fires one of the configured triggers, the runner shall collect that PR's diff, run the same review engine used locally (including the grounding gate), and produce grounded structured findings comparable to a local run of the same diff.
- **AC-19** — The runner shall post its results according to the chosen "Post results as" option: a GitHub review carrying a verdict, a PR comment, or nothing (exit code only).
- **AC-20** — WHEN the runner finishes a review, it shall write a `devdigest-result.json` result artifact carrying the run's aggregate findings count, per-severity breakdown, cost, duration, agent identity, and PR number.

**Merge gating without a GitHub App**
- **AC-21** — The "Fail CI on" control shall offer exactly three levels — Critical, Warning+, and Never — governing the severity at or above which the run exits non-zero.
- **AC-22** — WHILE "Fail CI on" is set to Critical, WHEN a review produces a CRITICAL finding, the runner shall post a REQUEST_CHANGES verdict and exit non-zero, so that a repository required status check blocks the merge — with no GitHub App involved.
- **AC-23** — WHILE "Fail CI on" is set to Never, the system shall always exit zero regardless of finding severity, so the review never blocks a merge.
- **AC-24** — WHERE "Post results as" is None and "Fail CI on" is Critical, the system shall post nothing to the PR yet still exit non-zero on a CRITICAL finding, so the check can block a merge without any visible PR comment or review.

**Security guarantees (core WHY)**
- **AC-25** — The generated workflow shall request only `contents: read` and `pull-requests: write` permissions, and no broader scope.
- **AC-26** — The system shall reference the API key only via a CI secret (e.g. `${{ secrets.OPENROUTER_API_KEY }}`) and the CI-provided `GITHUB_TOKEN`, and shall never embed a key in the workflow or the manifest.
- **AC-27** — IF a review runs on a pull request from a fork (or the API-key secret is otherwise unavailable), THEN the runner shall never access or expose the secret, shall post nothing, shall record the run as "skipped — no credentials", and shall not block the merge.
- **AC-28** — The runner shall treat the PR diff, PR title/body, and any comment/issue text as data, never as instructions, and shall not trigger any action from the content of PR or issue comments.
- **AC-29** — The system shall generate a workflow whose every line is human-readable and editable, with no hidden or external marketplace action, so a maintainer can read and explain exactly what will run.

**Ingest — pulling results back into the studio**
- **AC-30** — WHEN the studio reconciles CI runs, it shall pull the `devdigest-result.json` artifact and the Actions run metadata and digest their aggregates into the existing run model (an agent run tagged `source='ci'`) plus a CI run record, without reconstructing a local per-finding trace.
- **AC-31** — The system shall validate a pulled result artifact against the shared schema before ingest; IF the artifact is present but schema-invalid, THEN the system shall record the run as Failed with a note and shall not fabricate findings or cost from it.
- **AC-32** — IF an Actions run produced no artifact (the job failed or errored before upload), THEN the system shall record the run as Failed and shall not fabricate findings or cost; WHILE an Actions run is still in progress, the system shall show it as running.
- **AC-33** — WHEN a CI run both executed successfully and produced one or more blocker findings (a REQUEST_CHANGES verdict), the system shall present it as **Succeeded** while conveying the blocked-merge state through its verdict and CRITICAL count — reserving **Failed** for runs where the runner itself failed to produce a review.
- **AC-34** — WHEN the studio reconciles CI runs, it shall bound the work to a recent window (the last N runs / last 7 days per installed repo) and shall do so on page view and on manual Refresh.

**CI Runs page**
- **AC-35** — The CI Runs page shall list ingested CI runs with Timestamp, Pull request, Agent, Source, Duration, Findings (CRITICAL / WARNING / SUGGESTION counts), Cost, Status, and an outbound Trace link to the GitHub Actions job.
- **AC-36** — The CI Runs page shall let the maintainer filter runs by date range, agent, repo, status, and source.
- **AC-37** — WHILE no CI runs have been ingested, the CI Runs page shall show the empty state "No CI runs yet" with the CTA "Set up CI for an agent".

**Agent CI tab**
- **AC-38** — WHILE an agent has no CI installations, its CI tab shall show the "Not in CI yet" empty state with an "Add to CI" CTA that opens the Export wizard.
- **AC-39** — WHILE an agent has one or more CI installations, its CI tab shall show "CI deployment", an "Active in N repos" count, an "Update CI config" and "Add to CI" action, the "Fail CI on" segmented control, and one row per repo showing repo name, target, status, workflow version, and last-run relative time.
- **AC-40** — WHEN the maintainer changes an agent's configuration after export and a repo's installed workflow version lags the agent's current config, the CI tab shall show that repo as "update available", so "Update CI config" is a targeted action.
- **AC-41** — WHEN a maintainer re-exports or updates an installation's configuration, the system shall increase that installation's workflow version, so a repo running an older config is distinguishable from one running the current config.
- **AC-42** — The system shall present each ingested CI run in the owning agent's existing Stats run history tagged source = CI, in addition to the CI Runs page.

## Open questions & recommendations
- Q1 → answered: runner packaged as a **new standalone `runner/` package** (`@devdigest/runner`) importing reviewer-core as source, esbuild-bundled to a prebuilt, checked-in `runner/dist/runner.mjs`; the server export service reads that committed artifact into the bundle (never bundles at request time). This is a deliberate **6th package** beyond root `CLAUDE.md`'s "5 standalone packages" — called out and the package table is updated as a task (T2) so reviewers don't flag it as drift.
- Q2 → answered: append ONE new migration adding `ci_installations.workflowVersion INT NOT NULL DEFAULT 1` + `installedConfigHash TEXT`, plus a `ci_runs.actionsRunId` column with a unique key for idempotent reconcile. Per-repo status + last-run derived from the latest `ci_runs` row. Existing migrations/tables untouched.
- Q3 → answered: on-demand reconcile route called on CI Runs mount + Refresh; no cron/poller.
- Q4 → answered: server route returns the zip built from the identical bundle generator (single source of truth).
- Q5 → answered: the runner uses its own minimal fetch-based GitHub REST client with the CI-provided `GITHUB_TOKEN`; the server octokit adapter is extended only for studio-side export/ingest.
- Q6 → answered: add a dev-only seed for `ci_installations` + `ci_runs` + matching `agent_runs(source='ci')` shaped from the design's `CI_RUNS` fixture; empty states via a fresh DB.
- Rec1 → accepted: one server-side "assemble bundle" service (`bundle.ts`) shared by Preview, zip, and Open-PR, with skill-resolution (AC-12) + manifest validation (AC-14) before any commit (guarantees AC-11's no-partial-export).
- Rec2 → **corrected during investigation:** there is **no vendor-sync script** (root `INSIGHTS.md:109-124`, server `INSIGHTS.md:53`). The three `src/vendor/shared` copies (server/client/mcp) *are* the source of truth and are hand-edited (not byte-identical — comments/imports differ; keep the field sets identical). Editing them is a **documented sanctioned exception**, not drift. reviewer-core + the new `runner/` need no copy — they alias server's. T1 owns all vendored-shared edits.
- Rec3 → accepted: map the UI's Critical / Warning+ / Never onto existing `agents.ciFailOn` values `critical`/`warning`/`never`; leave `any` unused (not removed); policy is per-agent, applied to all that agent's installations. (Client `CI_FAIL_ON_VALUES` still lists 4 values for the Config tab's `SelectInput`; the CI-tab segmented control exposes only these 3.)
- **Scope note (AC-42):** investigation found the agent editor has **no Stats run-history tab today** (only a Config/Skills/Context/Evals tab bar; the skill-scoped StatsTab is unrelated). AC-42 presumes an "existing Stats run history." This plan therefore **builds** a minimal agent Stats run-history tab (mirroring the PR-scoped `RunHistory` component) plus the `source` column to satisfy AC-42 — flagged here as added scope the wording implies, resolved by building rather than bouncing back.

## Affected modules & contracts

- **`@devdigest/shared` (vendored, all 3 copies: server/client/mcp)** — extend, do **not** author from scratch. The CI contracts already exist in `contracts/eval-ci.ts` (`AgentManifest`, `CiResultArtifact`, `CiTarget`, `CiFile`, `CiExportInput`, `CiExport`, `CiInstallation`, `CiRun`, `CiRunStatus`) and `contracts/findings.ts` (`Severity`, `Verdict`, `Finding`, `Review`). Changes needed: add `name`/`slug`/`workflow_version` to `AgentManifest` if absent (AC-13); extend `CiInstallation` with derived `workflow_version`/`status`/`last_run_at`/`update_available`/`target` (AC-39/40); verify `CiRunStatus` covers `succeeded | no_findings | failed | running | skipped_no_credentials` (AC-27/32/33); verify `CiResultArtifact` (AC-20/31); add `source` to `RunSummary` in `contracts/trace.ts` (AC-42); add two methods to the `GitHubClient` port in `adapters.ts` (AC-30/32).
- **`runner/` — NEW 6th standalone package** (`@devdigest/runner`). Imports `reviewer-core` as source + shared contracts (aliased into server's vendored copy, mirroring reviewer-core), esbuild-bundled to a committed `runner/dist/runner.mjs`.
- **`server/` — NEW `ci` module** (`src/modules/ci/`) + GitHub adapter Actions methods + one appended migration + container getter + module registration + dev seed.
- **`client/`** — new `ci-runs` route + page, Export Wizard modal, agent **CI tab** + **Stats tab**, `ci-runs` nav entry, `lib/hooks/ci.ts`, i18n (`ci.json` mostly pre-authored).
- **Contracts to add:** no net-new files — all changes are field/method extensions to existing vendored `contracts/eval-ci.ts`, `contracts/trace.ts`, and `adapters.ts`, owned solely by T1 (the only sanctioned vendored edit; root `INSIGHTS.md:109-124`, precedent commit `d45ab0d`).

## Architecture changes

New/edited files with their layer / boundary role:

```
runner/                                   NEW package @devdigest/runner (6th package)
  package.json, tsconfig.json             aliases @devdigest/reviewer-core → ../reviewer-core/src,
  build.mjs (esbuild)                        @devdigest/shared → ../server/src/vendor/shared (no 4th vendor copy)
  src/runner.ts                           entrypoint: read event ctx + manifest → reviewPullRequest → post → artifact → exit code
  src/github.ts                           minimal fetch-based GitHub REST client (diff, review, comment) — Q5
  src/manifest.ts                         load .devdigest/agents/<slug>.yaml, validate vs AgentManifest (AC-13)
  src/artifact.ts                         write devdigest-result.json (CiResultArtifact) + upload via Actions runtime API
  dist/runner.mjs                         COMMITTED build artifact the server bundles into the export (AC-4)

server/src/modules/ci/                    NEW module (Fastify plugin), mirrors modules/agents/ layout
  routes.ts                               presentation: schema-first Zod routes (fastify-type-provider-zod)
  service.ts                              application: install (commit+PR, idempotent), export options
  bundle.ts                               application: single "assemble bundle" generator (Rec1) — preview/zip/install
  workflow.ts, manifest.ts, slug.ts       pure helpers: workflow YAML, manifest YAML, slug uniqueness
  zip.ts                                  zip of the same bundle (AC-10)
  reconcile.ts                            application: pull artifacts → agent_runs(source='ci') + ci_runs (AC-30/34)
  repository.ts                           infrastructure: Drizzle queries (ci_installations, ci_runs, agent_runs)
  constants.ts, helpers.ts
server/src/adapters/github/octokit.ts     infrastructure: + listWorkflowRuns / downloadRunArtifact
server/src/adapters/mocks.ts              infrastructure: + mocked CI Actions methods
server/src/db/schema/ci.ts                infrastructure: + workflowVersion, installedConfigHash, actionsRunId
server/src/db/migrations/0020_*.sql       appended migration (never edit older ones)
server/src/platform/container.ts          composition root: + ciService/ciRepo getter
server/src/modules/index.ts               + ci module registration (static)
server/src/db/seed.ts                     dev seed (ci_installations, ci_runs, agent_runs source='ci')

client/src/app/ci-runs/page.tsx           thin RSC page → _components/CiRunsPage ("use client")
client/src/app/ci-runs/_components/CiRunsPage/**      table, filters, empty, auto-refresh
client/src/app/agents/[id]/_components/AgentEditor/_components/ExportWizard/**   4-step modal
client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/**          empty/exported states
client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/**       run history + Source column
client/src/lib/hooks/ci.ts                data layer (TanStack Query keys + fetch fns)
client/src/vendor/ui/nav.ts, shell/Sidebar.tsx   + GLOBAL section / ci-runs entry (sanctioned vendored edit)
```

Layering note (server `INSIGHTS.md:57`): the backend today is **ports/adapters + a single composition root**, not strict onion — repositories return Drizzle rows and services orchestrate against the `Container`. The `ci` module mirrors that pragmatic style (`modules/agents/` is the template); apply `backend-onion-architecture` for *placement / dependency direction*, not a strict entity/use-case refactor.

## Phased tasks

Dependency DAG (multi-agent groups; edges point to prerequisites):
`T1 → {T2, [T3,T4,T5], T9}` ; `[T3,T4,T5] → [T6,T7,T8]` ; `T9 → {T10, T11}` ; `{T9,T10} → T12` ; `{T7,T8,T11,T12} → T13`.
Group boundaries (non-overlapping owned paths): **G-contracts**(T1) · **G-runner**(T2) · **G-server-A**(T3,T4,T5) · **G-server-B**(T6,T7,T8) · **G-client-foundation**(T9) · **G-client-wizard**(T10) · **G-client-ci-runs**(T11) · **G-client-ci-tab**(T12) · **G-e2e**(T13). G-server-B depends on G-server-A (both server package) so they run sequentially, avoiding concurrent same-package churn.

### Phase 0 — Contracts (must land first; single owner)

#### T1 — Shared contract extensions + GitHubClient Actions port signatures
- **Action:** Extend the vendored shared contracts (hand-sync all 3 copies — server/client/mcp): (a) `contracts/eval-ci.ts` — ensure `AgentManifest` serializes `name`, `slug`, `provider`, `model`, `system_prompt`, `skills` (slugs), `strategy`, `ci_fail_on`, `workflow_version` (AC-13); extend `CiInstallation` with `target`, `workflow_version`, `status` (derived), `last_run_at` (derived), `update_available` (derived) (AC-39/40); confirm `CiRunStatus` = `succeeded | no_findings | failed | running | skipped_no_credentials` (AC-27/32/33); confirm `CiResultArtifact` carries findings_count + per-severity + cost + duration + agent + pr_number (AC-20/31); confirm `CiRun` exposes every CI-Runs column (AC-35) incl. an outbound `trace_url` + `actions_run_id`. (b) `contracts/trace.ts` — add `source: z.enum(['local','ci']).default('local')` to `RunSummary` (AC-42). (c) `adapters.ts` — add to the `GitHubClient` port: `listWorkflowRuns(repo, opts): Promise<WorkflowRunMeta[]>` and `downloadRunArtifact(repo, runId, name): Promise<Uint8Array | null>` (AC-30/32).
- **Module:** shared (server + client + mcp vendored copies)
- **Type:** core (contract)
- **Skills to use:** `zod`, `client-server-communication`
- **Owned paths:** `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts`, `mcp/src/vendor/shared/contracts/eval-ci.ts`, `server/src/vendor/shared/contracts/trace.ts`, `client/src/vendor/shared/contracts/trace.ts`, `mcp/src/vendor/shared/contracts/trace.ts`, `server/src/vendor/shared/adapters.ts`, `client/src/vendor/shared/adapters.ts`, `mcp/src/vendor/shared/adapters.ts`
- **Depends-on:** none
- **Risk:** medium (this is the wire spine; every downstream group codes against these exact shapes)
- **Known gotchas:** No sync script — the 3 copies are hand-edited and are **not** byte-identical (comments/imports differ); keep the **field/method sets** identical (root `INSIGHTS.md:109-124`, server `INSIGHTS.md:53`). mcp's copy must stay field-aligned or mcp typecheck breaks (mcp re-resolves server source's `@devdigest/shared` to mcp's copy — root `INSIGHTS.md:132-142`). reviewer-core + runner need **no** copy (they alias server's). Keep additions minimal (server `INSIGHTS.md` "prefer not to touch vendored").
- **Acceptance:** `cd server && node_modules/.bin/tsc --noEmit`, `cd client && node_modules/.bin/tsc --noEmit`, and `cd mcp && node_modules/.bin/tsc --noEmit` all pass; a hermetic `contracts` unit test round-trips `AgentManifest.parse(...)`, `CiResultArtifact.parse(...)`, and `RunSummary.parse({...source:'ci'})`; `grep -n "source" */src/vendor/shared/contracts/trace.ts` shows the field in all three copies.

### Phase 1 — Backend building blocks (parallel after T1; T4 needs no contract)

#### T2 — `runner/` package: engine-backed CI runner bundled to `dist/runner.mjs`
- **Action:** Create the new `@devdigest/runner` package. `src/runner.ts` reads the GitHub Actions event context (repo, PR number, `GITHUB_TOKEN`) + the agent manifest (`.devdigest/agents/<slug>.yaml` → validate against `AgentManifest`, AC-13), fetches the PR diff via `src/github.ts` (minimal fetch REST client, Q5), runs `reviewPullRequest({ systemPrompt, model, diff, skills, llm: new OpenRouterProvider(process.env.OPENROUTER_API_KEY!) })` (grounding baked in, AC-18), derives verdict/exit with the existing `gateTriggered`/`countBlockers`/`verdictFromFindings`/`toReviewPayload` from `@devdigest/reviewer-core` (do **not** reimplement — AC-21/22/23), posts per "Post results as" (review / comment / none — AC-19/24), writes `devdigest-result.json` matching `CiResultArtifact` + uploads it (AC-20). **Skip-on-no-creds** (AC-27): if `OPENROUTER_API_KEY` is empty/unset (fork PR), access no secret, post nothing, write artifact `status: skipped_no_credentials`, exit 0. Diff/PR text pass through the engine untouched — grounding + `wrapUntrusted` handle them internally (AC-28); do not re-wrap. esbuild bundle → committed `dist/runner.mjs` (`--format=esm --platform=node --target=es2022`). Update root `CLAUDE.md` package table to list the 6th package.
- **Module:** reviewer-core / runner
- **Type:** core
- **Skills to use:** `typescript-expert`, `security`
- **Owned paths:** `runner/**`, `CLAUDE.md` (root — package table + "Read when…" row)
- **Depends-on:** T1 (AgentManifest, CiResultArtifact)
- **Risk:** high (new package, esbuild not yet in the repo, cross-package source imports)
- **Known gotchas:** esbuild/ncc are **not** yet a repo dependency — add esbuild fresh; reviewer-core's header comment names `@vercel/ncc` as the intended bundler (neither is wired) — we choose **esbuild** per Q1, note the divergence so reviewers don't read it as drift. Do **not** import `drizzle-orm` operators anywhere in `runner/` (the new-package drizzle nominal-clash trap, root `INSIGHTS.md:11-23`) — the runner is pure review + REST, so it dodges this like reviewer-core; keep it DB-free. Value-import Zod schemas for `.safeParse` (server `INSIGHTS.md:98`). The generated workflow uses `pull_request` (not `pull_request_target`) so forks get no secret (AC-27) — that constraint lives in T5's workflow generator; mirror it in the runner's skip logic.
- **Acceptance:** `cd runner && node_modules/.bin/tsc --noEmit` passes; `node build.mjs` produces `dist/runner.mjs`; a bundle-parse smoke test runs `node dist/runner.mjs` against a fixture manifest + mocked LLM/GitHub and asserts (1) a CRITICAL finding under `ci_fail_on: critical` → non-zero exit + REQUEST_CHANGES payload (AC-22), (2) `ci_fail_on: never` → exit 0 (AC-23), (3) empty `OPENROUTER_API_KEY` → exit 0 + artifact `status: skipped_no_credentials` + nothing posted (AC-27), (4) post-as `none` + CRITICAL → nothing posted + non-zero exit (AC-24); `devdigest-result.json` validates against `CiResultArtifact` (AC-20); root `CLAUDE.md` table shows 6 packages and `cd evals && node_modules/.bin/vitest run workflow` (eval:workflow) passes for the CLAUDE.md change.

#### T3 — GitHub adapter: Actions run + artifact methods
- **Action:** Implement `listWorkflowRuns(repo, {workflowFileName, branch?, since, perPage})` (via `octokit.rest.actions.listWorkflowRunsForRepo` filtered by workflow file + `created>=since`) and `downloadRunArtifact(repo, runId, name)` (via `listWorkflowRunArtifacts` + `downloadArtifact` → unzip → return `devdigest-result.json` bytes, `null` if absent) on `OctokitGitHubClient`, matching the T1 port signatures. Add mocked versions to `MockGitHubClient` (record calls; return deterministic fixtures via new `workflowRuns` / `artifactContents` options).
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`, `fastify-best-practices`
- **Owned paths:** `server/src/adapters/github/octokit.ts`, `server/src/adapters/mocks.ts`
- **Depends-on:** T1
- **Risk:** medium (real Actions API + artifact-zip handling)
- **Known gotchas:** artifacts download as a zip — unzip in-adapter and return the single JSON entry; return `null` (don't throw) when no artifact exists so reconcile can mark the run Failed (AC-32). Mock shape = "record call + return fixture" (existing `MockGitHubClient` pattern).
- **Acceptance:** `cd server && node_modules/.bin/tsc --noEmit` passes; a hermetic unit test drives `MockGitHubClient.listWorkflowRuns`/`downloadRunArtifact` (including the no-artifact → `null` path) and asserts recorded calls + returned fixtures.

#### T4 — Migration: installation version/config-hash + idempotent-reconcile key
- **Action:** Add to `db/schema/ci.ts`: `ciInstallations.workflowVersion` (`integer notNull default 1`, AC-41), `ciInstallations.installedConfigHash` (`text`, drift source AC-40), `ciInstallations.updatedAt` (`timestamptz`); `ciRuns.actionsRunId` (`text`) + a unique index on `(ciInstallationId, actionsRunId)` so repeated reconcile can't double-insert (AC-30/34). Generate the migration via `pnpm db:generate` (produces `0020_*.sql`); leave `status`/`source` as plain text (governed by the Zod `CiRunStatus`/source enums, no DB enum needed).
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`, `postgresql-table-design`
- **Owned paths:** `server/src/db/schema/ci.ts`, `server/src/db/migrations/0020_*.sql` (new file only)
- **Depends-on:** none
- **Risk:** low
- **Known gotchas:** **Append-only** — never edit `0000`–`0019`; migrations are **not** run on boot — run `cd server && pnpm db:migrate` after generating. Do not delete/alter the reserved empty `ci_*` tables — only add columns.
- **Acceptance:** `pnpm db:generate` yields exactly one new `0020_*.sql`; `cd server && node_modules/.bin/tsc --noEmit` passes; a `.it.test.ts` (run `TESTCONTAINERS_RYUK_DISABLED=true ./node_modules/.bin/vitest run <file>.it.test`) applies migrations and asserts the new columns + that a duplicate `(ciInstallationId, actionsRunId)` insert is rejected.

#### T5 — Bundle generator (manifest + workflow + skills + runner + zip), slug uniqueness, export gates
- **Action:** Build the single "assemble bundle" service (Rec1) that preview/zip/install all call, so every path validates identically before any commit (AC-11). It produces the exact committed file set (AC-2): manifest `.devdigest/agents/<slug>.yaml` (serialize `AgentManifest` object → YAML via a `yaml` dep, **validated against the shared schema first** — AC-13/14; never contains a secret — AC-26), one `.devdigest/skills/<slug>.md` per linked skill (from `skills.body`), **empty** `.devdigest/memory.jsonl` (AC-5), the committed `runner/dist/runner.mjs` under `.devdigest/`, and `.github/workflows/devdigest-review-<slug>.yml`. The workflow (`workflow.ts`) requests **only** `contents: read` + `pull-requests: write` (AC-25), triggers on the configured `pull_request` types (AC-6), references `${{ secrets.OPENROUTER_API_KEY }}` + `${{ github.token }}` (AC-26), runs `node .devdigest/runner.mjs` with **no third-party/marketplace action** (only first-party SHA-pinned `actions/checkout` to fetch the committed runner — the review logic ships in-repo, AC-4/29), and is fully human-readable. Slug derivation + workspace-unique disambiguation (AC-15) → slug-keyed manifest + workflow so two agents never collide (AC-16). Block export + name the skill if any linked skill can't be resolved (AC-12). `zip.ts` produces the same file set for the degraded path (AC-10).
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`, `security`
- **Owned paths:** `server/src/modules/ci/bundle.ts`, `server/src/modules/ci/workflow.ts`, `server/src/modules/ci/manifest.ts`, `server/src/modules/ci/slug.ts`, `server/src/modules/ci/zip.ts`, `server/src/modules/ci/constants.ts`, plus co-located `*.test.ts` for these
- **Depends-on:** T1 (AgentManifest, CiFile/CiExport); **runtime prerequisite:** T2's committed `runner/dist/runner.mjs` (bundle reads it from disk; the "bundle contains a runnable runner" acceptance is gated on T2)
- **Risk:** medium (security-sensitive output; must be byte-exact)
- **Known gotchas:** manifest/workflow/bundle must **never** embed a key (AC-26) — assert this in a test. Value-import the Zod schema to `.parse`/`.safeParse` the manifest (server `INSIGHTS.md:98`). `actions/checkout` is first-party (permitted, SHA-pinned); a `devdigest/…@v1`-style line is only a mock placeholder (spec Non-goal) — never emit one. Skill bodies are trusted content, shipped verbatim — no `wrapUntrusted` here (that's the engine's job at review time).
- **Acceptance:** `cd server && node_modules/.bin/tsc --noEmit` passes; hermetic unit tests assert: file set matches AC-2 exactly (paths + the empty memory.jsonl); the workflow YAML `permissions:` block is exactly `contents: read` + `pull-requests: write` and nothing else (AC-25) and contains no `secrets.*` literal value nor any non-first-party `uses:` (AC-26/29); two agents with colliding names produce distinct slugs/filenames (AC-15/16); an agent with an unresolvable skill throws a named error and yields no bundle (AC-12); an invalid manifest object fails `AgentManifest.parse` and aborts (AC-14); the zip contains the identical file set (AC-10).

### Phase 2 — Server CI module (G-server-B; sequential after G-server-A)

#### T6 — Install service (commit+PR, idempotent) + reconcile/ingest + drift
- **Action:** `service.ts` install path: call `bundle.ts`, then `github.commitFiles(repo, { branch: 'devdigest/ci', base, message, files })` (one atomic commit — AC-9) + `openPullRequest(... title 'Add DevDigest CI review')`; idempotent re-export reuses the same branch + existing open PR (`findOpenPr`) and the existing installation row, bumping `workflowVersion` and updating `installedConfigHash` (AC-17/41), never creating a duplicate. On open-PR failure, surface a typed error the route maps so the client can offer the zip fallback, with no partial commit left behind (AC-11 — `commitFiles` is atomic, so a failed PR-open leaves only a branch, not a half-written tree). `reconcile.ts`: for each installation, `listWorkflowRuns` bounded to last 7 days / N per repo (AC-34), `downloadRunArtifact`, `CiResultArtifact.safeParse` → on success upsert `ci_runs` (idempotent by `actionsRunId`) + `agent_runs(source='ci')` aggregates (AC-30); schema-invalid artifact → record Failed + note, no fabricated findings/cost (AC-31); missing artifact on a completed run → Failed (AC-32); in-progress run → `running` (AC-32); success + blocker findings → **succeeded** (Failed reserved for runner failure, AC-33). Drift: `update_available` when `installedConfigHash` ≠ the agent's current config hash (AC-40). `repository.ts`: installation + run queries, per-installation derived `status`/`last_run_at` from the latest `ci_runs` row (AC-39), agent-scoped run list (local+ci, with `source`) for the Stats tab (AC-42).
- **Module:** server
- **Type:** backend
- **Skills to use:** `backend-onion-architecture`, `drizzle-orm-patterns`
- **Owned paths:** `server/src/modules/ci/service.ts`, `server/src/modules/ci/reconcile.ts`, `server/src/modules/ci/repository.ts`, `server/src/modules/ci/helpers.ts`, plus co-located `*.test.ts` / `*.it.test.ts`
- **Depends-on:** T1, T3, T4, T5
- **Risk:** high (idempotency + the failure-state matrix are the spec's core edge cases)
- **Known gotchas:** don't trust denormalized `agent_runs.findings_count`/`blockers` on read — derive per-severity fresh (server `INSIGHTS.md:15,52`). Repositories must not `throw` domain errors — return a result and let the service throw (server `INSIGHTS.md:92`). `.it.test.ts` needs `TESTCONTAINERS_RYUK_DISABLED=true`. Idempotent reconcile relies on the T4 unique key; test a double-reconcile inserts once. Compute the config hash over the same normalized manifest object `bundle.ts` serializes, so drift is exact.
- **Acceptance:** `cd server` `.it.test.ts` (RYUK-disabled, `MockGitHubClient`) asserts: a fresh export creates 1 installation + 1 branch + 1 PR; a **re-export** reuses them and bumps `workflowVersion` with no duplicate (AC-17/41); a failed `openPullRequest` throws the typed error and leaves no installation row (AC-11); reconcile ingests a valid artifact into `ci_runs` + `agent_runs(source='ci')` once across two calls (AC-30/34), maps a schema-invalid artifact → Failed-with-note (AC-31), a missing artifact → Failed (AC-32), an in-progress run → running (AC-32), and a success+CRITICAL run → succeeded (AC-33); an `installedConfigHash` change flips `update_available` (AC-40).

#### T7 — CI routes (schema-first) + container getter + module registration
- **Action:** `routes.ts` (Fastify plugin, `withTypeProvider<ZodTypeProvider>()`, schema-first — no hand-parsing): `POST /agents/:id/ci/preview` → `CiExport` file tree + contents (AC-2/3); `POST /agents/:id/ci/install` → commit+PR idempotent (AC-9/17), 422 naming the skill on unresolved-skill (AC-12), typed failure surfaced so the client offers the zip fallback (AC-11); `GET /agents/:id/ci/bundle.zip` → the zip (AC-10); `GET /agents/:id/ci/installations` → `CiInstallation[]` with derived status/version/last-run/drift (AC-39/40); `GET /ci-runs` (optional filters; returns the bounded set) (AC-35/36); `POST /ci/reconcile` → on-demand reconcile (AC-34); `GET /agents/:id/runs` → `RunSummary[]` (local+ci, with `source`) for the Stats tab (AC-42). "Fail CI on" reuses the existing `PATCH /agents/:id { ci_fail_on }` (no new route — AC-21, Rec3). Register `ci` in `modules/index.ts`; add a `ciService`/`ciRepo` getter to `container.ts`.
- **Module:** server
- **Type:** backend
- **Skills to use:** `fastify-best-practices`, `client-server-communication`
- **Owned paths:** `server/src/modules/ci/routes.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, plus co-located `routes.it.test.ts`
- **Depends-on:** T5, T6
- **Risk:** medium
- **Known gotchas:** modules are registered **statically** in `index.ts` (one import + one entry); plugins register before modules. Use the one error envelope (`{ error: { code, message } }`) via the central handler — don't hand-roll shapes. An optional request body must be `.nullish()` not `.optional()` (server `INSIGHTS.md:86`). Rate-limit `install`/`reconcile`. Validate any repo-path-like input at write time (server `INSIGHTS.md:87`).
- **Acceptance:** `cd server && node_modules/.bin/tsc --noEmit` passes; `routes.it.test.ts` (RYUK-disabled, `app.inject` with mock github/llm overrides) asserts each route's status + shape: preview returns the AC-2 file set; install is idempotent across two calls; unresolved skill → 422 naming the skill; `GET /ci-runs` returns ingested rows; `POST /ci/reconcile` is safe to call twice; `GET /agents/:id/runs` rows include `source`.

#### T8 — Dev seed for CI (offline-demoable populated states)
- **Action:** Add an idempotent dev seed of `ci_installations` (with `workflowVersion`, `installedConfigHash`, `target: 'gha'`), `ci_runs` (varied: `succeeded`, `no_findings`, `failed`, one `running`, one `skipped_no_credentials`; realistic findings CRIT/WARN/SUGG counts, cost, duration, `githubUrl`, `actionsRunId`), and matching `agent_runs(source='ci')` linked to a seeded agent — shaped from the design's `CI_RUNS` fixture — so the CI Runs page, the CI-tab exported state, and the Stats Source column all demo without a live GitHub round-trip (AC-35/39/42). A fresh/unseeded DB still reaches the empty states (AC-37).
- **Module:** server
- **Type:** backend
- **Skills to use:** `drizzle-orm-patterns`
- **Owned paths:** `server/src/db/seed.ts` (+ optional `server/src/db/seed-ci.ts`)
- **Depends-on:** T4 (schema), T1 (shapes)
- **Risk:** low
- **Known gotchas:** seed must **link** `agent_runs.agentId` or agent-scoped reads show em-dashes (server `INSIGHTS.md:16,65`); guard inserts so re-running `pnpm db:seed` is idempotent; keep new demo data on its own installation/PR numbers so existing seed-dependent tests/e2e stay green.
- **Acceptance:** `pnpm db:seed` twice leaves one copy of each row (idempotent); a `.it.test.ts` runs `seed(db)` then asserts `GET /ci-runs` returns the seeded runs with correct per-severity counts and `GET /agents/:id/runs` shows `source:'ci'` rows.

### Phase 3 — Client foundation (single owner; unblocks the surfaces)

#### T9 — Nav entry, `ci-runs` route scaffold, data hooks, i18n verification
- **Action:** (1) Add a `NavGroup { section: "GLOBAL", items: [{ key: "ci-runs", label: "CI Runs", icon: "Workflow", href: "/ci-runs" }] }` to `nav.ts` and render the new section in `Sidebar.tsx` (the `ci-runs` active-key stub already exists in `app-shell/helpers.ts`; `Icon.Workflow` is already registered) — **sanctioned vendored edit** (precedent: `docs/plans/project-context-nav-entry.md`). (2) `lib/hooks/ci.ts` (+ barrel export in `lib/hooks/index.ts`): a `ciKeys` object (mirror `evalKeys`) + hooks `useCiRuns(filters)` (with `refetchInterval` for auto-refresh, mirroring `usePulls`), `useCiInstallations(agentId)`, `useAgentRuns(agentId)`, `useExportPreview()`, `useExportInstall()` (mutation, invalidates installations), `useExportZip()`, `useReconcileCiRuns()` (mutation) — all typed off the vendored `eval-ci.ts`/`trace.ts` contracts and fetched through `lib/api.ts`. (3) `app/ci-runs/page.tsx` thin page delegating to `_components/CiRunsPage`. (4) Verify `messages/en/ci.json` (already authored: `runs.*`, `exportWizard.*`, `ciTab.*`, `page.crumb`) + `messages/en/agents.json` (`editor.tabs.ci`/`editor.tabs.stats`) cover all copy; add any missing keys **and CORRECT wrong ones**. **AC-8 fix (required):** `exportWizard.blockMergeTitle`/`blockMergeDesc` (currently `ci.json:70-71`) today read *"Block merge on findings" / "Requires a GitHub App — not available with PAT in local mode"* — the **opposite** of AC-8. **Replace** them with copy matching the spec's N12 merge-block hint: title conveys "To block merges", description ≈ *"Set **Fail CI on** (CI tab) so the run exits non-zero, then add a **required status check** in the repo's GitHub branch protection. No GitHub App needed."* (T10 renders this hint verbatim from `ci.json`, so correcting it here is what makes AC-8 true end-to-end.)
- **Module:** client
- **Type:** ui
- **Skills to use:** `ui-frontend-architecture`, `react-best-practices`
- **Owned paths:** `client/src/vendor/ui/nav.ts`, `client/src/vendor/ui/shell/Sidebar.tsx`, `client/src/lib/hooks/ci.ts`, `client/src/lib/hooks/index.ts`, `client/src/app/ci-runs/page.tsx`, `client/messages/en/ci.json`, `client/messages/en/agents.json`
- **Depends-on:** T1 (client vendored contracts). Integration acceptance references the T7 routes (built in parallel; hooks code against the T1 contract).
- **Risk:** low-medium (touches a vendored nav file — sanctioned, keep the edit minimal)
- **Known gotchas:** data access **only** through `lib/hooks/*` → `lib/api.ts` (never raw fetch in a component). i18n namespace = filename (`useTranslations("ci")`). No `pnpm lint` script in client. The nav/Sidebar edit is the one sanctioned client-side vendored exception — cite the precedent in the commit.
- **Acceptance:** `cd client && node_modules/.bin/tsc --noEmit` passes; the sidebar renders a "CI Runs" item under a GLOBAL section (a render/unit test asserts the nav item + href); a hook unit test (fetch mocked) asserts `useCiRuns` calls `/ci-runs` and `useReconcileCiRuns` POSTs `/ci/reconcile`; **AC-8:** `grep -i "github app" client/messages/en/ci.json` shows only the "No GitHub App needed" phrasing under `exportWizard.blockMerge*` (the prior "Requires a GitHub App" copy is gone) and the description mentions "Fail CI on" + "required status check".

### Phase 4 — Client surfaces (parallel after T9)

#### T10 — Export Wizard modal (4 steps)
- **Action:** Build the `ExportWizard` feature component (composing vendored `Modal`, `ExportWizardSteps`, `Badge`, `Chip`, `Button`, `FormField`, radio/select primitives — never editing them). Title "Export to CI" / subtitle "Run <Agent> automatically on pull requests"; stepper **Target → Preview → Configure → Install**. **Target** (AC-1): GitHub Actions card selectable + "recommended" badge; CircleCI / Jenkins / Generic CLI cards visible, disabled, "coming soon" (static target list per the design `CI_TARGETS`). **Preview** (AC-2/3/4): file tree (`FileTreeRow`) from `useExportPreview`, one node per committed file incl. the runner + empty memory.jsonl; selecting a node shows full contents with an **"editable"** badge. **Configure** (AC-6/7/8): trigger chips `opened`+`synchronize` on by default, `reopened` optional; "Post results as" radio — GitHub review (default, "recommended", "only choice that yields a verdict"), PR comment, None; merge-block hint copy verbatim from `ci.json`. **Install** (AC-9/10/11): primary "Open a PR with these files" (→ `useExportInstall`), degraded "Copy files as a zip" (→ `useExportZip`), docs footer; on install failure show the error and offer the zip fallback (AC-11); a 422 unresolved-skill error names the skill (AC-12). Back/Continue nav; final action Install.
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `next-best-practices`
- **Owned paths:** `client/src/app/agents/[id]/_components/AgentEditor/_components/ExportWizard/**` (ExportWizard.tsx, FileTreeRow.tsx, step components, styles.ts, `*.test.tsx`)
- **Depends-on:** T9 (hooks + i18n)
- **Risk:** medium (largest single UI surface)
- **Known gotchas:** compose vendored primitives, don't edit `src/vendor/ui/**`. Read copy from `useTranslations("ci")` (`exportWizard.*`) — don't hardcode. Surface `ApiError` (from `lib/api.ts`) for AC-11/12 branches. The mock's fixed `devdigest-review.yml` is superseded by the spec's slug-keyed filename (AC-16) — Preview shows `devdigest-review-<slug>.yml`.
- **Acceptance:** `cd client && node_modules/.bin/tsc --noEmit` + `cd client && pnpm test` (vitest) pass; RTL tests assert: Target shows GHA selectable + 3 disabled targets (AC-1); Preview lists exactly the AC-2 file set with an "editable" badge on selection (AC-2/3); Configure defaults `opened`+`synchronize` chips on, `reopened` off, GitHub-review radio default + verdict label (AC-6/7), and renders the merge-block hint (AC-8); Install renders both paths + docs footer (AC-9/10) and, on a mocked install rejection, shows the error + zip fallback (AC-11) and names a skill on a mocked 422 (AC-12).

#### T11 — CI Runs page (table, filters, empty, auto-refresh)
- **Action:** Build `CiRunsPage` (mirroring the PR-list page + `FilterBar` pattern). Header "CI Runs" / subtitle "Agent reviews executed inside CI · not local runs"; an **auto-refresh indicator** ("auto-refresh on") + a **Refresh** button that calls `useReconcileCiRuns` then refetches; reconcile also fires on mount (AC-34, client-side). Filters (client-side over the bounded fetch, per the repo pattern): date range (default "Last 7 days"), agent, repo, status, source (AC-36). Table columns exactly (AC-35): Timestamp, Pull request (`#num` + title), Agent, Source, Duration, **Findings** (CRITICAL / WARNING / SUGGESTION count chips reusing the client's severity color tokens; "—" when none), Cost, Status, **Trace** (outbound link to the Actions job). Status tokens: Succeeded / No findings / Failed (+ display Running and "skipped — no credentials" for those edge states, visually distinct — AC-33/edge cases). Empty state (AC-37): "No CI runs yet" / "Once you export an agent to CI, every automated review shows up here." / CTA "Set up CI for an agent" (→ navigate to `/agents`).
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/app/ci-runs/_components/CiRunsPage/**` (CiRunsPage.tsx, CiRunsTable.tsx, CiRunRow.tsx, CiFindingsCell.tsx, FilterBar.tsx, styles.ts, `*.test.tsx`)
- **Depends-on:** T9
- **Risk:** medium
- **Known gotchas:** succeeded-with-blockers is still **Succeeded** (AC-33) — key the status token off the run's `status`, not off the CRITICAL count; convey the block via the CRITICAL chip + verdict. Reuse existing severity color mapping (`SeverityBadge`/`CategoryTag`) for `CiFindingsCell` — don't invent tokens. Auto-refresh via `refetchInterval` + `refetchOnWindowFocus` (mirror `usePulls`). Loading = `Skeleton` rows, error = `ErrorState` with retry (existing pattern).
- **Acceptance:** `cd client && node_modules/.bin/tsc --noEmit` + `pnpm test` pass; RTL tests (mocked hooks) assert: all 9 columns render for a seeded-shape row incl. per-severity chips and a "—" when no findings (AC-35); a succeeded-with-CRITICAL row shows "Succeeded" not "Failed" (AC-33); each filter narrows the list (AC-36); the empty state shows the exact copy + CTA (AC-37); the Refresh button triggers `useReconcileCiRuns` (AC-34).

#### T12 — Agent CI tab + Stats tab + tab-bar wiring
- **Action:** (1) Add "CI" and "Stats" to **both** tab arrays — `AgentEditor/constants.ts` `TABS` and the separate `agents/[id]/page.tsx` `VALID_TABS` (labels already in `agents.json`) — and add their branches to `AgentEditor.tsx`. (2) `CiTab`: empty state "Not in CI yet" / "Deploy this agent…" / CTA "Add to CI" → opens the T10 `ExportWizard` (AC-38); exported state — header "CI deployment" + badge "Active in N repos" + "Update CI config" + "Add to CI" (AC-39); a **"Fail CI on" segmented control** (feature-local, built from the `BlastRadius` toggle-style trio — no vendored primitive) with 3 options Critical / Warning+ / Never mapped to `critical`/`warning`/`never` and persisted via the existing `useUpdateAgent({ ci_fail_on })` (AC-21, Rec3); one row per installation from `useCiInstallations` — repo name, target ("GitHub Actions"), status, workflow version, last-run relative time, and an "update available" drift indicator (AC-39/40); an "Add repository" affordance + this agent's CI run history. (3) `StatsTab`: a run-history table (mirror the PR-scoped `RunHistory` component) from `useAgentRuns`, including a **Source** column badging each row local / CI (AC-42).
- **Module:** client
- **Type:** ui
- **Skills to use:** `react-best-practices`, `ui-frontend-architecture`
- **Owned paths:** `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`, `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, `client/src/app/agents/[id]/page.tsx`, `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/**`, `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/**`
- **Depends-on:** T9 (hooks/i18n), T10 (wizard component to open from the CI tab)
- **Risk:** medium
- **Known gotchas:** **two** tab-key arrays must both change (`constants.ts` `TABS` + `page.tsx` `VALID_TABS`) or the `?tab=ci`/`?tab=stats` deep-link 404s. No `SegmentedControl` primitive exists — build feature-local. `CiFailOn` has 4 enum values but this control exposes 3 (`any` unused). RTL tests wrap in `NextIntlClientProvider` with the `ci`/`agents` message subtrees.
- **Acceptance:** `cd client && node_modules/.bin/tsc --noEmit` + `pnpm test` pass; RTL tests assert: with zero installations the CI tab shows "Not in CI yet" + "Add to CI" opening the wizard (AC-38); with installations it shows "CI deployment", the "Active in N repos" count, the Fail-CI-on 3-way control persisting via `useUpdateAgent`, and per-repo rows incl. an "update available" row when drift is present (AC-39/40); the Stats tab renders a run row with a CI Source badge (AC-42); `?tab=ci` and `?tab=stats` both resolve.

### Phase 5 — End-to-end smoke (optional; final)

#### T13 — Deterministic e2e flow (CI Runs + wizard open)
- **Action:** Add a deterministic agent-browser flow (CDP, **no LLM**, per `e2e/CLAUDE.md`) against the seeded DB: navigate to CI Runs → assert the seeded rows + column headers; open an agent's CI tab → open the Export Wizard → step Target → Preview and assert the file tree. Also assert the empty state on a fresh (unseeded) DB path if the harness supports it.
- **Module:** e2e
- **Type:** e2e
- **Skills to use:** `react-testing-library` (selector conventions), `ui-frontend-architecture`
- **Owned paths:** `e2e/**` (one new flow file + any fixture)
- **Depends-on:** T7, T8, T11, T12
- **Risk:** low (optional; unit/integration coverage already lives in each group)
- **Known gotchas:** e2e is LLM-free and deterministic — drive against the T8 seed, not a live GitHub/LLM round-trip; prefer `--exact` selectors (recent CI-stability fixes in the git log).
- **Acceptance:** the flow passes headlessly in the e2e harness (seeded CI Runs rows visible; wizard reaches Preview).

## Testing strategy

- **Contracts (T1):** hermetic Zod round-trip unit tests in each package; `tsc --noEmit` in server + client + mcp is the cross-copy consistency gate.
- **Runner (T2):** hermetic unit tests with a mocked `LLMProvider` + mocked GitHub REST (no keys, no network) covering post-as × fail-on × skip-on-no-creds and the exit-code matrix (AC-19/22/23/24/27); a build/parse smoke test that `dist/runner.mjs` bundles and executes; artifact validates against `CiResultArtifact`. Run: `cd runner && node_modules/.bin/tsc --noEmit` + `node_modules/.bin/vitest run`.
- **Server (T3–T8):** hermetic `*.test.ts` for bundle/workflow/slug/mocks; DB-backed `*.it.test.ts` (co-located under `server/src/modules/ci/`) for install idempotency, the reconcile failure-state matrix, and routes via `app.inject` with mock github/llm overrides. Run: `cd server && node_modules/.bin/tsc --noEmit`; unit `node_modules/.bin/vitest run --exclude '**/*.it.test.ts'`; integration `TESTCONTAINERS_RYUK_DISABLED=true ./node_modules/.bin/vitest run .it.test`. (Use the package-local binary, not `pnpm test` — offline pnpm precheck fails; root `INSIGHTS.md:303`.)
- **Client (T9–T12):** co-located `*.test.tsx` RTL tests (fetch/hooks mocked, `NextIntlClientProvider` with the matching message subtree). Run: `cd client && node_modules/.bin/tsc --noEmit` + `pnpm test`. No lint script in client.
- **e2e (T13):** deterministic browser flow, no LLM, against the seed.
- **Evals:** T2 edits root `CLAUDE.md` (package table) → run `cd evals && pnpm eval:workflow` (or `node_modules/.bin/vitest run workflow`) as part of that task's acceptance.

## Risks & mitigations

- **esbuild/ncc not yet in the repo; new-package bundling** → add esbuild fresh in `runner/` only; a build/parse smoke test gates the artifact; note the intended-bundler discrepancy (reviewer-core's comment says ncc) so it reads as a deliberate choice, not drift (T2).
- **"No external marketplace action" vs GitHub mechanics** (AC-4/29) → the review logic ships fully in the committed `.devdigest/runner.mjs`; the only `uses:` is first-party SHA-pinned `actions/checkout` to fetch the runner, and the runner uploads its artifact via the Actions runtime API (not `actions/upload-artifact`). Documented interpretation pinned in T5/T2; a test asserts no non-first-party `uses:` and no hidden review action.
- **Secret leakage** (AC-26/27) → workflow uses `pull_request` (not `pull_request_target`) so forks get no secret; the runner treats an empty key as skip-on-no-creds; tests assert the bundle/workflow/manifest contain no literal key.
- **Vendored-shared drift across 3 copies** (no sync script) → T1 is the single owner of all vendored edits; `tsc --noEmit` in server+client+mcp is the consistency gate; keep additions minimal.
- **Idempotency of export + reconcile** (AC-17/30/34) → same branch/PR/installation reuse via `findOpenPr` + existing-row lookup; reconcile idempotent by the T4 unique `(ciInstallationId, actionsRunId)` key; both covered by double-call `.it.test.ts`.
- **Concurrent same-package edits causing transient red typecheck** (root `INSIGHTS.md:305`) → G-server-B depends on G-server-A (sequential in the server package); client surface groups own disjoint folders; each agent verifies its own owned paths, attributing whole-repo-gate noise to cross-agent in-progress edits rather than patching around it.
- **AC-42 presumes a Stats tab that doesn't exist** → resolved by building a minimal agent Stats run-history tab + `source` column (scope note above); flagged for the coordinator.

## Red-flags check
- [x] Every requirement (AC-1…AC-42) maps to at least one task — see per-task AC citations (AC-1→T10; 2/3→T5,T7,T10; 4→T2,T5; 5→T5; 6/7/8→T10; 9/11/17→T6,T7,T10; 10→T5,T7,T10; 12→T5,T7,T10; 13/14→T1,T5; 15/16→T5; 18/19/20/22/23/24/27/28→T2; 21→T12; 25/26/29→T5; 30/31/32/33/34→T6,T7; 35/36/37→T7,T11; 38/39/40→T12; 41→T4,T6; 42→T1,T6,T7,T12).
- [x] No specification was authored or edited — SPEC-05 taken as input; ACs restated verbatim for traceability.
- [x] Execution mode recorded (multi-agent) and the plan is shaped for it (contracts-first Phase 0; disjoint owned paths; explicit DAG).
- [x] Dependencies form a DAG (no cycles) — see the DAG line; every Depends-on points to an earlier task.
- [x] (multi-agent) Concurrent tasks have non-overlapping Owned paths — verified across groups; the only same-package concurrency (server) is serialized via G-server-B → G-server-A.
- [x] Every Acceptance is measurable (a command + an asserted behavior/output).
- [x] Contracts are defined before any task that depends on them — T1 precedes all consumers.
- [x] No edits to existing shared contracts **without an explicit callout** — the only vendored-shared edits are field/method **additions** owned solely by T1, called out as the repo's sanctioned mechanism (no sync script; root `INSIGHTS.md:109-124`).
- [x] `*/src/vendor/**` edits are limited to two documented sanctioned exceptions — shared-contract additions (T1) and the nav entry (T9, `nav.ts`/`Sidebar.tsx`, precedent `docs/plans/project-context-nav-entry.md`); no other vendored file is touched.
- [x] No DB table deletions or edits to existing migrations — one appended `0020_*.sql`; only column adds to `ci_*`; reserved tables untouched.
- [x] Failure & edge states have owning tasks — first-ever vs prior-artifact failure (T6: missing/invalid artifact → Failed without clobbering prior runs), partial/one-of-N isolation (T6: per-installation reconcile, one bad run doesn't fail the batch), preserve-prior-on-retry (T6: idempotent upsert by `actionsRunId`; re-export bumps version without nulling prior installation), in-progress + navigate-away (T6/T11: `running` status persists and shows on return), unavailable/not-ready precondition (T2/T11: skip-on-no-creds is a distinct "skipped — no credentials" state, not an error; empty state distinct from unavailable).
- [x] (design referenced) Every in-scope screen anchored by a stable id with a measurable visual contract — Export Wizard (N12: 4-step `ExportWizardSteps`, target badges, `FileTreeRow` + "editable" badge, post-as "recommended" badge, two install paths) → T10; CI Runs (N13: 9-column grid, `CiFindingsCell` severity chips, filter set, auto-refresh, empty copy) → T11; agent CI tab (`CITab`: empty vs exported, 3-way Fail-CI-on, installation rows + drift) → T12; Stats Source column → T12; `ci-runs` GLOBAL nav → T9. Exact copy sourced from spec "Screens & states" + the pre-authored `messages/en/ci.json`; demo data the populated states imply has an owning seed task (T8).
