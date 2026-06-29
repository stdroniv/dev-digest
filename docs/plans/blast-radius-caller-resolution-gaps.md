# Plan: Blast Radius — caller-resolution gaps on monorepo PRs

> Third follow-up after `docs/plans/blast-radius-fixes.md` and
> `docs/plans/blast-radius-zero-data-and-pr-score.md` (both shipped, uncommitted:
> Next.js-endpoint extraction, self-fact attribution, score badge, empty-graph,
> honest-copy). This plan does NOT re-plan those. It fixes the deeper bug those
> passes exposed: symbols with **real** callers still show "0 callers" on monorepo
> PRs (calcom/cal.diy #29558: `getAppCategories()`, `getHref()`,
> `IntegrationsContainer()`, `InstalledApps()` all 0 callers; index `full`, no
> degraded/partial badge), because caller resolution depends entirely on
> `file_edges`, which dependency-cruiser cannot build for cross-package/aliased
> imports.

## Understanding
Caller resolution flows: `parseReferences` records call/JSX sites →
`references(from_path, to_symbol, line)`; `resolveReferences`
(`server/src/modules/repo-intel/repository.ts:400-425`) sets `references.decl_file`
ONLY when an import edge exists AND the candidate is unique; `getResolvedCallers`
(`repository.ts:503-531`) returns references where `decl_file ∈ changedFiles`. So
`file_edges` is the single point of failure. `file_edges` is built by
dependency-cruiser (`server/src/adapters/depgraph/index.ts`), which silently drops
`couldNotResolve` deps (`depgraph/index.ts:85`) and returns `[]` on any crash; the
indexer still stamps `full` because relative imports DO resolve (non-empty graph).
On a monorepo, cross-package (`@calcom/*`) and app-alias (`~/`) imports never
resolve, so callers vanish with no honest signal. Secondary: `parseReferences`
(`server/src/adapters/astgrep/index.ts:402-462`) captures only call/`new`/JSX
sites — never type usages — so type/interface symbols can never show consumers.
This plan ships four independently-deliverable fixes, ordered quick-win → durable
fix → type-ref extension → honesty signal.

## Context loaded
- Root `INSIGHTS.md` — run package-local `node_modules/.bin/{tsc,vitest}` (pnpm
  wrappers hard-fail an install precheck); `.it.test.ts` needs
  `TESTCONTAINERS_RYUK_DISABLED=true`; `src/vendor/**` is do-not-touch; vendored
  shared contracts are hand-edited per package.
- `server/INSIGHTS.md` — the "0 endpoints/cron Next.js" two-gap note (already
  fixed by the prior pass); the `shapeBlastResponse`/`capCallersPerSymbol`
  "export the pure bit for a hermetic test" seam; `dependency-cruiser@17.4.3` is
  already a server dep; `BlastResponse` is local (not vendored) and edited per
  package; `noUncheckedIndexedAccess` is on (use `!`/`?? []`); regex-in-comment
  `*/` and `\\.` escaping gotchas.
- `client/INSIGHTS.md` — the `BlastIndexStatus` dual-`IndexStatus` clash (use the
  local alias, never the shared contract type); the `isEmpty = !data ||
  totals.symbols === 0` gating that must NOT regress; RTL rules for this package
  (no `@testing-library/user-event` → `fireEvent`; `getAllByText` for dup text;
  `getNodeText` reads direct text nodes only; icon names must exist in the
  registry).
- `server/CLAUDE.md`, `client/CLAUDE.md` — schema-first routes, append-only
  migrations, i18n strings in `messages/`.
- Source read & line-verified: `repo-intel/repository.ts`
  (`resolveReferences:400-425`, `getResolvedCallers:503-531`,
  `getFileFacts:534-549`, `replaceEdges:351-358`), `repo-intel/service.ts`
  (`tryPersistentBlast:336-412`, `capCallersPerSymbol:107-120`), `adapters/
  depgraph/index.ts` (`buildEdges:56-105`, tsconfig at `:62`, drop at `:85`),
  `adapters/astgrep/index.ts` (`parseReferences:402-462`, `parseImports:558-591`),
  `pipeline/full.ts` (parse phase `:128-199`, graph block `:208-248`),
  `pipeline/incremental.ts` (slice `:138-208`, graph block `:210-239`),
  `pipeline/walk.ts` (node_modules excluded `:92-94`), `constants.ts`
  (`INDEXER_VERSION=2:39`, `SUPPORTED_EXT:14`), `modules/blast/service.ts`
  (`shapeBlastResponse:30-107`), `modules/blast/types.ts`, `repo-intel/types.ts`
  (`BlastResult:74-87`), `db/schema/context.ts` (`references.declFile:107`),
  `client/src/lib/types.ts:44-104`, `client/.../BlastRadius/BlastRadius.tsx`,
  `client/messages/en/blast.json`; tests `test/indexer-pipeline.test.ts`,
  `test/astgrep.test.ts`, `src/modules/blast/service.test.ts`,
  `test/extract.test.ts`.
