import type { Intent, SmartDiff, WhyRiskBriefState } from '@devdigest/shared';
import { generateWhyRiskBrief, selectContextDocs, WHY_RISK_BRIEF_DOC_BUDGET_TOKENS } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModelWithFallback } from '../settings/feature-models.js';
import { getPull, getRepo, getIntent, getPrFiles } from '../reviews/repository/pull.repo.js';
import { BlastService } from '../blast/service.js';
import type { BlastResponse } from '../blast/types.js';
import { SmartDiffService } from '../reviews/smart-diff.service.js';
import { DocumentsService, type RepoCloneRef } from '../documents/service.js';
import { getWhyRiskBrief, upsertWhyRiskBrief } from './repository.js';
import { buildBlastBlock, buildSmartDiffBlock, extractChangedFiles, resolveReachableModel } from './input.js';
import { fingerprintInputs } from './fingerprint.js';

/** Valid empty placeholder for Intent — used only as a defensive fallback in `get()`
 * for the (practically unreachable) case where a brief row exists but the intent
 * that produced it has since been cleared. */
const EMPTY_INTENT: Intent = { intent: '', in_scope: [], out_of_scope: [] };

/** Per-optional-input degradation status recorded on every `compute()` (AC-19/22). */
type DegradedStatus = 'ok' | 'degraded' | 'missing';

export interface DegradedInputs {
  blast: DegradedStatus;
  smartDiff: DegradedStatus;
  issue: DegradedStatus;
  docs: DegradedStatus;
}

/**
 * WhyRiskBriefService — compute (generate + persist) and get (cached read,
 * with a model-free staleness check) for the standalone Why+Risk Brief
 * (SPEC-03). Deliberately NOT named `BriefService` — that name belongs to the
 * pre-existing composite `pr_brief` service (`reviews/brief.service.ts`),
 * which this module never reads or writes.
 */
export class WhyRiskBriefService {
  private readonly blastService: BlastService;
  private readonly smartDiffService: SmartDiffService;
  private readonly documentsService: DocumentsService;

  constructor(private readonly container: Container) {
    this.blastService = new BlastService(container);
    this.smartDiffService = new SmartDiffService(container);
    this.documentsService = new DocumentsService(container);
  }

  /**
   * (Re)compute the Why+Risk Brief for a PR and persist it — replacing any
   * previously cached brief (last-write-wins, AC-11).
   *
   * - Intent is the ONLY mandatory input (AC-17): no intent → `not_available`,
   *   with NO model call (AC-18).
   * - No reachable LLM provider → `skipped: no_model`, persisting nothing
   *   (AC-20) — a prior good row is left untouched.
   * - Every other input (blast, smart diff, linked issue, Context docs) is an
   *   optional enricher: each degrades to `null`/absent independently, without
   *   throwing and without aborting the brief (AC-19/21/22).
   */
  async compute(
    workspaceId: string,
    prId: string,
    opts?: { logger?: { info: (obj: unknown, msg?: string) => void } },
  ): Promise<WhyRiskBriefState> {
    const pull = await getPull(this.container.db, workspaceId, prId);
    if (!pull) throw new NotFoundError(`PR ${prId} not found`);

    const intent = await getIntent(this.container.db, prId);
    if (!intent) return { status: 'not_available' };

    // Standalone POST — no reviewer-run to borrow a reachable model from.
    // Probe configured providers directly; none configured → skip cleanly
    // (not an error) and persist nothing.
    const reachable = await resolveReachableModel(this.container);
    if (!reachable) return { status: 'skipped', reason: 'no_model' };

    const { provider, model } = await resolveFeatureModelWithFallback(
      this.container,
      workspaceId,
      'why_risk_brief',
      reachable,
    );
    const llm = await this.container.llm(provider);

    const repo = await getRepo(this.container.db, pull.repoId);

    const degradedInputs: DegradedInputs = {
      blast: 'missing',
      smartDiff: 'missing',
      issue: 'missing',
      docs: 'missing',
    };

    // ---- Blast radius (optional; diff-only/degraded repos are fine, AC-22) ----
    let blast: BlastResponse | null = null;
    try {
      blast = await this.blastService.getBlast(workspaceId, prId);
      degradedInputs.blast = blast.degraded ? 'degraded' : 'ok';
    } catch {
      blast = null; // stays 'missing'
    }

    // ---- Smart diff (optional; grouped diff stats) ----
    let smartDiff: SmartDiff | null = null;
    try {
      smartDiff = await this.smartDiffService.get(workspaceId, prId);
      degradedInputs.smartDiff = 'ok';
    } catch {
      smartDiff = null; // stays 'missing'
    }

    // ---- Linked issue (optional; absence is not a failure, AC-21) ----
    let linkedIssue: { title: string; body?: string | null } | null = null;
    if (repo) {
      try {
        const gh = await this.container.github();
        const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pull.number);
        if (detail.linked_issue) {
          linkedIssue = { title: detail.linked_issue.title, body: detail.linked_issue.body };
          degradedInputs.issue = 'ok';
        }
      } catch {
        // No GitHub token configured, or the fetch failed — no resolvable
        // issue; generate without it (AC-21). Stays 'missing'.
      }
    }

