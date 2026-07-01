/**
 * import-edges — monorepo-aware import-edge builder (Tier 2).
 *
 * Pure, degrade-to-safe (never throw) resolver that supplements
 * dependency-cruiser's edges with workspace-package and tsconfig-alias edges
 * that cruise drops as `couldNotResolve`. The two edge sets are UNIONed (not
 * replaced) so nothing cruise resolves today can regress.
 *
 * All paths in/out are repo-relative POSIX strings (same convention as
 * symbols.path / file_edges.from_file).
 */

import { readFile, readdir } from 'node:fs/promises';
import { posix } from 'node:path';
import { parseImports } from '../../../adapters/astgrep/index.js';
import { SUPPORTED_EXT } from '../constants.js';
import type { FileEdge } from '../../../adapters/depgraph/index.js';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ResolverContext {
  root: string;
  fileSet: ReadonlySet<string>;
  /**
   * Package-name → repo-relative directory, derived from root `package.json`
   * `workspaces` + each package's `package.json` `name` field.
   * e.g. `@scope/ui` → `packages/ui`
   */
  workspaces: Map<string, string>;
  /**
   * Per-package tsconfig alias entries. Ordered most-specific first (longest
   * `dir` prefix) so the nearest tsconfig wins for a given `fromFile`.
   */
  aliasDirs: Array<{
    /** Repo-relative dir that owns this tsconfig ('' = root). */
    dir: string;
    /** Repo-relative directory to resolve substituted paths against. */
    baseUrl: string;
    paths: Record<string, string[]>;
  }>;
}

// ---------------------------------------------------------------------------
// probe — try a repo-relative candidate path ± extensions ± /index
// ---------------------------------------------------------------------------

function probe(candidateRel: string, ctx: ResolverContext): string | null {
  const normalised = posix.normalize(candidateRel);
  if (ctx.fileSet.has(normalised)) return normalised;
  for (const ext of SUPPORTED_EXT) {
    const withExt = normalised + ext;
    if (ctx.fileSet.has(withExt)) return withExt;
  }
  for (const ext of SUPPORTED_EXT) {
    const withIndex = normalised + '/index' + ext;
    if (ctx.fileSet.has(withIndex)) return withIndex;
  }
  return null;
}

// ---------------------------------------------------------------------------
// resolveImport — pure, never throws
// ---------------------------------------------------------------------------

/**
 * Resolve a single import specifier to a repo-relative path in `fileSet`, or
 * return `null` if unresolvable. Never throws — degrades gracefully.
 *
 * Branches:
 *   (i)   relative (`./`, `../`) — join against dirname(fromFile).
 *   (ii)  workspace package / subpath — match against workspaces map.
 *   (iii) alias — match tsconfig `paths`, substitute, resolve against baseUrl.
 */