- Skills matched (read NONE in full — the two `INSIGHTS.md` files already encode
  the package-specific rules that govern these edits): `drizzle-orm-patterns` (new
  read-only count/group-by queries; no migration), `backend-onion-architecture`
  (resolver stays a pure pipeline helper, edges stay in repo-intel, shaping stays
  pure — no layering change), `postgresql-table-design` (no schema change — reuse
  existing `references`/`file_edges`/`symbols` indexes).

## Approach & tradeoffs

**#1 — name-unique fallback (read-time, no reindex).** When edge-based resolution
yields zero callers for a changed symbol whose name is exported by EXACTLY ONE
file in the repo (= the changed file), attribute that name's `references` (from
other files) as callers. This relies on `references` rows existing regardless of
`decl_file` (they're inserted unresolved, then `resolveReferences` only *patches*
`decl_file`), so it needs no reindex. Globally-unique names (`getAppCategories`)
light up immediately; ambiguous names (`getHref`, exported by ≥2 files) stay
dropped — precision-over-recall preserved. **Precision guard chosen:** (a) only
names exported by exactly one file repo-wide; (b) skip references from a caller
file that itself *locally declares* a symbol of that name (defends the one
false-positive vector — a same-named local in the caller file). Rejected
alternative: attribute any unresolved reference by bare name match — that would
re-introduce the nearest-name guessing `resolveReferences` deliberately avoids
(its `HAVING count(*) = 1` uniqueness contract). The merge of resolved + fallback
callers goes through a pure exported helper so it is hermetically testable.

**#2 — monorepo-aware import-edge builder (index-time, reindex).** Build
`file_edges` from the existing `parseImports` data through a PURE resolver, then
UNION with dependency-cruiser's edges (cruise is NOT removed — we only fill its
`couldNotResolve` gaps, so nothing that resolves today can regress). The resolver
`resolveImport(spec, fromFile, ctx) → relPath | null` is pure and unit-tested; the
context carries a workspace map (`@scope/pkg → dir`, from root `package.json`
`workspaces` + each package's `name`), tsconfig `paths`/`baseUrl` (root AND nearest
per-package, for app-local aliases like `~/`), and the indexed file set. It handles
relative imports (extension + `/index` probing), workspace package + subpath
imports, and alias paths, and degrades to `null` (never throws). Because the index
state delegates to a full reindex on `indexer_version` mismatch, bumping
`INDEXER_VERSION` is the clean trigger for every repo to rebuild edges. Rejected
alternative: install repo deps so cruise can follow `@scope/*` symlinks —
explicitly rejected (slow, network/disk, arbitrary postinstall).

**#3 — honest "limited cross-file resolution" signal (read-time).** Compute a
resolution ratio (`count(decl_file) / count(*)` over `references`) at the blast
read path and add a `resolution: { limited, reason }` flag to the LOCAL
`BlastResponse`, hand-mirrored in both copies, rendered as a DISTINCT frontend note
(not the degraded/partial badge — those mean "index incomplete", a different
thing). Prefer the no-migration path: the ratio is computed on read, not persisted.
Rejected: a new persisted column on `repo_index_state` — unnecessary, and a
migration for a derived read-time number.

**#4 — track type references (index-time, reindex; builds on #2).** Extend
`parseReferences` to also capture `type_identifier` usages (annotations,
`type_arguments`/generics, `extends`/`implements`) so type/interface symbols can
show consumers. Additive — existing dedup/decl-line/import guards are untouched.
These resolve through the same edge mechanism, so #4's cross-package value depends
on #2; relative-import type refs resolve immediately.

**Ordering (matches the suggested tiers).** Tier 1 = #1 (quick read-time win) →
Tier 2 = #2 (durable edge fix + `INDEXER_VERSION` bump) → Tier 3 = #4 (type refs,
builds on #2) → Tier 4 = #3 (honesty; read-time, independently shippable). Each
tier is independently deliverable.

## Implementation steps

### Tier 1 — #1: name-unique caller fallback (read-time, NO reindex)

