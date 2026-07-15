# runner — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module
(`@devdigest/runner`). Managed by the `engineering-insights` skill. Add each
entry under one section; keep it actionable cold; never edit or delete
existing entries.

## What Works

- **A NEW standalone package can alias BOTH `@devdigest/reviewer-core` (→
  `../reviewer-core/src`) AND `@devdigest/shared` (→
  `../server/src/vendor/shared`) with zero drizzle/DB exposure, exactly like
  `reviewer-core` aliases `@devdigest/shared` — confirmed building `runner/`
  (T2, SPEC-05). The package only needs its OWN `zod` + `yaml` dependencies
  (`zod` because `reviewer-core/tsconfig.json`'s own `paths` mirror requires
  it — see Tool & Library Notes below; `yaml` for parsing the exported
  manifest). It does NOT need its own `openai` dependency even though
  `reviewer-core/src/llm/openrouter.ts` imports `openai` directly — under
  `moduleResolution: "Bundler"`, TypeScript resolves that bare specifier by
  walking up from the FILE'S OWN physical location (`reviewer-core/src/llm/`),
  landing on `reviewer-core/node_modules/openai`, regardless of which
  package's tsconfig/program is doing the typechecking. Same story at esbuild
  bundle time (esbuild's resolver mirrors Node's algorithm). Lesson: when
  aliasing a sibling package as source, you only need to duplicate ITS
  dependencies as your own for specifiers your OWN tsconfig `paths` explicitly
  intercepts (like `zod`) — everything else resolves fine off the aliased
  package's own `node_modules` as long as that package already has its deps
  installed.
- **esbuild cleanly bundles `reviewer-core` (openai SDK + zod) + the vendored
  `@devdigest/shared` contracts into one self-contained ESM file** via
  `{ bundle: true, format: 'esm', platform: 'node', target: 'es2022' }`,
  honoring the SAME tsconfig `paths` aliases `tsc` uses (no extra esbuild
  `alias`/`external` config needed) — esbuild auto-detects `tsconfig.json` in
  the entry point's directory. Output was ~1.5MB (esbuild warns past 1MB but
  it's not an error) for `reviewer-core` + `openai` + `yaml` + `zod` + all of
  `@devdigest/shared`'s contracts. A `node --check dist/runner.mjs` (or
  `import()`-ing it) confirms the bundle parses/loads; the file exports
  whatever the entry file (`src/runner.ts`) exports at its top level (e.g.
  `export async function run(...)`) — no extra esbuild config needed to
  preserve named exports for a `format: 'esm'` bundle.
- **`pnpm.onlyBuiltDependencies` in `package.json` is a DEAD setting on this
  repo's pnpm (11.5.0)** — `pnpm install` prints `[WARN] The "pnpm" field in
  package.json is no longer read by pnpm ... "pnpm.onlyBuiltDependencies"`
  every time, even though `evals/package.json` (the precedent this repo's own
  docs point to) still carries it. The setting that actually works is a
  **package-local `pnpm-workspace.yaml`** with:
  ```yaml
  allowBuilds:
    esbuild: true
  ```
  (mirrors the already-committed `evals/pnpm-workspace.yaml`). Create this
  file BEFORE the first `pnpm install` in any new package that needs
  esbuild's native postinstall — otherwise pnpm 11 either hard-fails with
  `ERR_PNPM_IGNORED_BUILDS` (per root `INSIGHTS.md`) or auto-generates a
  placeholder `pnpm-workspace.yaml` with `esbuild: set this to true or false`
  that still blocks the build and leaves diff noise to clean up. Keep the
  (now-inert) `package.json` "pnpm" field too, for readability/consistency
  with `evals/package.json` — it's harmless, just not load-bearing.

## What Doesn't Work

- **Do NOT assume the `"zod": ["./node_modules/zod"]` tsconfig `paths`
  override (copied from `reviewer-core/tsconfig.json`) is load-bearing for
  `tsc --noEmit` to pass** — empirically verified (removed it from
  `runner/tsconfig.json` and re-ran `tsc --noEmit`: zero errors, exit 0,
  identical to with it). The override is still worth KEEPING (mirrors the
  established, working pattern; guards against a future divergent `zod`
  version landing in `server/node_modules` vs this package's own, which is
  exactly the shape of the documented drizzle-orm nominal-clash bug in root
  `INSIGHTS.md` — that failure mode is real for drizzle and plausible for
  zod, just not reproduced in THIS repo's current dependency graph). Record
  this so a future session doesn't either (a) assume removing it is safe
  because "it typechecks fine without it" in today's snapshot, or (b) assume
  it's mysteriously required and spend time re-deriving a wrong theory for
  why — it wasn't reproduced, it's defense-in-depth.
- **`vitest` does NOT read `tsconfig.json`'s `paths` on its own** — a
  colocated `src/*.test.ts` file that imports `@devdigest/shared` or
  `@devdigest/reviewer-core` directly (not through the built `dist/*.mjs`)
  fails with `Failed to load url @devdigest/shared ... Does the file exist?`
  unless `vitest.config.ts` also declares `resolve.alias` for those
  specifiers (Vite's own resolver, independent of `tsc`) — same requirement
  `reviewer-core/vitest.config.ts` already has. `tsc --noEmit` passing is NOT
  a signal that `vitest run` will resolve the same bare specifiers.

- **`build.mjs`'s esbuild config (`format: 'esm', platform: 'node'`) with no `banner` shim crashes the FIRST time real (non-mocked) code touches a bundled CJS dependency that calls `require(...)` at runtime** — hit for real on a live GitHub Actions run: `new OpenRouterProvider(apiKey)` pulls in the `openai` SDK's `node-fetch@2.7.0` fallback dependency, whose module top-level does `require('stream')`; esbuild's own injected `__require` shim throws `Error: Dynamic require of "stream" is not supported` because true ESM has no `require`. The bundle-parse smoke test (`test/runner.smoke.test.ts`) never catches this because it injects mocked `createGitHubClient`/`createLlm` deps — the real `OpenRouterProvider`/`RunnerGitHubClient` constructors, and thus this code path, are never exercised by any hermetic test. **Fix:** add `banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }` to the `build()` call — this makes the shim's `typeof require !== "undefined"` check succeed instead of throwing, and Node builtins (`stream`, etc.) still resolve natively with no `npm install` needed, preserving the dependency-free committed bundle. Verified by importing the rebuilt `dist/runner.mjs` and calling `run()` with dummy (non-network-valid) credentials and no `deps` override — before the fix it throws at LLM-client construction; after, it reaches the real GitHub API call and fails there instead (401 on the dummy token). **Takeaway for future esbuild+ESM+Node bundles in this repo:** the smoke test only proves the bundle *parses*; it does NOT prove every real (non-DI'd) construction path inside it actually *runs* — a bundle that imports() cleanly can still crash the moment it exercises a bundled CJS dependency's own `require`.

## Codebase Patterns

- **The "bundle-parse smoke test" (T2's stated acceptance) is most useful
  when it imports the ACTUAL BUILT `dist/*.mjs`, not the TypeScript source**
  — the whole point is to catch bundler-introduced breakage (dead-code
  elimination, ESM/CJS interop with a bundled SDK like `openai`) that a
  source-only test can't see. Put that test under `test/` (not `src/`) so it
  sits OUTSIDE `tsconfig.json`'s `"include": ["src/**/*.ts"]` — same
  convention `reviewer-core/test/` already uses (reviewer-core `INSIGHTS.md`)
  — because `tsc --noEmit` has no type declarations for a plain esbuild
  `.mjs` output and would otherwise fail on `import '../dist/runner.mjs'`.
  Remember to also add `test/**/*.test.ts` to `vitest.config.ts`'s `test.include`
  (it only lists `src/**/*.test.ts` by default) or the smoke test silently
  never runs.