export function resolveImport(
  spec: string,
  fromFile: string,
  ctx: ResolverContext,
): string | null {
  try {
    // (i) Relative imports
    if (spec.startsWith('./') || spec.startsWith('../')) {
      const fromDir = fromFile.includes('/')
        ? fromFile.slice(0, fromFile.lastIndexOf('/'))
        : '';
      const candidate = fromDir ? posix.join(fromDir, spec) : spec;
      return probe(candidate, ctx);
    }

    // (ii) Workspace package / subpath imports
    // Find the longest workspace key that matches spec exactly or is a
    // prefix of spec at a '/' boundary.
    if (ctx.workspaces.size > 0) {
      let bestKey = '';
      let bestDir = '';
      for (const [pkgName, dir] of ctx.workspaces) {
        if (
          (spec === pkgName || spec.startsWith(pkgName + '/')) &&
          pkgName.length > bestKey.length
        ) {
          bestKey = pkgName;
          bestDir = dir;
        }
      }
      if (bestKey) {
        const subpath = spec.slice(bestKey.length); // '' or '/something'
        const candidate = subpath
          ? posix.join(bestDir, subpath)
          : bestDir;
        const resolved = probe(candidate, ctx);
        if (resolved) return resolved;
      }
    }

    // (iii) Alias imports — pick the nearest aliasDirs entry (longest dir
    // prefix of fromFile). aliasDirs is already sorted most-specific first.
    for (const entry of ctx.aliasDirs) {
      if (entry.dir && !fromFile.startsWith(entry.dir + '/')) continue;
      // Resolve the substituted path against the tsconfig baseUrl directory.
      const resolved = matchPaths(spec, entry, ctx);
      if (resolved !== null) return resolved;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Try to match `spec` against `entry.paths` keys (supporting trailing `*`
 * wildcard) and resolve the first hit.
 */
function matchPaths(
  spec: string,
  entry: ResolverContext['aliasDirs'][number],
  ctx: ResolverContext,
): string | null {
  for (const [key, replacements] of Object.entries(entry.paths)) {
    if (key.endsWith('/*')) {
      const keyPrefix = key.slice(0, -2); // strip trailing '/*'
      if (spec === keyPrefix || spec.startsWith(keyPrefix + '/')) {
        const wildcard = spec.slice(keyPrefix.length + 1); // after the prefix + '/'
        for (const tmpl of replacements) {
          const substituted = tmpl.endsWith('/*')
            ? tmpl.slice(0, -2) + '/' + wildcard
            : tmpl;
          const candidate = posix.join(entry.baseUrl, substituted);
          const resolved = probe(candidate, ctx);
          if (resolved !== null) return resolved;
        }
      }
    } else if (key === spec) {
      for (const tmpl of replacements) {
        const candidate = posix.join(entry.baseUrl, tmpl);
        const resolved = probe(candidate, ctx);
        if (resolved !== null) return resolved;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// resolveImportEdges — map imports → edges, drop nulls + self-edges + dups
// ---------------------------------------------------------------------------

export function resolveImportEdges(
  imports: Array<{ fromFile: string; spec: string }>,
  ctx: ResolverContext,
): FileEdge[] {
  const edges: FileEdge[] = [];
  const seen = new Set<string>();
  for (const { fromFile, spec } of imports) {
    const toFile = resolveImport(spec, fromFile, ctx);
    if (!toFile || toFile === fromFile) continue;
    const key = `${fromFile}\0${toFile}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: fromFile, to: toFile });
  }
  return edges;
}

// ---------------------------------------------------------------------------
// unionEdges — deduped union of two edge lists (a first)
// ---------------------------------------------------------------------------

export function unionEdges(a: FileEdge[], b: FileEdge[]): FileEdge[] {
  const seen = new Set<string>();
  const result: FileEdge[] = [];
  for (const e of [...a, ...b]) {
    const key = `${e.from}\0${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(e);
  }
  return result;
}

// ---------------------------------------------------------------------------
// buildResolverContext — read workspace + tsconfig data from the clone
// ---------------------------------------------------------------------------

/**
 * Build a `ResolverContext` from the repo on disk. All fs reads are wrapped
 * in try/catch — any missing/malformed file silently contributes nothing.
 */
export async function buildResolverContext(
  root: string,
  files: string[],
): Promise<ResolverContext> {
  const fileSet = new Set(files);
  const workspaces = new Map<string, string>();
  const aliasDirsRaw: Array<{ dir: string; baseUrl: string; paths: Record<string, string[]> }> = [];

  // Step 1: root package.json → workspaces glob list
  const wsDirs: string[] = []; // repo-relative dirs of workspace packages
  try {
    const rootPkg = JSON.parse(await readFile(`${root}/package.json`, 'utf8')) as {
      workspaces?: string[] | { packages?: string[] };
    };
    const rawWs = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : (rootPkg.workspaces as { packages?: string[] } | undefined)?.packages ?? [];

    for (const pattern of rawWs) {
      // Support simple `<dir>/*` patterns — expand to actual subdirs.
      if (pattern.endsWith('/*')) {
        const parentDir = pattern.slice(0, -2);
        try {
          const entries = await readdir(`${root}/${parentDir}`, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory()) {
              wsDirs.push(`${parentDir}/${e.name}`);
            }
          }
        } catch {
          // Directory may not exist — skip.
        }
      } else if (!pattern.includes('*')) {
        // Literal dir
        wsDirs.push(pattern);
      }
      // More complex globs (nested `**`) are not handled — degrade silently.
    }
  } catch {
    // root package.json missing or not JSON — no workspaces.
  }

  // Step 2: read each workspace package's package.json → name → dir mapping
  for (const wsDir of wsDirs) {
    try {
      const pkgJson = JSON.parse(
        await readFile(`${root}/${wsDir}/package.json`, 'utf8'),
      ) as { name?: string };
      const name = pkgJson.name;
      if (typeof name === 'string' && name.length > 0) {
        workspaces.set(name, wsDir);
      }
    } catch {
      // Missing package.json — skip.
    }
  }

  // Step 3: read tsconfig paths from root + each workspace dir
  const tsconfigDirs = ['', ...wsDirs]; // '' = root
  for (const dir of tsconfigDirs) {
    const tscPath = dir ? `${root}/${dir}/tsconfig.json` : `${root}/tsconfig.json`;
    try {
      const tsc = JSON.parse(await readFile(tscPath, 'utf8')) as {
        compilerOptions?: {
          baseUrl?: string;
          paths?: Record<string, string[]>;
        };
      };
      const co = tsc.compilerOptions;
      if (!co?.paths) continue;
      // baseUrl is relative to the tsconfig file's directory (= root or wsDir).
      const tscDir = dir; // repo-relative directory of the tsconfig
      const rawBase = co.baseUrl ?? '.';
      const baseUrl = dir ? posix.join(dir, rawBase) : posix.normalize(rawBase);
      aliasDirsRaw.push({ dir, baseUrl, paths: co.paths });
    } catch {
      // Missing or malformed tsconfig — skip.
    }
  }

  // Sort aliasDirs most-specific (longest dir) first so the nearest tsconfig
  // is tried first when resolving a fromFile.
  aliasDirsRaw.sort((a, b) => b.dir.length - a.dir.length);

  return { root, fileSet, workspaces, aliasDirs: aliasDirsRaw };
}

// ---------------------------------------------------------------------------
// collectImports — read + parseImports each file (for incremental pipeline)
// ---------------------------------------------------------------------------

/**
 * Read and parse every supported file in `files`, returning a flat deduplicated
 * list of `{ fromFile, spec }` pairs. Per-file errors are swallowed (degrade
 * to no imports from that file).
 */
export async function collectImports(
  root: string,
  files: string[],
): Promise<Array<{ fromFile: string; spec: string }>> {
  const out: Array<{ fromFile: string; spec: string }> = [];
  const seenKey = new Set<string>();

  await Promise.all(
    files.map(async (relPath) => {
      try {
        const source = await readFile(`${root}/${relPath}`, 'utf8');
        const imports = parseImports(relPath, source);
        for (const im of imports) {
          const key = `${relPath}\0${im.source}`;
          if (!seenKey.has(key)) {
            seenKey.add(key);
            out.push({ fromFile: relPath, spec: im.source });
          }
        }
      } catch {
        // File unreadable or parse error — contribute nothing.
      }
    }),
  );

  return out;
}