1. **Add two read-only repository methods** — `server/src/modules/repo-intel/repository.ts`
   - Change type: add
   - What:
     - `getUniqueExportFiles(repoId: string, names: string[]): Promise<Array<{ name: string; path: string }>>`
       — names that are exported by EXACTLY ONE file repo-wide. Drizzle/SQL:
       restrict to `symbols.exported = true`, `name ∈ names`; `GROUP BY name`
       `HAVING count(DISTINCT path) = 1`; project `name` + the single `path`
       (`min(path)` is fine since the group has one path). Inline-empty guard
       (`if (names.length === 0) return []`) mirrors the other methods.
     - `getReferencesByNames(repoId: string, names: string[]): Promise<ResolvedCallerRow[]>`
       — the same shape/inner-join-to-`file_rank` as `getResolvedCallers`
       (`:503-531`) but WITHOUT the `decl_file ∈ declFiles` constraint: returns
       `{ fromPath, toSymbol, line, rank }` for every reference whose
       `to_symbol ∈ names`. Inner-joining `file_rank` keeps it consistent with the
       resolved path (only ranked caller files count) and gives the rank used for
       sorting/cap.
   - Verify: covered by the IT test in step 5 (DB-backed) + the pure-merge test in
     step 3. `cd server && node_modules/.bin/tsc --noEmit`.

2. **Keep `getResolvedCallers`' uniqueness/precision contract intact** — `server/src/modules/repo-intel/repository.ts`
   - Change type: (no edit) — explicit non-goal
   - What: do NOT touch `resolveReferences` (`:400-425`) or `getResolvedCallers`
     (`:503-531`). The fallback is layered in the service ON TOP of the resolved
     result, so the edge-resolved precision contract is preserved verbatim.
   - Verify: `git diff` shows no change to those two methods.

3. **Add the pure merge/dedup helper** — `server/src/modules/repo-intel/service.ts`
   - Change type: add
   - What: `export function mergeFallbackCallers(resolved: BlastCallerRow[], fallback: BlastCallerRow[]): BlastCallerRow[]`
     — concatenate `resolved` then `fallback`, dedup by key
     `${file}|${symbol}|${viaSymbol}` preserving FIRST occurrence (so an
     edge-resolved caller always wins over a fallback duplicate). Returns the
     deduped list in input order; sorting + capping stay the caller's job (mirrors
     the `capCallersPerSymbol` seam at `:107-120`). Module-scoped, exported for a
     Docker-free unit test.
   - Verify: new hermetic `server/test/repo-intel-fallback-merge.test.ts`
     importing `mergeFallbackCallers`: resolved+fallback with an overlapping
     `(file,symbol,viaSymbol)` → length de-dups to the resolved row; disjoint sets
     concatenate; empty fallback returns resolved unchanged. Run
     `cd server && node_modules/.bin/vitest run test/repo-intel-fallback-merge.test.ts`
     + `node_modules/.bin/tsc --noEmit`.

