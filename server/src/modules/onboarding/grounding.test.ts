/**
 * assembleGrounding — hermetic unit tests (T4).
 *
 * Asserts (with a mocked `repoIntel`):
 *  - a non-degraded index state yields index-grounded fields (repo map, top
 *    files, critical-path chains, an import graph derived from those chains).
 *  - a degraded index state yields the README/file-tree/language-hint fallback
 *    fields instead, never throwing even when the clone is missing.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RepoIntel, IndexState, RepoMapResult, FileRankRow, SymbolRow, SignatureRow, RefRow, BlastResult } from '../repo-intel/types.js';
import type { Container } from '../../platform/container.js';
import { assembleGrounding, type OnboardingRepoRef } from './grounding.js';

const BASE_STATE: IndexState = {
  repoId: 'repo-1',
  status: 'full',
  filesIndexed: 42,
  filesSkipped: 0,
  durationMs: 100,
  lastIndexedSha: 'sha-abc123',
  indexerVersion: 4,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function fakeRepoIntel(overrides: Partial<RepoIntel> & { indexState: IndexState }): RepoIntel {
  return {
    indexRepo: async () => ({ status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 }),
    refreshIndex: async () => ({ status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 }),
    getIndexState: async () => overrides.indexState,
    getBlastRadius: async (): Promise<BlastResult> => ({ changedSymbols: [], callers: [], impactedEndpoints: [] }),
    getRepoMap: async (): Promise<RepoMapResult> => ({ text: '', tokens: 0, cached: false }),
    getFileRank: async (): Promise<FileRankRow[]> => [],
    getSymbolsInFiles: async (): Promise<SymbolRow[]> => [],
    getCallerSignatures: async (): Promise<SignatureRow[]> => [],
    getUnresolvedReferences: async (): Promise<RefRow[]> => [],
    getConventionSamples: async (): Promise<string[]> => [],
    getTopFilesByRank: async (): Promise<string[]> => [],
    getCriticalPaths: async (): Promise<string[][]> => [],
    ...overrides,
  };
}

function makeContainer(repoIntel: RepoIntel): Container {
  return { repoIntel } as unknown as Container;
}

const REPO: OnboardingRepoRef = {
  id: 'repo-1',
  owner: 'acme',
  name: 'widgets',
  clonePath: null,
};

describe('assembleGrounding — indexed repo (non-degraded)', () => {
  it('yields index-grounded fields: repo map, top files, chains, and a chain-derived import graph', async () => {
    const repoIntel = fakeRepoIntel({
      indexState: { ...BASE_STATE, degraded: false },
      getRepoMap: async () => ({ text: 'src/index.ts: export function main()', tokens: 12, cached: true }),
      getTopFilesByRank: async () => ['src/index.ts', 'src/server.ts'],
      getCriticalPaths: async () => [['src/index.ts', 'src/server.ts']],
    });
    const result = await assembleGrounding(makeContainer(repoIntel), REPO);

    expect(result.grounding.repoName).toBe('acme/widgets');
    expect(result.grounding.repoMapText).toContain('export function main');
    expect(result.grounding.topFiles).toEqual(['src/index.ts', 'src/server.ts']);
    expect(result.grounding.criticalChains).toEqual([['src/index.ts', 'src/server.ts']]);
    expect(result.grounding.importGraph.edges).toEqual([{ from: 'src/index.ts', to: 'src/server.ts' }]);
    expect(result.grounding.importGraph.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining(['src/index.ts', 'src/server.ts']),
    );
    expect(result.grounding.readme).toBeUndefined();
    expect(result.grounding.fileTree).toBeUndefined();

    expect(result.provenance).toEqual({
      fileCount: 42,
      indexed: true,
      indexerVersion: 4,
      lastIndexedSha: 'sha-abc123',
    });
  });
});

describe('assembleGrounding — degraded / non-indexed repo (fallback)', () => {
  const tmpDirs: string[] = [];
  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it('yields README/file-tree/language-hint fields when the index is degraded', async () => {
    const clonePath = await mkdtemp(join(tmpdir(), 'onboarding-grounding-'));
    tmpDirs.push(clonePath);
    await writeFile(join(clonePath, 'README.md'), '# Widgets\nA widget service.', 'utf8');
    await mkdir(join(clonePath, 'src'), { recursive: true });
    await writeFile(join(clonePath, 'src/index.ts'), 'export const main = () => {};', 'utf8');
    await mkdir(join(clonePath, 'node_modules/dep'), { recursive: true });
    await writeFile(join(clonePath, 'node_modules/dep/index.js'), '// ignored', 'utf8');

    const repoIntel = fakeRepoIntel({
      indexState: { ...BASE_STATE, status: 'degraded', degraded: true, degradedReason: 'no_data' },
    });
    const result = await assembleGrounding(makeContainer(repoIntel), { ...REPO, clonePath });

    expect(result.grounding.readme).toContain('A widget service');
    expect(result.grounding.fileTree).toEqual(expect.arrayContaining(['README.md', 'src/index.ts']));
    expect(result.grounding.fileTree).not.toEqual(expect.arrayContaining(['node_modules/dep/index.js']));
    expect(result.grounding.languageHints!.some((h) => h.includes('TypeScript'))).toBe(true);
    expect(result.grounding.criticalChains).toEqual([]);
    expect(result.grounding.importGraph).toEqual({ nodes: [], edges: [] });

    expect(result.provenance.indexed).toBe(false);
    expect(result.provenance.fileCount).toBe(result.grounding.fileTree!.length);
  });

  it('degrades cleanly (no throw, empty grounding) when the repo has no clone yet', async () => {
    const repoIntel = fakeRepoIntel({
      indexState: { ...BASE_STATE, status: 'failed', degraded: true, degradedReason: 'index_failed' },
    });
    const result = await assembleGrounding(makeContainer(repoIntel), { ...REPO, clonePath: null });

    expect(result.grounding.readme).toBeNull();
    expect(result.grounding.fileTree).toEqual([]);
    expect(result.provenance).toEqual({
      fileCount: 0,
      indexed: false,
      indexerVersion: null,
      lastIndexedSha: null,
    });
  });

  it('treats a `status:"degraded"` state as the fallback trigger even when `degraded` itself is unset', async () => {
    // repo-intel's degraded contract: array reads silently return [] when
    // degraded, so an empty array alone must NOT be trusted as the signal —
    // only `getIndexState()` is honest. Exercise that via `status` alone.
    const clonePath = await mkdtemp(join(tmpdir(), 'onboarding-grounding-status-'));
    tmpDirs.push(clonePath);
    await writeFile(join(clonePath, 'README.md'), '# Fallback via status only', 'utf8');

    const repoIntel = fakeRepoIntel({
      indexState: { ...BASE_STATE, status: 'degraded' },
      // Even if these resolved (they shouldn't be called), fallback must win.
      getTopFilesByRank: async () => ['should-not-be-used.ts'],
    });
    const result = await assembleGrounding(makeContainer(repoIntel), { ...REPO, clonePath });

    expect(result.provenance.indexed).toBe(false);
    expect(result.grounding.readme).toContain('Fallback via status only');
  });
});
