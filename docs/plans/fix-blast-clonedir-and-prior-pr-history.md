# Plan: Fix MCP blast-radius `no_data` (clone-dir mismatch) and the always-the-same "Prior PRs" bug (shallow clone)

## Understanding
Two confirmed, independent bugs, both rooted in how DevDigest locates and populates the local git clone:

- **Bug 1 — MCP `devdigest_get_blast_radius` returns empty (`degraded:true, reason:'no_data'`, 0 symbols) while the web UI shows real symbols for the same PR.** Both the UI and the MCP tool call the *same* `BlastService.getBlast`. The only difference is the resolved clone directory. The blast read path locates the clone by **re-deriving** it from `config.cloneDir` at read time (`clonePathFor = join(cloneDir, owner, name)`), and `config.cloneDir` is resolved against `process.cwd()` and `.env` loaded from cwd. The API runs with `cwd=server/` (its `.env` sets `DEVDIGEST_CLONE_DIR=./clones`), so it finds the clone; the MCP process runs with `cwd=mcp/`, has no `.env`, and `.mcp.json` passes only `DATABASE_URL`, so `DEVDIGEST_CLONE_DIR` is unset and `cloneDir` falls back to the (non-existent) `~/.devdigest/workspace` → the directory walk finds nothing → `no_data`. The deeper fragility: the clone location is defined two ways that can disagree — the absolute `repos.clone_path` persisted at clone time vs. the cwd-relative `config.cloneDir` recomputed at read time — and even the *defaults* differ (`./clones` in `.env`/README vs. `~/.devdigest/workspace` in code).