4. **Wire the fallback into `tryPersistentBlast`** — `server/src/modules/repo-intel/service.ts`
   - Change type: modify
   - What: after `callerRows = await this.repo.getResolvedCallers(...)` (`:363`):
     - `const resolvedNames = new Set(callerRows.map((c) => c.toSymbol));`
       `const missingNames = [...nameSet].filter((n) => !resolvedNames.has(n));`
     - If `missingNames.length`:
       `const uniq = await this.repo.getUniqueExportFiles(repoId, missingNames);`
       keep only names whose unique `path ∈ changedSet` (`new Set(changedFiles)`)
       → `safeNames`. Then
       `const fallbackRefs = await this.repo.getReferencesByNames(repoId, safeNames);`
     - Build `symsByFile` over the UNION of resolved + fallback caller files (one
       `getSymbolRows` call) so enclosing-symbol + the precision guard both read
       from the same map. **Precision guard:** when building a fallback
       `BlastCallerRow`, skip a ref whose `fromPath ∈ changedSet` (self-file) AND
       skip a ref whose `fromPath` locally declares a symbol named `toSymbol`
       (`symsByFile.get(fromPath)?.some((s) => s.name === toSymbol)`).
     - Compute resolved `callers` as today, compute `fallbackCallers` the same way,
       then `const callers = mergeFallbackCallers(resolvedCallers, fallbackCallers);`
       BEFORE the existing `callers.sort((a,b) => b.rank - a.rank)` and
       `capCallersPerSymbol(callers)` (`:393`, `:407`). The same-file guard in
       `shapeBlastResponse` (`blast/service.ts:37`) and `capCallersPerSymbol` cap
       stay untouched.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit`; behaviour covered by
     step 5's IT test.

5. **DB-backed regression test for the fallback** — `server/test/blast-name-unique-fallback.it.test.ts`
   - Change type: add
   - What: with testcontainers Postgres, seed a repo + `repo_index_state`
     (`status:'full'`, current `INDEXER_VERSION`) + `symbols`/`references`/`file_rank`
     such that: (a) a globally-unique exported `getAppCategories` declared in a
     changed file, with a `references` row from another file and `decl_file = NULL`
     (no edge) → assert the blast for that changed file now lists the cross-file
     caller; (b) an ambiguous `getHref` exported by TWO files, referenced
     elsewhere → assert it stays 0 callers (dropped); (c) a caller file that
     locally declares its own `getAppCategories` → assert that ref is NOT
     attributed (precision guard). Drive via `new BlastService(app.container)` or
     the facade `getBlastRadius` directly (mirror the seed-distinct-fullName rule
     in `server/INSIGHTS.md` to avoid the `repos_ws_fullname_uq` collision).
   - Verify:
     `cd server && TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run test/blast-name-unique-fallback.it.test.ts`.

### Tier 2 — #2: monorepo-aware import-edge builder (index-time; REQUIRES reindex)

6. **New pure resolver + context builder module** — `server/src/modules/repo-intel/pipeline/import-edges.ts`
   - Change type: add
   - What: export, all degrade-to-safe (never throw):
     - `interface ResolverContext { root: string; fileSet: ReadonlySet<string>; workspaces: Map<string, string>; /* @scope/pkg → repo-rel dir */ aliasDirs: Array<{ dir: string; baseUrl: string; paths: Record<string, string[]> }>; }`
     - `resolveImport(spec: string, fromFile: string, ctx: ResolverContext): string | null`
       — pure. Branches: (i) relative (`./`, `../`) → resolve against
       `dirname(fromFile)`, then `probe()`; (ii) workspace pkg / subpath: longest
       `workspaces` key that is `spec` or a `spec` prefix at a `/` boundary → map
       to its dir + remaining subpath (or the dir's `index`/`package.json main`),
       then `probe()`; (iii) alias: pick the nearest `aliasDirs` entry whose `dir`
       is a prefix of `fromFile`, match `paths` keys (supporting the trailing-`*`
       wildcard and `~/`/`@/`), substitute, resolve against `baseUrl`, `probe()`.
       Returns a repo-relative POSIX path that is in `fileSet`, else `null`.
     - `probe(candidateRel, ctx)` (internal): try the path as-is, then with each
       `SUPPORTED_EXT`, then `<candidate>/index.<ext>`; return the first that is in
       `ctx.fileSet`, else `null`.
     - `resolveImportEdges(imports: Array<{ fromFile: string; spec: string }>, ctx): FileEdge[]`
       — pure: map each through `resolveImport`, drop `null` + self-edges, dedup
       (`from to`). (Include type-only imports too — needed for #4 to resolve
       cross-package type refs.)
     - `unionEdges(a: FileEdge[], b: FileEdge[]): FileEdge[]` — pure deduped union
       (same key), `a` first.
     - `buildResolverContext(root: string, files: string[]): Promise<ResolverContext>`
       — read root `package.json` `workspaces` (array OR `{ packages: [] }`),
       expand each glob to dirs under `root`, read each package's `package.json`
       `name` → `workspaces` map; read root `tsconfig.json` + each package
       `tsconfig.json` `compilerOptions.{baseUrl,paths}` → `aliasDirs`. Each read
       wrapped in try/catch → degrade to empty. `fileSet = new Set(files)`.
     - `collectImports(root: string, files: string[]): Promise<Array<{ fromFile: string; spec: string }>>`
       — read + `parseImports` each supported file (per-file try/catch), flatten to
       `{ fromFile, spec: i.source }`, dedup `(fromFile, spec)`. Used by the
       incremental pipeline (full reuses its in-loop buffer).
   - Verify: new hermetic `server/test/import-edges.test.ts` — see step 9.

7. **Collect imports + union edges in the full pipeline** — `server/src/modules/repo-intel/pipeline/full.ts`
   - Change type: modify
   - What:
     - Add `parseImports` to the astgrep import (`:29`) and
       `import { buildResolverContext, resolveImportEdges, unionEdges } from './import-edges.js';`.
     - Declare `const importsBuf: Array<{ fromFile: string; spec: string }> = [];`
       next to `factsBuf` (`:119`). In the parse closure (after the
       symbols/refs/facts pushes, `:184-190`) push
       `for (const im of parseImports(relPath, source)) importsBuf.push({ fromFile: relPath, spec: im.source });`.
     - In the `if (!softBudgetReached)` block (`:214`): keep the cruise call →
       name its result `cruiseEdges` (the current `edgeRows`); then
       `const ctx = await buildResolverContext(repo.clonePath, walk.files);`
       `const importEdges = resolveImportEdges(importsBuf, ctx);`
       `edgeRows = unionEdges(cruiseEdges, importEdges);` BEFORE
       `await repository.replaceEdges(repoId, edgeRows)` (`:221`).
       `resolveReferences`, `computeFileRank(walk.files, edgeRows)`, and the
       repo-map all consume the unioned `edgeRows` unchanged.
     - Add `importEdges: importEdges.length` to `stats` (`:254-267`) for
       observability.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit`;
     `node_modules/.bin/vitest run test/indexer-pipeline.test.ts` still green (the
     stub `replaceEdges` is a no-op; `buildResolverContext` on a tmpdir with no
     `package.json` degrades to empty workspace map; the relative `./util` import
     now yields a harmless extra edge that the stub ignores).

