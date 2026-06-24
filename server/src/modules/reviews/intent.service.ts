import type { Intent } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { classifyIntent } from '@devdigest/reviewer-core';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { getPull, getRepo, getIntent, upsertIntent } from './repository/pull.repo.js';
import { buildHunkHeadersBlock, buildFullPatchText, buildSpecDocsBlock } from './intent-input.js';
import { NotFoundError } from '../../platform/errors.js';

export interface ComputeIntentResult {
  intent: Intent;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  /** Tokens saved vs sending the full diff bodies. */
  savedTokens: number;
}

/**
 * IntentService — orchestrates intent classification for a PR.
 *
 * fetch fresh PrDetail from GitHub → extract hunk headers → resolve model
 * → classifyIntent → log token savings → upsertIntent.
 *
 * When GitHub is unavailable (no token), falls back to stored PR data
 * (title, body from DB) with an empty changed-files block — intent is still
 * computed, just without file context.
 */
export class IntentService {
  constructor(private readonly container: Container) {}

  /**
   * Compute (or recompute) the intent for a PR and persist it.
   * Returns the stored Intent + savings metrics.
   */
  async compute(
    workspaceId: string,
    prId: string,
    logger?: { info: (obj: unknown, msg?: string) => void },
  ): Promise<ComputeIntentResult> {
    const pull = await getPull(this.container.db, workspaceId, prId);
    if (!pull) throw new NotFoundError(`PR ${prId} not found`);

    const repo = await getRepo(this.container.db, pull.repoId);
    if (!repo) throw new NotFoundError(`Repo ${pull.repoId} not found`);

    // Fetch fresh PrDetail from GitHub for up-to-date body + files + linked issue.
    // Gracefully degrade when GitHub is unavailable.
    let freshTitle: string = pull.title;
    let freshBody: string | null | undefined = pull.body;
    let linkedIssue: { title: string; body?: string | null } | null = null;
    let files: { path: string; additions: number; deletions: number; patch?: string | null }[] = [];

    try {
      const gh = await this.container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pull.number);
      freshTitle = detail.title;
      freshBody = detail.body;
      files = detail.files;
      if (detail.linked_issue) {
        linkedIssue = { title: detail.linked_issue.title, body: detail.linked_issue.body };
      }
    } catch (err) {
      logger?.info(
        { prId, err: (err as Error).message },
        'intent: GitHub fetch failed — classifying from stored PR data only',
      );
    }

    const changedFiles = buildHunkHeadersBlock(files);
    const specDocs = buildSpecDocsBlock(files);
    const fullPatch = buildFullPatchText(files);

    // Token savings: full patches vs lean hunk-headers block.
    const fullTokens = this.container.tokenizer.count(fullPatch);
    const headersTokens = this.container.tokenizer.count(changedFiles);
    const savedTokens = Math.max(0, fullTokens - headersTokens);

    // Resolve the model for the 'review_intent' feature slot.
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'review_intent',
    );
    const llm = await this.container.llm(provider as 'openai' | 'anthropic' | 'openrouter');

    const result = await classifyIntent({
      llm,
      model,
      title: freshTitle,
      body: freshBody,
      linkedIssue,
      changedFiles,
      specDocs: specDocs || null,
    });

    logger?.info(
      {
        prId,
        model,
        tokensIn: result.tokensIn,
        savedVsFullDiff: savedTokens,
      },
      `intent: model=${model} tokensIn=${result.tokensIn} savedVsFullDiff=${savedTokens}`,
    );

    await upsertIntent(this.container.db, prId, result.intent);

    return { ...result, savedTokens };
  }

  /**
   * Read the stored intent for a PR (null when not yet computed).
   * Workspace-scoped: verifies the PR belongs to workspaceId before reading,
   * consistent with the POST compute path. Returns null when intent not yet computed.
   * Throws NotFoundError when the PR does not exist in the workspace.
   */
  async get(workspaceId: string, prId: string): Promise<Intent | null> {
    const pull = await getPull(this.container.db, workspaceId, prId);
    if (!pull) throw new NotFoundError(`PR ${prId} not found`);
    return (await getIntent(this.container.db, prId)) ?? null;
  }
}
