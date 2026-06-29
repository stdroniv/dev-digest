/**
 * Hermetic tests for the monorepo-aware import-edge resolver (Tier 2).
 *
 * Builds a tmpdir fixture WITHOUT installing any packages — the file set is
 * all that matters; resolver probes via Set membership only.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildResolverContext,
  resolveImport,
  resolveImportEdges,
  unionEdges,
} from '../src/modules/repo-intel/pipeline/import-edges.js';

// ---------------------------------------------------------------------------
// Fixture: a synthetic monorepo
//
//   root/
//     package.json          { workspaces: ["packages/*", "apps/*"] }
//     packages/
//       ui/
//         package.json      { name: "@scope/ui" }
//         src/
//           index.ts        (in fileSet)
//           button.ts       (in fileSet)
//     apps/
//       web/
//         package.json      { name: "@scope/web" }
//         tsconfig.json     { compilerOptions: { baseUrl: ".", paths: { "~/*": ["./*"] } } }
//         app/
//           page.tsx        (in fileSet)
//         lib/
//           util.ts         (in fileSet)
// ---------------------------------------------------------------------------

let root: string;

async function writeAt(rel: string, content: string): Promise<void> {
  const abs = join(root, rel);
  const dir = abs.slice(0, abs.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(abs, content);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'import-edges-test-'));

  await writeAt('package.json', JSON.stringify({ workspaces: ['packages/*', 'apps/*'] }));

  await writeAt('packages/ui/package.json', JSON.stringify({ name: '@scope/ui' }));
  // Index at package root so probe(packages/ui/index.<ext>) finds it directly.
  await writeAt('packages/ui/index.ts', 'export const x = 1;');
  await writeAt('packages/ui/button.ts', 'export const Button = () => {};');

  await writeAt('apps/web/package.json', JSON.stringify({ name: '@scope/web' }));
  await writeAt(
    'apps/web/tsconfig.json',
    JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '~/*': ['./*'] } },
    }),
  );
  await writeAt('apps/web/app/page.tsx', 'export default function Page() {}');
  await writeAt('apps/web/lib/util.ts', 'export function util() {}');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const FILES = [
  'packages/ui/index.ts',
  'packages/ui/button.ts',
  'apps/web/app/page.tsx',
  'apps/web/lib/util.ts',
];

// ---------------------------------------------------------------------------
// resolveImport — workspace package imports
// ---------------------------------------------------------------------------

describe('resolveImport — workspace packages', () => {
  it('@scope/ui resolves to packages/ui/index.ts (index probe)', async () => {
    const ctx = await buildResolverContext(root, FILES);
    const result = resolveImport('@scope/ui', 'apps/web/app/page.tsx', ctx);
    expect(result).toBe('packages/ui/index.ts');
  });

  it('@scope/ui/button resolves to packages/ui/button.ts (subpath probe)', async () => {
    const ctx = await buildResolverContext(root, FILES);
    const result = resolveImport('@scope/ui/button', 'apps/web/app/page.tsx', ctx);
    expect(result).toBe('packages/ui/button.ts');
  });
});

// ---------------------------------------------------------------------------
// resolveImport — alias (tsconfig paths)
// ---------------------------------------------------------------------------

describe('resolveImport — tsconfig alias', () => {
  it('~/lib/util from apps/web/app/page.tsx → apps/web/lib/util.ts', async () => {
    const ctx = await buildResolverContext(root, FILES);
    const result = resolveImport('~/lib/util', 'apps/web/app/page.tsx', ctx);
    expect(result).toBe('apps/web/lib/util.ts');
  });
});

// ---------------------------------------------------------------------------
// resolveImport — relative imports
// ---------------------------------------------------------------------------

describe('resolveImport — relative imports', () => {
  it('./button resolves from packages/ui/index.ts', async () => {
    const ctx = await buildResolverContext(root, FILES);
    const result = resolveImport('./button', 'packages/ui/index.ts', ctx);
    expect(result).toBe('packages/ui/button.ts');
  });

  it('../lib/util resolves from apps/web/app/page.tsx', async () => {
    const ctx = await buildResolverContext(root, FILES);
    const result = resolveImport('../lib/util', 'apps/web/app/page.tsx', ctx);
    expect(result).toBe('apps/web/lib/util.ts');
  });
});

// ---------------------------------------------------------------------------
// resolveImport — unknown spec degrades to null
// ---------------------------------------------------------------------------

describe('resolveImport — unknown spec', () => {
  it('@scope/missing → null (degrade-to-safe, no throw)', async () => {
    const ctx = await buildResolverContext(root, FILES);
    const result = resolveImport('@scope/missing', 'apps/web/app/page.tsx', ctx);
    expect(result).toBeNull();
  });

  it('non-workspace npm package → null', async () => {
    const ctx = await buildResolverContext(root, FILES);
    const result = resolveImport('react', 'apps/web/app/page.tsx', ctx);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveImportEdges — maps imports to edges, deduped, no self-edges
// ---------------------------------------------------------------------------

describe('resolveImportEdges', () => {
  it('maps a workspace import to a FileEdge', async () => {
    const ctx = await buildResolverContext(root, FILES);
    const imports = [{ fromFile: 'apps/web/app/page.tsx', spec: '@scope/ui' }];
    const edges = resolveImportEdges(imports, ctx);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ from: 'apps/web/app/page.tsx', to: 'packages/ui/index.ts' });
  });

  it('drops null-resolved imports', async () => {
    const ctx = await buildResolverContext(root, FILES);
    const imports = [
      { fromFile: 'apps/web/app/page.tsx', spec: '@scope/ui' },
      { fromFile: 'apps/web/app/page.tsx', spec: 'react' }, // unknown → null
    ];
    const edges = resolveImportEdges(imports, ctx);
    expect(edges).toHaveLength(1);
  });

  it('deduplicates repeated (from, to) pairs', async () => {
    const ctx = await buildResolverContext(root, FILES);
    const imports = [
      { fromFile: 'apps/web/app/page.tsx', spec: '@scope/ui' },
      { fromFile: 'apps/web/app/page.tsx', spec: '@scope/ui' }, // duplicate
    ];
    const edges = resolveImportEdges(imports, ctx);
    expect(edges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// unionEdges — deduped union of cruise + import edges
// ---------------------------------------------------------------------------

describe('unionEdges', () => {
  it('keeps all edges from both lists when disjoint', () => {
    const a = [{ from: 'a.ts', to: 'b.ts' }];
    const b = [{ from: 'c.ts', to: 'd.ts' }];
    const result = unionEdges(a, b);
    expect(result).toHaveLength(2);
  });

  it('deduplicates overlapping edges, keeping first (cruise wins)', () => {
    const cruise = [{ from: 'a.ts', to: 'b.ts' }];
    const importRes = [{ from: 'a.ts', to: 'b.ts' }, { from: 'c.ts', to: 'd.ts' }];
    const result = unionEdges(cruise, importRes);
    expect(result).toHaveLength(2);
    // a→b appears only once
    const ab = result.filter((e) => e.from === 'a.ts' && e.to === 'b.ts');
    expect(ab).toHaveLength(1);
  });

  it('returns empty when both inputs are empty', () => {
    expect(unionEdges([], [])).toHaveLength(0);
  });
});