8. **Same wiring in the incremental pipeline** — `server/src/modules/repo-intel/pipeline/incremental.ts`
   - Change type: modify
   - What: in the T3 rebuild block (`:215-239`, which already walks the FULL file
     set and re-runs cruise + rank + re-resolve): after the cruise edges
     (`edgeRows = edges.map(...)`, `:220`), add
     `const imports = await collectImports(repo.clonePath, allFiles);`
     `const ctx = await buildResolverContext(repo.clonePath, allFiles);`
     `edgeRows = unionEdges(edgeRows, resolveImportEdges(imports, ctx));`
     BEFORE `await repository.replaceEdges(repoId, edgeRows)` (`:221`). Add the
     imports to the SAME try/catch so a failure degrades to `graphFailed` (status
     `partial`) exactly like a cruise failure. **Do not miss this file** — without
     it, an incremental refresh would overwrite the full pipeline's richer edges
     with cruise-only edges.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit`;
     `node_modules/.bin/vitest run test/indexer-pipeline.test.ts` still green.

9. **Hermetic resolver tests with a synthetic monorepo fixture** — `server/test/import-edges.test.ts`
   - Change type: add
   - What: build a tmpdir fixture (`mkdtemp` + `writeFileAt`, mirroring
     `indexer-pipeline.test.ts:140-145`) WITHOUT installing anything: root
     `package.json` `{ "workspaces": ["packages/*", "apps/*"] }`; `packages/ui/
     package.json` name `@scope/ui` + `packages/ui/src/index.ts` + `packages/ui/
     src/button.ts`; `apps/web/package.json`, `apps/web/tsconfig.json`
     `{ compilerOptions: { baseUrl: ".", paths: { "~/*": ["./*"] } } }`,
     `apps/web/app/page.tsx`, `apps/web/lib/util.ts`. Then assert `resolveImport`:
     - `@scope/ui` from `apps/web/app/page.tsx` → `packages/ui/src/index.ts`
       (subpath/index probe).
     - `@scope/ui/button` → `packages/ui/src/button.ts` (subpath).
     - `~/lib/util` from `apps/web/app/page.tsx` → `apps/web/lib/util.ts`
       (per-package alias resolves via the NEAREST tsconfig).
     - `./util` / `../lib/util` relative cases resolve with extension/`/index`
       probing.
     - an unknown spec (`@scope/missing`) → `null` (degrade-to-safe, no throw).
     - `resolveImportEdges` over a small import list → exactly the in-`fileSet`
       edges, deduped; `unionEdges` dedups across cruise+import inputs.
   - Verify: `cd server && node_modules/.bin/vitest run test/import-edges.test.ts`.

10. **Bump `INDEXER_VERSION` to force a full rebuild of edges** — `server/src/modules/repo-intel/constants.ts`
    - Change type: modify
    - What: `INDEXER_VERSION` `2 → 3` (`:39`) and extend the doc comment ("v3:
      monorepo-aware import edges (workspace/alias resolution) + type references").
      The incremental pipeline already delegates to `runFullIndex` on
      `state.indexerVersion !== INDEXER_VERSION` (`incremental.ts:78`), so every
      indexed repo rebuilds `file_edges` + re-resolves `decl_file` on its next
      Refresh/resync — no per-repo manual action beyond a resync.
    - Verify: `cd server && node_modules/.bin/tsc --noEmit`;
      `node_modules/.bin/vitest run test/indexer-pipeline.test.ts` still green
      (the test reads the constant, never hardcodes `2`).

### Tier 3 — #4: track type references (index-time; REQUIRES reindex; builds on #2)

11. **Capture type usages in `parseReferences`** — `server/src/adapters/astgrep/index.ts`
    - Change type: modify
    - What: in `parseReferences` (`:402-462`), ADD one pass after the existing
      call/`new`/JSX passes, keeping every existing pass + the `push` guard
      (KEYWORDS, decl-line `name:line` exclusion, dedup) untouched:
      `for (const n of root.findAll({ rule: { kind: 'type_identifier' } })) { … }`
      — skip `isInsideImport(n)` (import type bindings are not refs); skip nodes
      whose ancestor is a `type_parameters` declaration (the `<T>` generic
      *definition*, not a usage) to cut noise; else `push(n.text(), lineOf(n))`.
      This captures type annotations (`: PageProps`), array/element types
      (`AppCategoryEntry[]`), generics (`Foo<Bar>` → `type_arguments`), and
      `extends`/`implements` heritage (all surface the referenced name as a
      `type_identifier`). The decl-line guard already drops an
      interface/type/enum/class declaration's OWN name node. This pass runs for
      all langs (type syntax only appears in TS/TSX; JS produces none).
    - Verify: see step 12.

12. **Extend the `parseReferences` tests for type usages** — `server/test/astgrep.test.ts`
    - Change type: modify
    - What: add cases to the `parseReferences` describe (`:138-175`):
      - annotation: `function f(x: PageProps) {}` → ref `PageProps`.
      - array/element type: `const xs: AppCategoryEntry[] = []` → ref
        `AppCategoryEntry`.
      - generics: `const m = new Map<string, AppMeta>()` → ref `AppMeta` (and the
        existing `Map` value-ref still present).
      - heritage: `class C extends Base implements Iface {}` → refs `Base` +
        `Iface`.
      - non-regression: the declaration's own name is still NOT a ref (re-assert
        the existing `does not count the declaration line` case); lowercase HTML
        tags still skipped.
    - Verify: `cd server && node_modules/.bin/vitest run test/astgrep.test.ts` +
      `node_modules/.bin/tsc --noEmit`.

13. **`INDEXER_VERSION` covers #4 too** — `server/src/modules/repo-intel/constants.ts`
    - Change type: (no edit if #2 and #4 ship together)
    - What: #4 also changes index-time output, so it MUST ride an
      `INDEXER_VERSION` bump. If #2 and #4 land in the SAME release, the `2 → 3`
      bump in step 10 already covers it. If #4 ships in a SEPARATE release AFTER
      #2 was deployed + repos already reindexed at v3, bump again (`3 → 4`).
    - Verify: confirm `INDEXER_VERSION` was bumped in the release that introduces
      the `type_identifier` pass; otherwise type refs won't be re-extracted.

### Tier 4 — #3: honest "limited cross-file resolution" signal (read-time)

14. **Add the resolution-stats query** — `server/src/modules/repo-intel/repository.ts`
    - Change type: add
    - What: `getReferenceResolutionStats(repoId: string): Promise<{ total: number; resolved: number }>`
      — `SELECT count(*) AS total, count(decl_file) AS resolved FROM "references" WHERE repo_id = $1`
      (`count(decl_file)` counts non-null rows). Parse the bigint/string counts to
      `number`. Fully parameterised on `repoId`.
    - Verify: covered by the IT test in step 18 + tsc.

15. **Add the pure ratio calc** — `server/src/modules/repo-intel/service.ts`
    - Change type: add
    - What: `export function computeResolution(total: number, resolved: number): { limited: boolean; reason?: string }`
      — **threshold:** `limited = total >= MIN_REFS_FOR_RESOLUTION_SIGNAL (50) && resolved / total < 0.3`;
      when limited, `reason: 'sparse_cross_file'`. The `>= 50` floor avoids
      flagging tiny repos where a low ratio is meaningless; `< 0.3` is the
      "large share stays NULL" bar (state both numbers as named module constants so
      they are tunable + visible). Returns `{ limited: false }` otherwise.
    - Verify: new hermetic `server/test/repo-intel-resolution.test.ts` —
      `(100, 10)` → limited; `(100, 90)` → not limited; `(10, 0)` → not limited
      (below floor); boundary `(50, 14)` vs `(50, 15)`. Run
      `cd server && node_modules/.bin/vitest run test/repo-intel-resolution.test.ts`.

16. **Thread `resolution` through the facade types + shaper** —
    `server/src/modules/repo-intel/types.ts`, `server/src/modules/repo-intel/service.ts`,
    `server/src/modules/blast/service.ts`, `server/src/modules/blast/types.ts`
    - Change type: modify
    - What:
      - `repo-intel/types.ts`: add `resolution?: { limited: boolean; reason?: string }`
        to `BlastResult` (`:74-87`).
      - `service.ts` `tryPersistentBlast`: call
        `const { total, resolved } = await this.repo.getReferenceResolutionStats(repoId);`
        once, set `resolution: computeResolution(total, resolved)` on the returned
        `BlastResult` (`:405-411`).
      - `blast/service.ts` `shapeBlastResponse`: map
        `resolution: result.resolution ?? { limited: false }` onto the returned
        `BlastResponse` (`:92-106`).
      - `blast/types.ts`: add
        `resolution: { limited: boolean; reason?: string };` to `BlastResponse`
        (`:36-58`).
    - Verify: `cd server && node_modules/.bin/tsc --noEmit`.

17. **Extend the shaper test for the resolution field** — `server/src/modules/blast/service.test.ts`
    - Change type: modify
    - What: add a case asserting `shapeBlastResponse` passes through
      `result.resolution = { limited: true, reason: 'sparse_cross_file' }` and
      defaults to `{ limited: false }` when absent. (Existing fixtures omit
      `resolution`, so they exercise the default — re-assert one to prove no
      regression.)
    - Verify: `cd server && node_modules/.bin/vitest run src/modules/blast/service.test.ts`.

18. **DB-backed read-path test for the ratio** — `server/test/blast-resolution-signal.it.test.ts`
    - Change type: add
    - What: with testcontainers Postgres, seed a repo + index state + many
      `references` rows where most have `decl_file = NULL` (ratio < 0.3, total ≥ 50)
      → assert `BlastService.getBlast(...)` / facade returns
      `resolution.limited === true`; and a control repo with a healthy ratio →
      `resolution.limited === false`.
    - Verify:
      `cd server && TESTCONTAINERS_RYUK_DISABLED=true node_modules/.bin/vitest run test/blast-resolution-signal.it.test.ts`.

19. **Hand-mirror `resolution` on the client contract** — `client/src/lib/types.ts`
    - Change type: modify
    - What: add `resolution: { limited: boolean; reason?: string };` to the client
      `BlastResponse` (`:75-97`), mirroring the server `blast/types.ts` exactly
      (the `index.status` precedent — both copies are hand-maintained, neither is
      vendored). Do NOT touch `src/vendor/**`.
    - Verify: `cd client && node_modules/.bin/tsc --noEmit`.

20. **Render the distinct "limited resolution" note + i18n** —
    `client/messages/en/blast.json`, `client/.../BlastRadius/BlastRadius.tsx`
    - Change type: modify
    - What:
      - `blast.json`: add a `"resolution"` block, e.g. `"note": "Cross-file
        resolution is limited for this repo — some callers may be missing because
        imports across packages or path aliases didn't resolve. Re-index after the
        next release for fuller results."` Leave `degraded`/`partial`/`empty`
        untouched.
      - `BlastRadius.tsx`: compute `const isLimited = data?.resolution?.limited === true;`
        and render a DISTINCT note (its own style, e.g. reuse `s.noCallersNote` or
        add `s.resolutionNote`) — NOT the `s.degradedBadge` used for
        degraded/partial. Place it near the existing `noCallersNote` inside the
        tree (`:136-140`); it is informational and must NOT gate `isEmpty` (do not
        regress `isEmpty = !data || totals.symbols === 0`).
    - Verify: `cd client && node -e "require('./messages/en/blast.json')"` (valid
      JSON) + the test in step 21 + `node_modules/.bin/tsc --noEmit`.

21. **Client test for the limited-resolution note** — `client/.../BlastRadius/BlastRadius.test.tsx`
    - Change type: modify
    - What: add a fixture with `resolution: { limited: true }`, symbols present,
      `index.status: "full"`, `degraded: false` → assert the resolution note copy
      renders AND a symbol name still appears (panel not collapsed) AND the
      degraded/partial badges do NOT render. Add a control with
      `resolution: { limited: false }` → note absent. Use `fireEvent`/`getAllByText`
      per `client/INSIGHTS.md`.
    - Verify:
      `cd client && node_modules/.bin/vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/BlastRadius/BlastRadius.test.tsx`.

## Acceptance criteria

- **Backend gate (`server/`):**
  - `cd server && node_modules/.bin/tsc --noEmit` clean.
  - Hermetic (no Docker):
    `node_modules/.bin/vitest run test/repo-intel-fallback-merge.test.ts test/import-edges.test.ts test/repo-intel-resolution.test.ts test/astgrep.test.ts test/indexer-pipeline.test.ts src/modules/blast/service.test.ts test/extract.test.ts`
    — all green. Specifically: `mergeFallbackCallers` dedups resolved-over-fallback;
    `resolveImport` resolves workspace (`@scope/ui`, `@scope/ui/button`), alias
    (`~/lib/util`), and relative specs against the synthetic fixture and returns
    `null` for unknowns; `computeResolution` flags `(100,10)` and not `(100,90)`/
    `(10,0)`; `parseReferences` now emits refs for `PageProps`/`AppCategoryEntry`/
    `AppMeta`/`Base`/`Iface` while still excluding decl lines; the pipeline tests
    pass with the unioned-edges step (stub `replaceEdges` ignores edges).
  - DB-backed (needs `TESTCONTAINERS_RYUK_DISABLED=true`):
    `node_modules/.bin/vitest run test/blast-name-unique-fallback.it.test.ts test/blast-resolution-signal.it.test.ts`
    — globally-unique `getAppCategories` shows its cross-file caller with NO
    reindex; ambiguous `getHref` stays 0; the same-named-local guard drops the
    false positive; the sparse-ratio repo returns `resolution.limited === true`.
- **Frontend gate (`client/`):**
  - `cd client && node_modules/.bin/tsc --noEmit` clean.
  - `node_modules/.bin/vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/BlastRadius/BlastRadius.test.tsx`
    — the limited-resolution note renders as a DISTINCT note (not the
    degraded/partial badge) and the symbol tree still renders; `isEmpty` gating not
    regressed.
- **Whole feature (manual):**
  - **Tier 1 (#1) is read-time — NO reindex.** On the already-indexed
    `calcom/cal.diy` #29558, after deploying Tier 1 the globally-unique symbols
    (`getAppCategories`, `IntegrationsContainer`, `InstalledApps`) show their
    cross-file callers; `getHref` (ambiguous) correctly stays 0.
  - **Tiers 2 + 4 require a REINDEX.** No migration (`pnpm db:migrate` not needed —
    no schema change), but `INDEXER_VERSION` was bumped (step 10), so each repo
    must be Refreshed/resynced for the monorepo-aware `file_edges`, the re-resolved
    `decl_file`, and (Tier 3) the type references to take effect. After resync of
    #558's repo: `@calcom/*`/`~/`-imported callers resolve via real edges, type/
    interface symbols show consumers, and the honest "limited resolution" note
    disappears once the ratio recovers.

## Risks / out of scope / open questions

- **Risks / precision tradeoff:**
  - **#1 false-positive vector:** a caller file holding a NON-exported local
    symbol named identically to a globally-unique export could be mis-attributed.
    Mitigated by the two-part guard (globally-unique export + skip caller files
    that locally declare the same name). Residual risk is low and bounded to
    genuinely globally-unique names; ambiguous names are dropped, preserving the
    `getResolvedCallers` precision-over-recall contract.
  - **Reindex caveat (the biggest "looks broken" trap):** Tiers 2/4 change
    index-time output; already-indexed repos show no change until a Refresh/resync
    (the `INDEXER_VERSION` bump makes the next refresh a full reindex). Call this
    out in the PR and resync demo/target repos.
  - **Heuristic resolver:** `resolveImport` covers relative + workspace +
    tsconfig-alias specs; it does NOT model `package.json` `exports` maps,
    conditional exports, or `tsconfig` `extends` chains. It degrades to `null`
    (no edge) for anything unrecognised — never a wrong edge — and is UNIONED with
    cruise, so it can only ADD correct edges, never remove cruise's. Cannot assume
    cal.com's exact layout; the resolver is designed generally and proven with
    synthetic fixtures.
  - **Side-effect imports:** `parseImports` returns only binding imports, so
    `import './x'` side-effect deps are not added by the import-edge supplement —
    cruise still covers those; no regression.
  - **Don't regress:** `resolveReferences` uniqueness/precision contract
    (untouched), `getResolvedCallers` (untouched), `capCallersPerSymbol` per-symbol
    cap (still applied after the merge), `shapeBlastResponse` same-file guard
    (untouched), the client `isEmpty` gating, and the existing `depgraph` /
    `indexer-pipeline` / `extract` / `astgrep` test suites (all re-run in the
    acceptance gate).
  - **Performance:** `buildResolverContext`/`collectImports` add fs reads at index
    time; bounded by the same walked file set cruise already reads, and gated
    behind the soft-budget check in `full.ts` (the graph block is skipped when the
    budget trips). `getUniqueExportFiles`/`getReferencesByNames`/
    `getReferenceResolutionStats` are read-time queries over already-indexed
    `symbols`/`references`/`file_rank` rows hitting existing indexes.
- **Out of scope (do NOT build here):**
  - Installing repo dependencies on the clone so cruise can follow `@scope/*`
    symlinks — explicitly rejected (fix #5 from the analysis).
  - `package.json` `exports`/conditional-export resolution and `tsconfig extends`
    chains (resolver stays heuristic; unknowns → `null`).
  - Re-planning the already-shipped Next.js-endpoint extraction, self-fact
    attribution, score badge, empty-graph, and honest-copy fixes.
  - Any schema/migration change (everything here is additive read-time queries +
    index-time edge supplement + local-contract fields).
- **Open questions / assumptions:**
  - *Assumption:* `< 0.3` resolved ratio with `total ≥ 50` references is the right
    "limited" bar — chosen as a conservative, tunable default (named constants).
    If it proves noisy, lower the ratio or raise the floor; no contract change.
  - *Assumption:* `getReferencesByNames` inner-joining `file_rank` is acceptable
    for #1 even before the Tier-2 reindex — the current `full` index already ranks
    every walked file, so caller files have rank rows (verified against
    `computeFileRank(walk.files, …)` in `full.ts`).
  - *Assumption:* bumping `INDEXER_VERSION` once per release that changes
    index-time output (3 for #2+#4 together; 4 if #4 ships separately after a v3
    deploy) is the agreed reindex trigger, rather than a manual per-repo resync
    button.
