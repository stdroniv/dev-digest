import type { BlastRadius, FeatureModelChoice, Intent, PrHistory, UnifiedDiff } from '@devdigest/shared';
import { PrBrief } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { generateRiskBrief } from '@devdigest/reviewer-core';
import { resolveFeatureModelWithFallback } from '../settings/feature-models.js';
import { getPull, getIntent, upsertBrief } from './repository/pull.repo.js';
import { NotFoundError } from '../../platform/errors.js';

/** Valid empty placeholder for Blast radius (out of scope until a later lesson). */
const EMPTY_BLAST: BlastRadius = { changed_symbols: [], downstream: [], summary: '' };

/** Valid empty placeholder for PR History (out of scope until a later lesson). */
const EMPTY_HISTORY: PrHistory = { history: [] };

/** Valid empty placeholder for Intent (used when intent is unavailable). */
const EMPTY_INTENT: Intent = { intent: '', in_scope: [], out_of_scope: [] };

/**
 * BriefService — orchestrates risk-brief generation for a PR.
 *
 * Resolves the `risk_brief` feature-model slot, calls generateRiskBrief (pure
 * LLM step in reviewer-core), assembles a complete PrBrief (all four blocks),
 * and persists via upsertBrief. Mirrors IntentService shape.
 */
export class BriefService {
  constructor(private readonly container: Container) {}

  async compute(
    workspaceId: string,
    prId: string,
    diff: UnifiedDiff,
    opts?: {
      intent?: Intent;
      /** Known-reachable provider/model for this workspace (e.g. the reviewer agent that just ran). */
      reachableModel?: FeatureModelChoice;
      logger?: { info: (o: unknown, m?: string) => void };
    },
  ): Promise<void> {
    const pull = await getPull(this.container.db, workspaceId, prId);
    if (!pull) throw new NotFoundError(`PR ${prId} not found`);

    // Use caller-supplied intent (already loaded by the executor), fall back to
    // stored intent, then to a valid empty placeholder.
    const intent: Intent =
      opts?.intent ??
      (await getIntent(this.container.db, prId)) ??
      EMPTY_INTENT;

    // Resolve the `risk_brief` feature-model slot via three-tier policy:
    // workspace override → caller-supplied reachable model → registry default.
    const { provider, model, source } = await resolveFeatureModelWithFallback(
      this.container,
      workspaceId,
      'risk_brief',
      opts?.reachableModel,
    );
    const llm = await this.container.llm(provider);

    const result = await generateRiskBrief({
      llm,
      model,
      title: pull.title,
      body: pull.body,
      intent,
      diff,
    });

    // Assemble a complete PrBrief (all four required blocks) so getBrief's
    // safeParse never silently returns undefined. blast/history are valid
    // empty placeholders until those lessons land.
    const brief: PrBrief = {
      intent,
      blast: EMPTY_BLAST,
      risks: result.risks,
      history: EMPTY_HISTORY,
    };

    await upsertBrief(this.container.db, prId, brief);

    opts?.logger?.info(
      { prId, provider, model, source, risksCount: result.risks.risks.length },
      `risk brief: model=${model} provider=${provider} source=${source} risks=${result.risks.risks.length}`,
    );
  }
}
