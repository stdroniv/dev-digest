# runner — `@devdigest/runner`

The **CI agent-runner**: the job that runs inside a repo's GitHub Actions after an
agent is exported (SPEC-05). Reads the exported `AgentManifest`, fetches the PR
diff via its own minimal GitHub REST client, runs the SAME review engine
(`reviewer-core`'s `reviewPullRequest`, grounding gate included) used locally,
posts results per "Post results as", and writes a `devdigest-result.json` result
artifact — *one artifact, two environments*. No DB, no octokit, no marketplace
action: everything it needs ships in one esbuild-bundled, committed file.

## Commands

`pnpm typecheck` (`tsc --noEmit`) · `node build.mjs` (esbuild → `dist/runner.mjs`)
· `pnpm test` (vitest — hermetic, mocked LLM/GitHub, no keys/network). Build
BEFORE test — `test/runner.smoke.test.ts` imports the built `dist/runner.mjs`,
not `src/runner.ts`, on purpose (see below).

## Conventions (non-obvious)

- **Consumes `@devdigest/reviewer-core` as TypeScript source** (tsconfig alias
  → `../reviewer-core/src`) and `@devdigest/shared` aliased straight into
  **server's** vendored copy (→ `../server/src/vendor/shared`) — mirrors
  `reviewer-core/tsconfig.json`'s own pattern exactly. There is no 4th vendored
  copy for the runner.
- **`dist/runner.mjs` is a COMMITTED build artifact**, not a build step run in
  CI. The server's export-to-CI bundle (`server/src/modules/ci/bundle.ts`)
  reads this file from disk and ships it as `.devdigest/runner.mjs`; the
  generated workflow runs `node .devdigest/runner.mjs` directly — no
  `npm install`, no marketplace action (AC-4/AC-29). Rebuild + re-commit
  `dist/runner.mjs` any time `src/**` changes.
- **esbuild, not `@vercel/ncc`** — reviewer-core's header comment names ncc as
  the "intended" bundler; that was never wired anywhere in this repo. esbuild
  is the actual bundler (plan Q1), pinned via `pnpm.onlyBuiltDependencies` +
  the committed `pnpm-workspace.yaml` (`allowBuilds.esbuild: true`, mirroring
  `evals/`) so `pnpm install` doesn't hit pnpm 11's build-script gate.
- **No `drizzle-orm` import anywhere in this package.** The runner is
  DB-free by design (pure review + REST); adding a drizzle operator import
  here would hit the new-package drizzle nominal-clash trap (root
  `INSIGHTS.md`).
- **`zod` must be the runner's OWN dependency**, path-mapped in
  `tsconfig.json` (`"zod": ["./node_modules/zod"]`) exactly like
  `reviewer-core/tsconfig.json` — this isn't optional plumbing, it avoids a
  Zod-schema nominal-type clash across physically-different `zod` installs
  (the same class of bug as the documented drizzle clash, one layer up: every
  `AgentManifest`/`CiResultArtifact`/`Review` Zod object reachable through the
  `@devdigest/shared`/`@devdigest/reviewer-core` aliases must resolve to the
  SAME physical `zod` package).
- **The bundle-parse smoke test (`test/runner.smoke.test.ts`) imports the
  built `dist/runner.mjs`, not `src/runner.ts`** — bundling can break things
  a source-only test never exercises. It lives under `test/` (excluded from
  `tsconfig.json`'s `include`, same convention as `reviewer-core/test/`) so
  importing an untyped `.mjs` build output doesn't fail `tsc --noEmit`.
  `run()` is dependency-injectable (`RunnerDeps.createGitHubClient`/
  `createLlm`/`resultPath`) precisely so this test can mock the LLM and
  GitHub REST with zero network/keys.
- **Skip-on-no-credentials is checked FIRST**, before any GitHub call or LLM
  construction (AC-27) — see `runner.ts`'s `run()`. Never log
  `OPENROUTER_API_KEY`/`GITHUB_TOKEN` values.
- **CLI/env contract** the generated workflow (T5) must drive:
  `node .devdigest/runner.mjs --slug=<agent-slug> [--post-as=<github_review|pr_comment|none>]`
  + env `GITHUB_TOKEN`, `OPENROUTER_API_KEY`, `GITHUB_REPOSITORY`,
  `GITHUB_EVENT_PATH` (all auto-set by Actions on a `pull_request` trigger).
  See `src/context.ts` for the full list including test-only overrides.

## Do not touch

- `../server/src/vendor/shared/**` — not this package's copy to edit; changes
  to the shared contracts belong to whichever task owns the vendored-shared
  sanctioned exception (see root `INSIGHTS.md`).

## Read when…

- **the review engine / grounding gate / gate helpers this runner calls** →
  `../reviewer-core/CLAUDE.md`.
- **the shared `AgentManifest`/`CiResultArtifact`/`CiRunStatus` contracts** →
  `../server/src/vendor/shared/contracts/eval-ci.ts`.
- **how the studio assembles/commits the exported bundle that ships this
  runner** → `../server/CLAUDE.md` (module `ci`, once built).
- **hard-won gotchas** → `INSIGHTS.md`.