- **Bug 2 — "Prior PRs touching these files" always shows the same PR (#27634) for every PR.** The history logic is correct, but the clone is created with `CLONE_DEPTH = 1` (shallow, HEAD-only). `HistoryService.getPriorPrs` computes prior PRs from `git log --follow -- <file>` on the local clone, so with only the HEAD commit present, every file's log returns exactly the single HEAD commit (`0d164da … (#27634)`), which is then surfaced as the one and only "prior PR" for every PR.

The goal is a grounded, approval-ready fix for each: pick the least-fragile option that respects DevDigest's conventions (schema-first routes, append-only migrations, **no edits to vendored `src/vendor/**`**, no machine-specific paths committed to a course repo).

## Context loaded
- Root `CLAUDE.md` (auto-loaded), root `INSIGHTS.md`, `server/CLAUDE.md`, `mcp/CLAUDE.md`, `server/INSIGHTS.md`.
- Skill: `.claude/skills/backend-onion-architecture/SKILL.md` — confirms ports/interfaces live in vendored `@devdigest/shared` (framework-free) and adapters/composition are infrastructure. This is decisive: the do-not-touch-vendor rule means a port *signature* change is off-limits, so each bug's "change the interface" variant is rejected in favor of a fix that stays inside an adapter / the composition root. (Did not load `fastify-best-practices`/`drizzle-orm-patterns`/`zod` — no route schema, query, or contract change is required.)
- Bug 1 source: `server/src/adapters/codeindex/ripgrep.ts:43-126` (root via `this.git.clonePathFor(repo)`); `server/src/adapters/git/simple-git.ts:37-39` (`clonePathFor = join(cloneDir, owner, name)`); `server/src/platform/config.ts:1,64-80` (`import 'dotenv/config'`, cwd-relative resolution, `~/.devdigest/workspace` default); `server/src/platform/container.ts:89-107` (`git`/`codeIndex` both built from `config.cloneDir`); `server/src/modules/blast/service.ts:110-131`; `server/src/modules/repo-intel/service.ts:302-386` (ripgrep fallback path that produced the empirical `no_data`) and `:397-421` (`tryPersistentBlast` returns `null` when the index isn't built → falls through to the clone-dependent path); `server/src/modules/repo-intel/repository.ts:59-64,136-147` (`RepoBasics.clonePath` already loaded); `mcp/bin/devdigest-mcp.mjs:14-18` (pins `cwd=mcp/`); `mcp/src/bootstrap.ts:48-60`; `mcp/src/tools/get-blast-radius.ts:37-49`; `mcp/src/resolvers.ts:79-92`; `.mcp.json` (passes only `DATABASE_URL`); `server/.env.example:28` (`DEVDIGEST_CLONE_DIR=./clones`); `server/README.md:99` (documents default as `./clones`); `.gitignore` (`.env`, `.env.local`, `clones/` all ignored).
- Bug 2 source: `server/src/modules/repos/constants.ts:9` (`CLONE_DEPTH = 1`); `server/src/modules/repos/service.ts:51-63` (`runCloneJob` passes `{ depth: CLONE_DEPTH }`); `server/src/adapters/git/simple-git.ts:18-20,54-70,77-88,149-157` (`RESYNC_FETCH_DEPTH=50` for `sync()` only; `clone()` honors `opts.depth`; `log()` is the history source); `server/src/modules/history/service.ts:57-103,112-161` (`buildPriorPrs` already filters `n === ownPrNumber`; per-file `git log` loop). Confirmed `git.log(...)` has exactly one caller — `HistoryService` (`history/service.ts:144`).
- The do-not-touch port interfaces: `CodeIndex` at `server/src/vendor/shared/adapters.ts:263-267` and `GitClient` at `:240` — both vendored.

## Approach & tradeoffs

### Bug 1 — make clone-dir resolution process-independent (RECOMMENDED: Option C)

Both `SimpleGitClient` and `RipgrepCodeIndex` derive the clone root from the single value `config.cloneDir` (container.ts:91 + 105). So a one-place fix in `config.ts` corrects every clone-dependent read path (symbols, references, `git.log`, `readFile`) for **both** the API and the MCP process at once.

- **Option A — minimal/config (give MCP the same `DEVDIGEST_CLONE_DIR`).** Add `mcp/.env` or pass `DEVDIGEST_CLONE_DIR` via `.mcp.json`/bootstrap.
  - *Rejected.* `.env` is git-ignored, so an `mcp/.env` is per-machine and every developer must remember to create it (fragile, re-introduces the same class of bug). Putting the value in committed `.mcp.json` means hard-coding a machine-specific absolute clone path into a course repo (the prompt explicitly warns against this; `.mcp.json` already carries one machine-specific absolute path in `args`, and we should not add another). It also leaves the default-divergence (`./clones` vs `~/.devdigest/workspace`) unfixed and would silently break again for any future non-`server/` cwd.
- **Option B — robust/source-of-truth (read the persisted absolute `repos.clone_path`).** Have the blast/repo-intel read path use `repo.clonePath` (already loaded as `RepoBasics.clonePath`) instead of re-deriving via `clonePathFor`.
  - *Rejected as primary.* Conceptually the most correct (the persisted absolute path is the true source of truth), **but its clean form requires changing the `CodeIndex` port** — `symbols(repo)`/`references(repo, sym)` take a `RepoRef`, not a path, and that interface lives in the **vendored** `server/src/vendor/shared/adapters.ts:263-267`, which the hard constraints forbid editing. The only constraint-respecting variants are invasive (duplicate the adapter's clone walk inside the service, or reach the DB from the adapter — a layering violation) and still wouldn't fix `git.log`/`readFile`, which re-derive via `clonePathFor` too. High cost, partial coverage.
- **Option C — make `config.cloneDir` resolution process-independent (RECOMMENDED).** In `config.ts`, resolve a relative `DEVDIGEST_CLONE_DIR` against a **stable anchor (the `server/` package dir, via `import.meta.url`)** instead of `process.cwd()`, and change the default from `~/.devdigest/workspace` to `<server>/clones`.
  - *Chosen.* (1) Fixes the root fragility — every process that imports `config.ts` (API at `cwd=server`, MCP at `cwd=mcp`, any future cwd) computes the **same** `cloneDir` with no env at all, because `import.meta.url` always points at `server/src/platform/config.ts`. (2) Edits exactly one source file (plus doc/comment touch-ups); **no** vendored edits, **no** new port methods, **no** migration. (3) Keeps every existing persisted `repos.clone_path` valid: the API today resolves `./clones` against `cwd=server` → `<server>/clones`, and the anchored resolution yields the same `<server>/clones`, so already-cloned repos keep working with zero re-clone. (4) No machine-specific path committed. (5) Aligns the code default with the already-documented `./clones` (`server/.env.example:28`, `server/README.md:99`), removing the silent default-divergence. The one behavioral nuance: a relative `DEVDIGEST_CLONE_DIR` is now anchored to `server/` rather than the caller's cwd — but the documented workflow always runs inside the package (`cd server && pnpm …`), where the resolved path is unchanged, so there is no practical regression. (An absolute `DEVDIGEST_CLONE_DIR` is still honored verbatim.)

> Note on the secondary edge (out of scope, see below): even with the clone dir fixed, a PR imported only via the *list* endpoint has empty `pr_files` (only the UI's `GET /pulls/:id` detail-load populates `pr_files`; `mcp/src/resolvers.ts:79-92` does not), so its blast/history stay empty. The user's reported example (#28926, 8 files) was purely the clone-dir bug, so this is a separate, optional follow-up — flagged, not fixed here.

### Bug 2 — give history real depth (RECOMMENDED: Option C — deepen-on-demand when shallow)

> **DECISION (post-approval):** use a **bounded** deepen — `git fetch --shallow-since="2 years ago"` — instead of a full `--unshallow`. Rationale: cal.com is a huge monorepo and a full unshallow on the first History view would pull the entire branch history; ~2 years covers the prior PRs that matter at far lower cost. The clone stays shallow (with a deeper boundary), so the per-process `deepened` cache is load-bearing (a `--shallow-since` clone still reports `is-shallow-repository = true`, so without the cache every call would re-fetch). Window is hardcoded to "2 years ago" (not env-configurable, per the chosen option).

`HistoryService` is the *only* caller of `git.log` (history/service.ts:144), so a fix targeted at the history path has a tiny blast radius and cannot affect reviews.

- **Option A — increase `CLONE_DEPTH`.** Bump the constant (e.g. to 50, or 0/full).
  - *Rejected as primary.* `--depth N` truncates **branch** history, not per-file history; on a busy monorepo (cal.com) a modest N covers only days of commits, so `git log --follow -- <file>` may still find few/zero prior PRs for a specific file. A large N / full clone makes **every** import heavy even though the review hot path never needs deep history. Worst of all, it does **not** self-heal the repos already cloned at depth 1 (the live cal.diy clone is already shallow) — they would stay broken until a manual Refresh/re-clone, exactly the backfill gotcha documented for `default_branch` in `server/INSIGHTS.md`.
- **Option B — eagerly unshallow after clone.** Run `git fetch --unshallow` at the end of `runCloneJob`.
  - *Rejected.* Same "heavy on every import" cost as a full clone, and still doesn't help already-shallow repos without a re-clone.
- **Option C — detect-shallow and deepen lazily, on the history path (RECOMMENDED).** Keep `CLONE_DEPTH = 1` (fast imports, unchanged review path). The first time `SimpleGitClient.log()` runs for a repo, check `git rev-parse --is-shallow-repository`; if shallow, run a one-time `git fetch --unshallow` (cached per clone in-memory so the 25-file history loop and subsequent requests don't re-fetch), then run the log.
  - *Chosen.* (1) **Self-heals existing shallow clones** — the live cal.diy clone gets full history on the next "Prior PRs" view, with no re-clone. (2) Keeps repo import fast and offline-friendly; the deepen cost is paid only when a user actually opens History. (3) Gives **complete** per-file history (`--unshallow` = full branch history), so prior-PR results are correct on monorepos, not just "more than one." (4) Lives entirely inside the existing `SimpleGitClient.log()` adapter method — an infrastructure detail with **no** port-signature change (so no vendored edit; adding an `unshallow` method to the vendored `GitClient` interface is forbidden) and **no** change to `MockGitClient` (its `log()` is unaffected). (5) Degrades safely: if the deepen fetch fails (offline / private-repo with no embedded creds), the existing `HistoryService` try/catch returns `{ history: [] }` rather than a 500 — same failure mode as today, never worse. Behavioral notes for the approver: the **first** History call per repo now requires network and may be slow on a large monorepo (one-time; cached after); and on a **private** repo the unshallow can fail because credentials are only embedded into the remote at clone time (history then degrades to empty — acceptable, and the public demo repo is unaffected).
  - *Minor correctness nuance (low priority):* `buildPriorPrs` already skips the PR's own number (`history/service.ts:68`), but the base-branch HEAD commit can still appear as a "prior PR" if it genuinely touched one of the changed files — which after deepening is correct behavior, not a bug, so no extra base/self filtering is included. Called out so the approver can opt to filter the base HEAD if desired.

## Implementation steps

### Bug 1 (Option C) — anchor clone-dir resolution to the server package dir

1. **Add path/url helpers and a stable server-root anchor** — `server/src/platform/config.ts`
   - Change type: modify
   - What: extend the `node:path` import to include `dirname` (line 4: `import { join, isAbsolute, resolve, dirname } from 'node:path';`) and add `import { fileURLToPath } from 'node:url';`. After the imports, add a module-level constant:
     ```ts
     /** Absolute path to the server package root — stable regardless of process cwd
      *  (config.ts lives at server/src/platform/, so go up two levels). */
     const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
     ```
   - Verify: `node_modules/.bin/tsc --noEmit` (run in `server/`) passes; `SERVER_ROOT` ends with `/server`.

2. **Resolve `DEVDIGEST_CLONE_DIR` against the anchor and align the default** — `server/src/platform/config.ts:64-68`
   - Change type: modify
   - What: replace the two `cloneDir` lines inside `loadConfig` with:
     ```ts
     const cloneDirRaw = parsed.DEVDIGEST_CLONE_DIR ?? 'clones';
     const cloneDir = isAbsolute(cloneDirRaw)
       ? cloneDirRaw
       : resolve(SERVER_ROOT, cloneDirRaw);
     ```
     This drops the cwd dependence (`process.cwd()` → `SERVER_ROOT`) and changes the default from `~/.devdigest/workspace` to `<server>/clones`. (`homedir` is still used by `secretsPath`, so its import stays.) Also update the `cloneDir` doc comment at `:45` from "`~/.devdigest/workspace` by default" to "`<server>/clones` by default; relative `DEVDIGEST_CLONE_DIR` is anchored to the server package dir, not cwd".
   - Verify: from `server/`, `loadConfig({}).cloneDir` is absolute and ends with `server/clones`; with `DEVDIGEST_CLONE_DIR=/abs/x` it returns `/abs/x` verbatim; the value no longer changes when `process.chdir()` changes.

3. **Add a hermetic config unit test for cwd-independence** — `server/test/config.test.ts`
   - Change type: add (create if absent; co-locate with the other `server/test/*.test.ts` files — this is not DB-backed, so **no** `.it.test.ts` suffix)
   - What: assert (a) `loadConfig({}).cloneDir` is absolute and ends with `path.join('server','clones')`; (b) a relative `DEVDIGEST_CLONE_DIR: 'foo'` resolves to `…/server/foo`; (c) an absolute `DEVDIGEST_CLONE_DIR` is returned unchanged; (d) the resolved `cloneDir` is identical before and after a `process.chdir(os.tmpdir())` (restore cwd in `finally`) — this is the regression guard for the MCP-vs-API divergence.
   - Verify: `node_modules/.bin/vitest run test/config.test.ts` (in `server/`) is green.

4. **Optional doc clarification** — `server/.env.example:28`
   - Change type: modify (optional)
   - What: add an inline comment that a relative `DEVDIGEST_CLONE_DIR` anchors to the `server/` package dir (not cwd) and that the default is `clones`. (`server/README.md:99` already states the `./clones` default and now becomes accurate — no change required there.)
   - Verify: comment reads correctly; no functional impact.

### Bug 2 (Option C) — deepen the clone on first history read when it is shallow

5. **Add a per-process "already deepened" cache to the git adapter** — `server/src/adapters/git/simple-git.ts` (class `SimpleGitClient`, near the fields after the constructor, ~line 35)
   - Change type: modify
   - What: add a private field `private deepened = new Set<string>();` to remember clones whose history is already full this process (keyed by absolute clone path), so the 25-file history loop and subsequent requests don't re-fetch.
   - Verify: `tsc --noEmit` passes.

6. **Add an `ensureHistory` helper and call it from `log()`** — `server/src/adapters/git/simple-git.ts:149-157`
   - Change type: modify
   - What: add a private method and invoke it at the top of `log()`:
     ```ts
     /**
      * Repos are cloned shallow (CLONE_DEPTH=1) to keep imports fast, but the
      * "Prior PRs" history feature needs real depth. The first time we read the
      * log for a shallow clone, deepen it once to HISTORY_DEEPEN_SINCE (cached per
      * clone for this process — a --shallow-since clone is STILL shallow, so the
      * cache is what stops every call re-fetching). Requires network for the
      * one-time deepen; HistoryService already degrades to an empty result on any
      * git error, so offline/auth failure is non-fatal (and not cached, so a later
      * online request can retry).
      */
     private async ensureHistory(repo: RepoRef): Promise<void> {
       const dest = this.clonePathFor(repo);
       if (this.deepened.has(dest)) return;
       const g = simpleGit(dest);
       const shallow = (await g.raw(['rev-parse', '--is-shallow-repository'])).trim();
       if (shallow === 'true') {
         // Bounded deepen — avoids pulling full history of huge monorepos.
         await g.raw(['fetch', `--shallow-since=${HISTORY_DEEPEN_SINCE}`]); // throws → not cached → retried next request
       }
       this.deepened.add(dest);
     }

     async log(repo: RepoRef, path?: string): Promise<GitCommit[]> {
       await this.ensureHistory(repo);
       const log = await this.git(repo).log(path ? { file: path } : undefined);
       return log.all.map((c) => ({
         sha: c.hash, message: c.message, author: c.author_name, date: c.date,
       }));
     }
     ```
   - Verify: `tsc --noEmit` passes; existing `MockGitClient` (`server/src/adapters/mocks.ts`) is untouched and its `log()` keeps working (no interface change).

7. **Add a regression test using a local file remote (no network, no Docker)** — `server/test/simple-git-history.test.ts`
   - Change type: add
   - What: in a tmp dir, `git init` a source repo, create commits with subjects like `feat: a (#101)`, `feat: b (#102)`, `feat: c (#103)` all touching `file.ts`, then `git clone --depth 1 file://<src> <dest>`. Construct `new SimpleGitClient(<dirname(dest)>)` with `{owner,name}` matching `dest`'s layout (or point `cloneDir` so `clonePathFor` resolves to `<dest>`), call `.log(ref, 'file.ts')`, and assert it returns all 3 commits (proving the unshallow happened) and that a second call is served without re-fetching. Optionally assert `git -C <dest> rev-list --count HEAD` > 1 afterward. (Real `git` is available in the sandbox; this needs no Postgres, so no `.it.test.ts` suffix.)
   - Verify: `node_modules/.bin/vitest run test/simple-git-history.test.ts` (in `server/`) is green.

## Acceptance criteria

Run these from a single working tree with Postgres up (`docker compose up -d`) and the demo/cal.diy repo already imported (so a clone exists under `server/clones/<owner>/<name>`).

1. **Both packages typecheck and unit tests pass.**
   - `cd server && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run --exclude '**/*.it.test.ts'`
   - `cd mcp && node_modules/.bin/tsc --noEmit`
   - Expected: green, including the new `config.test.ts` and `simple-git-history.test.ts`.

2. **Bug 1 — MCP blast now matches the API.** With the API running (`cd server && pnpm dev`), capture the UI/API answer and the MCP answer for the same PRs and confirm they agree:
   - API: `curl -s localhost:3001/pulls/<prId>/blast | jq '{symbols: .totals.symbols, callers: .totals.callers, degraded, reason}'` for PRs #29557, #28926, #29672.
   - MCP: call `devdigest_get_blast_radius` with `pr` = `calcom/cal.diy#28926` (etc.) from an MCP client, or run the tool's bootstrap from `cwd=mcp/` with no `DEVDIGEST_CLONE_DIR` set.
   - Expected: MCP returns the same non-empty symbol/caller counts as the API (≈ #29557→2 symbols, #28926→70 symbols/255 callers, #29672→18 symbols) and **no longer** `degraded:true, reason:'no_data'`. Sanity: `node -e "process.chdir('mcp'); import('./server/src/platform/config.js').then(m=>console.log(m.loadConfig({}).cloneDir))"` (or an equivalent in-repo check) prints `…/server/clones` regardless of cwd.

3. **Bug 2 — Prior PRs differ per PR and are correct.** First call deepens the clone:
   - `curl -s localhost:3001/pulls/<prId-of-#29557>/prior-prs | jq '.history[].pr_number'`
   - `curl -s localhost:3001/pulls/<prId-of-#28926>/prior-prs | jq '.history[].pr_number'`
   - Expected: the two PRs return **different** prior-PR lists (no longer both just `#27634`), each scoped to PRs that actually touched the respective changed files. Verify the clone deepened: `git -C server/clones/<owner>/<name> rev-list --count HEAD` is now > 1 (was 1).

4. **No regression to imports/reviews.** Re-import or refresh a repo and run a review; clone import stays fast (still `--depth 1`) and existing persisted `repos.clone_path` rows still resolve (blast/review unaffected). DB-backed suites still pass where Docker is available: `cd server && TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run .it.test`.

## Risks / out of scope / open questions

- **Risks:**
  - *Relative-path semantics change (Bug 1).* A relative `DEVDIGEST_CLONE_DIR` now anchors to `server/`, not the caller's cwd. For the documented workflow (`cd server && …`) the resolved path is identical, but anyone who previously ran the API from a different cwd relying on cwd-relative resolution would see a different path. Mitigation: documented in the `.env.example` comment + the `config.ts` doc comment; absolute paths are unaffected.
  - *First history call needs network and can be slow (Bug 2).* The one-time `--unshallow` on a large monorepo may take seconds; it is cached per clone afterward. On a private repo it can fail (creds are only embedded at clone time) — history then degrades to `{ history: [] }`, same as today's failure mode, never a 500. On persistent offline failure the deepen is retried per request (and per file within a request, since failures aren't cached) — bounded and only in the failure path.
  - *Vendored constraint honored.* No change to `server/src/vendor/shared/adapters.ts` (the `CodeIndex`/`GitClient` ports). Both fixes stay inside the composition/config (`config.ts`) and the concrete adapter (`simple-git.ts`).
  - *Index-built case.* When the persistent index *is* built, `tryPersistentBlast` already serves from Postgres independent of the clone dir; Option C does not change that path, only the clone-dependent fallback (the one that produced the empirical `no_data`).

- **Out of scope:**
  - The `pr_files`-empty secondary edge (PRs imported via the MCP/list path never populate `pr_files`, so blast/history stay empty even with the clone dir fixed — e.g. #29677 with 0 files). The user's #28926 case was purely the clone-dir bug. A proper fix would have `mcp/src/resolvers.ts:resolvePull` (or a server service) backfill `pr_files` from GitHub like the UI's `GET /pulls/:id` detail-load (`pulls/routes.ts:227-241`) — tracked as a separate follow-up.
  - Filtering the base-branch HEAD / the PR's own commits out of prior-PRs beyond the existing `ownPrNumber` skip (correct-by-design after deepening; optional).
  - Any change to `CLONE_DEPTH` itself or to the review/index pipelines.

- **Open questions / assumptions:**
  - Assumed every process that needs the clone imports `config.ts` (verified: API container.ts:91/105 and MCP bootstrap.ts both go through `loadConfig`). If a future process bypasses `loadConfig`, it would need the same anchoring.
  - Assumed `git rev-parse --is-shallow-repository` (git ≥ 2.15) is available in all target environments; if an older git must be supported, fall back to checking for a `.git/shallow` file.
  - Assumed the regression test may spawn real `git` in the sandbox (used elsewhere via simple-git). If CI forbids spawning git in unit tests, downgrade step 7 to a `.it.test.ts` or a manual verification per the Acceptance section.
  - Assumed `unshallow` is the desired depth for history correctness; if import/runtime cost on huge monorepos is a concern, the approver may swap `--unshallow` for a bounded `git fetch --shallow-since="2 years ago"` in step 6 (same structure, less complete history).
