import { basename } from 'node:path';
import type { OnboardingGrounding } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { findReadme, walkFileTree, computeLanguageHints } from './language-heuristics.js';

/**
 * Grounding assembler (SPEC-02 T4). Produces the exact `OnboardingGrounding`
 * shape reviewer-core's `generateOnboardingSection` (T2) expects, plus the raw
 * provenance inputs the service (T5) needs to build `TourProvenance`.
 *
 * For an indexed repo (AC-31): pulls the repo map, top-ranked files, and
 * dependency chains from `container.repoIntel` and derives the diagram's
 * import graph from those chains (Rec 3 — grounded in repo-intel's own graph,
 * not free-form LLM edges).
 *
 * For a non-indexed repo (AC-32): falls back to a README + bounded file-tree
 * scan + language heuristics over the clone — never fails, never throws.
 *
 * Grounding is SECTION-INVARIANT: the same assembled grounding is reused for
 * all five sections of a whole-tour run (and for a single-section regen), so
 * this is called once per generation run, not once per section.
 */

/** Minimal repo shape this module needs — a structural subset of the `repos` row. */
export interface OnboardingRepoRef {
  id: string;
  owner: string;
  name: string;
  clonePath: string | null;
}

export interface GroundingProvenance {
  /** Files indexed (indexed repo) or files found by the file-tree walk (fallback). */
  fileCount: number;
  indexed: boolean;
  indexerVersion: number | null;
  lastIndexedSha: string | null;
}

export interface AssembledGrounding {
  grounding: OnboardingGrounding;
  provenance: GroundingProvenance;
}

/** How many top-ranked / file-tree files to surface as grounding candidates. */
const TOP_FILES_COUNT = 15;
/** Token budget for the cached repo-map text pulled from repo-intel. */
const REPO_MAP_TOKEN_BUDGET = 1500;
/** Extra top-ranked files seeded as standalone diagram nodes (Rec 3). */
const DIAGRAM_SEED_NODES = 8;

export async function assembleGrounding(
  container: Container,
  repo: OnboardingRepoRef,
): Promise<AssembledGrounding> {
  const state = await container.repoIntel.getIndexState(repo.id);
  // repo-intel is a DEGRADED contract (server/INSIGHTS): array reads silently
  // return [] when degraded, so the degraded/failed status is the ONLY honest
  // trigger for the fallback path — an empty array alone is not sufficient.
  const isDegraded =
    state.degraded === true || state.status === 'degraded' || state.status === 'failed';

  if (!isDegraded) {
    return assembleIndexedGrounding(container, repo, state);
  }
  return assembleFallbackGrounding(repo, state);
}

async function assembleIndexedGrounding(
  container: Container,
  repo: OnboardingRepoRef,
  state: Awaited<ReturnType<Container['repoIntel']['getIndexState']>>,
): Promise<AssembledGrounding> {
  const [repoMap, topFiles, criticalChains] = await Promise.all([
    container.repoIntel.getRepoMap(repo.id, REPO_MAP_TOKEN_BUDGET),
    container.repoIntel.getTopFilesByRank(repo.id, TOP_FILES_COUNT),
    container.repoIntel.getCriticalPaths(repo.id),
  ]);

  return {
    grounding: {
      repoName: `${repo.owner}/${repo.name}`,
      repoMapText: repoMap.text,
      topFiles,
      criticalChains,
      importGraph: buildImportGraph(criticalChains, topFiles),
    },
    provenance: {
      fileCount: state.filesIndexed,
      indexed: true,
      indexerVersion: state.indexerVersion,
      lastIndexedSha: state.lastIndexedSha || null,
    },
  };
}

async function assembleFallbackGrounding(
  repo: OnboardingRepoRef,
  state: Awaited<ReturnType<Container['repoIntel']['getIndexState']>>,
): Promise<AssembledGrounding> {
  const repoName = `${repo.owner}/${repo.name}`;
  const emptyGrounding: OnboardingGrounding = {
    repoName,
    repoMapText: '',
    topFiles: [],
    criticalChains: [],
    importGraph: { nodes: [], edges: [] },
    readme: null,
    fileTree: [],
    languageHints: [],
  };

  if (!repo.clonePath) {
    return {
      grounding: emptyGrounding,
      provenance: { fileCount: 0, indexed: false, indexerVersion: null, lastIndexedSha: null },
    };
  }

  const [readme, fileTree] = await Promise.all([
    findReadme(repo.clonePath),
    walkFileTree(repo.clonePath),
  ]);
  const languageHints = computeLanguageHints(fileTree);

  return {
    grounding: {
      ...emptyGrounding,
      topFiles: fileTree.slice(0, TOP_FILES_COUNT),
      readme,
      fileTree,
      languageHints,
    },
    provenance: {
      fileCount: fileTree.length,
      indexed: false,
      indexerVersion: state.indexerVersion ?? null,
      lastIndexedSha: state.lastIndexedSha || null,
    },
  };
}

/**
 * Derive the architecture diagram's import graph from repo-intel's dependency
 * chains (Rec 3): each chain's consecutive pairs become edges, every path in
 * every chain becomes a node, and a handful of extra top-ranked files are
 * seeded as standalone nodes so a repo with no discovered chains still gets a
 * non-empty diagram.
 */
function buildImportGraph(
  chains: string[][],
  topFiles: string[],
): OnboardingGrounding['importGraph'] {
  const nodeIds = new Set<string>();
  const edges: { from: string; to: string }[] = [];
  for (const chain of chains) {
    for (const path of chain) nodeIds.add(path);
    for (let i = 0; i < chain.length - 1; i += 1) {
      edges.push({ from: chain[i]!, to: chain[i + 1]! });
    }
  }
  for (const path of topFiles.slice(0, DIAGRAM_SEED_NODES)) nodeIds.add(path);
  const nodes = [...nodeIds].map((id) => ({ id, label: basename(id) }));
  return { nodes, edges };
}