- **Design the orchestration entrypoint (`run(argv, env, deps)`) with
  dependency-injected GitHub/LLM clients from the start** when the acceptance
  criteria require testing against the BUILT bundle with mocks and no
  network/keys — there's no other way to inject a fake `GitHubClient`/
  `LLMProvider` into an already-bundled file's internal `new
  RunnerGitHubClient(...)`/`new OpenRouterProvider(...)` calls except by
  making the constructors themselves swappable via an optional `deps`
  parameter that defaults to the real implementations. Guard the actual
  `process.exit()` behind `if (import.meta.url === \`file://${process.argv[1]}\`)`
  so importing `run` (from source OR the bundled `dist/*.mjs`) in a test never
  triggers it.

## Tool & Library Notes

- **`cd evals && node_modules/.bin/vitest run workflow` (the CLAUDE.md-change
  eval) is NOT hermetic** — it spawns real nested Claude Code sessions
  (`@anthropic-ai/claude-agent-sdk`) against THIS actual working tree (not a
  sandboxed fixture copy; the eval's own file reads/writes real repo paths).
  One case in `evals/workflow/review-workflow.cases.ts` ("engineering-insights
  activates on a genuine discovery") deliberately exercises the
  `engineering-insights` skill with a FICTIONAL prompt (a scripted pgvector
  dimension-mismatch story) and really does append that fabricated entry to
  the real `server/INSIGHTS.md` as a side effect of passing. After running
  this eval, diff the INSIGHTS.md files it touched and manually strip any
  eval-fabricated entries before finishing — don't let synthetic eval-test
  content ship as if it were a real discovery from your own session. Took
  ~127s wall-clock across 5 nested sessions for the 5 cases.

## Open Questions

- The real (non-mock) GitHub Actions "runtime API" artifact-upload protocol
  implemented in `src/artifact.ts` (`_apis/pipelines/workflows/{runId}/
  artifacts`, the legacy `actions_storage` create→PUT→PATCH flow) is
  UNVERIFIED against a live Actions run in this session — no CI job was
  actually exercised, only the "env vars absent → no-op" path (hermetic
  tests never set `ACTIONS_RUNTIME_URL`/`ACTIONS_RUNTIME_TOKEN`/`GITHUB_RUN_ID`).
  Whoever wires the real generated workflow (T5) and runs it for the first
  time in a real repo should confirm the artifact actually lands and is
  downloadable by the studio's `downloadRunArtifact` (T3) — treat this
  upload path as best-effort/unverified until then; it is deliberately
  wrapped so a failure here never changes the runner's exit code.