    // ---- Context docs (optional; budget-selected subset, AC-23/24) ----
    let contextDocs: { path: string; content: string }[] = [];
    let docsTruncated = false;
    if (repo) {
      try {
        const cloneRef: RepoCloneRef = { id: repo.id, workspaceId: repo.workspaceId, clonePath: repo.clonePath };
        const discovered = await this.documentsService.discover(cloneRef);
        if (discovered.cloned) {
          const { selected, truncated } = selectContextDocs(discovered.documents, WHY_RISK_BRIEF_DOC_BUDGET_TOKENS);
          docsTruncated = truncated;
          degradedInputs.docs = 'ok';
          for (const doc of selected) {
            const content = await this.documentsService.readContent(cloneRef, doc.path);
            if (content != null) contextDocs.push({ path: doc.path, content });
          }
        }
      } catch {
        // Repo not cloned / read failed — no Context docs. Stays 'missing'.
      }
    }

    // ---- Grounding oracles: REAL changed files + REAL blast-impacted endpoints ----
    const fileRows = await getPrFiles(this.container.db, prId);
    const changedFiles = extractChangedFiles(fileRows);
    const impactedEndpoints = blast?.impactedEndpoints ?? [];

    const blastBlock = blast ? buildBlastBlock(blast) : null;
    const smartDiffBlock = smartDiff ? buildSmartDiffBlock(smartDiff) : null;

    const result = await generateWhyRiskBrief({
      llm,
      model,
      intent,
      blastBlock,
      smartDiffBlock,
      linkedIssue,
      contextDocs,
      changedFiles,
      impactedEndpoints,
    });

    const inputsFingerprint = fingerprintInputs(intent, blast, smartDiff);

    await upsertWhyRiskBrief(this.container.db, prId, {
      brief: result.brief,
      docsTruncated,
      degradedInputs,
      inputsFingerprint,
      model,
      costUsd: result.costUsd,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });

    opts?.logger?.info(
      { prId, provider, model, degradedInputs, docsTruncated },
      `why-risk-brief: model=${model} provider=${provider} risks=${result.brief.risks.length} focus=${result.brief.review_focus.length}`,
    );

    return {
      status: 'ready',
      brief: result.brief,
      stale: false,
      docs_truncated: docsTruncated,
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Read the cached Why+Risk Brief for a PR — NEVER computes (AC-14) and
   * NEVER calls the LLM (AC-16).
   *
   * - No row + no intent → `not_available` (AC-18).
   * - No row + intent present → `not_generated` (AC-13).
   * - Row present → recompute the DETERMINISTIC inputs (intent + blast +
   *   smart diff — all model-free) and compare their fingerprint against the
   *   stored one to decide `stale` (AC-15), always returning the SAME cached
   *   brief either way (AC-16).
   */
  async get(workspaceId: string, prId: string): Promise<WhyRiskBriefState> {
    const pull = await getPull(this.container.db, workspaceId, prId);
    if (!pull) throw new NotFoundError(`PR ${prId} not found`);

    const row = await getWhyRiskBrief(this.container.db, prId);
    if (!row) {
      const intent = await getIntent(this.container.db, prId);
      return intent ? { status: 'not_generated' } : { status: 'not_available' };
    }

    const intent = (await getIntent(this.container.db, prId)) ?? EMPTY_INTENT;

    let blast: BlastResponse | null = null;
    try {
      blast = await this.blastService.getBlast(workspaceId, prId);
    } catch {
      blast = null;
    }

    let smartDiff: SmartDiff | null = null;
    try {
      smartDiff = await this.smartDiffService.get(workspaceId, prId);
    } catch {
      smartDiff = null;
    }

    const currentFingerprint = fingerprintInputs(intent, blast, smartDiff);
    const stale = currentFingerprint !== row.inputsFingerprint;

    return {
      status: 'ready',
      brief: row.brief,
      stale,
      docs_truncated: row.docsTruncated,
      generated_at: row.generatedAt.toISOString(),
    };
  }
}
