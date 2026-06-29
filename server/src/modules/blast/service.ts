/**
 * blast — response-shaping service.
 *
 * BlastService.getBlast(workspaceId, prId):
 *  1. Resolves the PR + repo from the DB (throws NotFoundError when absent).
 *  2. Reads changed files from persisted pr_files.
 *  3. Calls repoIntel.getBlastRadius + getIndexState in parallel.
 *  4. Calls shapeBlastResponse (pure, exported for unit testing).
 *
 * NO model calls on this path.
 */

import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { getPull, getPrFiles } from '../reviews/repository/pull.repo.js';
import type { BlastResult, IndexState } from '../repo-intel/types.js';
import type { BlastResponse, BlastSymbolGroup } from './types.js';

/** Per-symbol caller cap (mirrors MAX_CALLERS_PER_SYMBOL on the persistent path). */
const PER_SYMBOL_CAP = 20;

/**
 * Pure shaping function — exported so the hermetic unit test can call it
 * directly without any DB or network.
 *
 * Groups the flat `result.callers` by `viaSymbol`, applies the per-symbol
 * rank-desc sort + 20-caller cap, attributes endpoints/crons via factsByFile,
 * and builds the totals + index block.
 */
export function shapeBlastResponse(result: BlastResult, state: IndexState): BlastResponse {
  const symbolGroups: BlastSymbolGroup[] = result.changedSymbols.map((sym) => {
    // Defensively exclude callers declared in the same file as the symbol
    // (a symbol's declaration file is never its own cross-file caller).
    // The facade already filters these, but this guard makes the module
    // self-enforcing so a facade regression cannot leak same-file entries.
    const callers = result.callers
      .filter((c) => c.viaSymbol === sym.name && c.file !== sym.file)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, PER_SYMBOL_CAP);

    // Attribute endpoints/crons to this symbol via factsByFile of its callers
    // AND of the symbol's own file (handles route handlers with 0 callers).
    const callerFiles = [...new Set([...callers.map((c) => c.file), sym.file])];
    const endpoints: string[] = [];
    const crons: string[] = [];
    if (result.factsByFile) {
      for (const file of callerFiles) {
        const facts = result.factsByFile[file];
        if (facts) {
          endpoints.push(...facts.endpoints);
          crons.push(...facts.crons);
        }
      }
    }

    return {
      file: sym.file,
      name: sym.name,
      kind: sym.kind,
      callers: callers.map((c) => ({
        file: c.file,
        symbol: c.symbol,
        line: c.line,
        rank: c.rank,
      })),
      endpoints: [...new Set(endpoints)],
      crons: [...new Set(crons)],
    };
  });

  // Flat union of all impacted endpoints + crons across all changed symbols.
  const impactedEndpoints = [...new Set(result.impactedEndpoints)];

  // Crons: the facade's BlastResult has no top-level impactedCrons; derive by
  // unioning factsByFile[*].crons (degraded ripgrep path has no factsByFile →
  // empty).
  const allCrons: string[] = [];
  if (result.factsByFile) {
    for (const facts of Object.values(result.factsByFile)) {
      allCrons.push(...facts.crons);
    }
  }
  const impactedCrons = [...new Set(allCrons)];

  const totals = {
    symbols: symbolGroups.length,
    callers: result.callers.length,
    endpoints: impactedEndpoints.length,
    crons: impactedCrons.length,
  };

  return {
    symbols: symbolGroups,
    totals,
    impactedEndpoints,
    impactedCrons,
    index: {
      status: state.status,
      degraded: state.degraded ?? false,
      reason: state.degradedReason,
      // Convert empty string (un-indexed repo) to null.
      lastIndexedSha: state.lastIndexedSha || null,
    },
    degraded: result.degraded ?? false,
    reason: result.reason,
    resolution: result.resolution ?? { limited: false },
  };
}

export class BlastService {
  constructor(private container: Container) {}

  async getBlast(workspaceId: string, prId: string): Promise<BlastResponse> {
    // (a) Resolve PR by (workspaceId, prId) via the shared PR repository.
    const pr = await getPull(this.container.db, workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');

    // (b) Read changed files from persisted pr_files via the shared PR repository.
    const fileRows = await getPrFiles(this.container.db, pr.id);
    const changedFiles = fileRows.map((r) => r.path);

    // (c) Call facade in parallel — zero model calls.
    // pr.repoId is used directly; the getRepo lookup was dead weight (repo.id === pr.repoId).
    const [result, state] = await Promise.all([
      this.container.repoIntel.getBlastRadius(pr.repoId, changedFiles),
      this.container.repoIntel.getIndexState(pr.repoId),
    ]);

    // (d) Shape the response.
    return shapeBlastResponse(result, state);
  }
}
