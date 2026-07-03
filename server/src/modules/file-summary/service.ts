import type { FileSummaryState } from '@devdigest/shared';
import { summarizeFileDiff } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModelWithFallback } from '../settings/feature-models.js';
import { getPull, getPrFiles } from '../reviews/repository/pull.repo.js';
import { classifyFile } from '../reviews/smart-diff.classify.js';
import { resolveReachableModel } from '../why-risk-brief/input.js';
import { getFileSummary, upsertFileSummary } from './repository.js';
import { hashPatch } from './hash.js';

/**
 * FileSummaryService — compute (generate + persist) and get (cached read,
 * with a model-free staleness check) for the per-file "What this does" AI
 * summary (Smart-Diff view, core-group files only, on-demand).
 *
 * Distinct from `WhyRiskBriefService`: this is per-FILE (not per-PR), keyed
 * by `(prId, path)`, and computed lazily one file at a time rather than
 * eagerly for the whole PR.
 */
export class FileSummaryService {
  constructor(private readonly container: Container) {}

  /**
   * (Re)compute the summary for one file and persist it — replacing any
   * previously cached summary for that `(prId, path)` (last-write-wins).
   *
   * - Non-core files never reach the model: `not_core` (Smart-Diff
   *   classification, purely path-based).
   * - A missing/empty patch (binary, too large, or the file isn't in this
   *   PR) → `no_diff`, no model call.
   * - No reachable LLM provider → `skipped: no_model`, persisting nothing —
   *   a prior good row is left untouched.
   * - A fresh cached row (same `patchHash`) is served without a model call
   *   unless `regenerate` is set.
   */
  async compute(
    workspaceId: string,
    prId: string,
    path: string,
    opts?: { regenerate?: boolean; logger?: { info: (obj: unknown, msg?: string) => void } },
  ): Promise<FileSummaryState> {
    const pull = await getPull(this.container.db, workspaceId, prId);
    if (!pull) throw new NotFoundError(`PR ${prId} not found`);

    if (classifyFile(path) !== 'core') return { status: 'not_core' };

    const files = await getPrFiles(this.container.db, prId);
    const file = files.find((f) => f.path === path);
    if (!file || !file.patch) return { status: 'no_diff' };

    // Standalone POST — no reviewer-run to borrow a reachable model from.
    // Probe configured providers directly; none configured → skip cleanly
    // (not an error) and persist nothing.
    const reachable = await resolveReachableModel(this.container);
    if (!reachable) return { status: 'skipped', reason: 'no_model' };

    const { provider, model } = await resolveFeatureModelWithFallback(
      this.container,
      workspaceId,
      'file_summary',
      reachable,
    );
    const llm = await this.container.llm(provider);

    const patchHash = hashPatch(file.patch);
    const existing = await getFileSummary(this.container.db, prId, path);
    if (existing && existing.patchHash === patchHash && !opts?.regenerate) {
      return { status: 'ready', summary: existing.summary, stale: false };
    }

    const result = await summarizeFileDiff({ llm, model, path, patch: file.patch });

    await upsertFileSummary(this.container.db, prId, path, {
      summary: result.summary,
      patchHash,
      model,
    });

    opts?.logger?.info(
      { prId, path, provider, model },
      `file-summary: model=${model} provider=${provider} path=${path}`,
    );

    return { status: 'ready', summary: result.summary, stale: false };
  }

  /**
   * Read the cached summary for `(prId, path)` — NEVER computes and NEVER
   * calls the LLM.
   *
   * - Non-core file → `not_core`.
   * - No row + no/empty patch → `no_diff`.
   * - No row + real patch → `not_generated`.
   * - Row present → recompute the current patch's hash (model-free) and
   *   compare against the stored one to decide `stale`, always returning
   *   the SAME cached summary either way.
   */
  async get(workspaceId: string, prId: string, path: string): Promise<FileSummaryState> {
    const pull = await getPull(this.container.db, workspaceId, prId);
    if (!pull) throw new NotFoundError(`PR ${prId} not found`);

    if (classifyFile(path) !== 'core') return { status: 'not_core' };

    const files = await getPrFiles(this.container.db, prId);
    const file = files.find((f) => f.path === path);

    const row = await getFileSummary(this.container.db, prId, path);
    if (!row) {
      return file?.patch ? { status: 'not_generated' } : { status: 'no_diff' };
    }

    const currentPatchHash = hashPatch(file?.patch ?? '');
    const stale = currentPatchHash !== row.patchHash;

    return { status: 'ready', summary: row.summary, stale };
  }
}
