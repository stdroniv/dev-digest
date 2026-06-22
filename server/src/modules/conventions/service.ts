import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LLMProvider, ConventionCandidate } from '@devdigest/shared';
import {
  extractConventions,
  verifyConventions,
  assembleConventionSkill,
  type ConventionSample,
} from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { routeModel } from '../../platform/model-router.js';
import { ConfigError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { ConventionsRepository, type RepoMeta, type UpdateConvention } from './repository.js';
import { rowToDraft, toConventionDto } from './helpers.js';

/**
 * Conventions Extractor service.
 *
 * extract(): sample the repo BY CODE (top-ranked source files + lint/ts/prettier
 * configs), ask a CHEAP model for candidate conventions, then DROP every
 * candidate whose cited evidence can't be found in the sampled files (mechanical
 * grounding — no model). Survivors persist as `pending`.
 *
 * The user accepts/rejects/edits candidates; buildSkillPreview() merges the
 * ACCEPTED ones into a single editable `repo-conventions` skill body (rejected
 * candidates can never enter it). The client persists that via POST /skills.
 */

/** How many top-ranked source files to sample (junk-filtered by repo-intel). */
const SAMPLE_FILE_COUNT = 12;
/** Per-file char budget so a huge file can't blow the prompt. */
const MAX_SAMPLE_CHARS = 8000;

/** Config files read directly — repo-intel's ranked sample junk-filters these out. */
const CONFIG_FILES = [
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.cjs',
  '.eslintrc.js',
  'eslint.config.js',
  'eslint.config.mjs',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'prettier.config.js',
  'package.json',
];

export interface ConventionSkillPreview {
  name: string;
  description: string;
  body: string;
  evidence_files: string[];
}

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  /**
   * Run a full extraction for a repo and persist the verified candidates.
   * Synchronous (the cheap model call takes a few seconds); the UI shows a spinner.
   */
  async extract(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const repo = await this.repo.getRepoMeta(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    if (!repo.clonePath) {
      throw new ValidationError('Repo is not cloned yet — refresh the repo before extracting conventions.');
    }

    const samples = await this.sample(repo);
    if (samples.length === 0) return [];

    const { llm, model } = await this.resolveCheapLlm();
    const drafts = await extractConventions({ llm, model, samples });

    // Mechanical grounding gate: only candidates whose cited snippet exists in a
    // sampled file survive. This is the "evidence with real code" guarantee.
    const files = new Map(samples.map((s) => [s.path, s.content]));
    const { kept } = verifyConventions(drafts, files);

    const runId = randomUUID();
    const rows = await this.repo.insertMany(
      workspaceId,
      repoId,
      runId,
      kept.map((d) => ({
        category: d.category,
        rule: d.rule,
        evidencePath: d.evidence.file,
        evidenceSnippet: d.evidence.snippet,
        evidenceStartLine: d.evidence.start_line,
        evidenceEndLine: d.evidence.end_line,
        confidence: d.confidence,
      })),
    );
    return rows.map(toConventionDto);
  }

  /** Accept / reject / edit one candidate. */
  async patch(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toConventionDto(row) : undefined;
  }

  /**
   * Build the editable `repo-conventions` skill from the ACCEPTED candidates only.
   * Does NOT persist — the client pre-fills the create-skill modal with this and
   * POSTs /skills (source=extracted) after the user edits. Rejected/pending
   * candidates are excluded here, so they can never reach the saved skill.
   */
  async buildSkillPreview(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionSkillPreview | undefined> {
    const repo = await this.repo.getRepoMeta(workspaceId, repoId);
    if (!repo) return undefined;
    const accepted = await this.repo.listAccepted(workspaceId, repoId);
    const { name, description, body, evidenceFiles } = assembleConventionSkill(
      accepted.map(rowToDraft),
      { repoName: repo.name },
    );
    return { name, description, body, evidence_files: evidenceFiles };
  }

  // ---- internals ----------------------------------------------------------

  /** Read config files + top-ranked source files from the clone. */
  private async sample(repo: RepoMeta): Promise<ConventionSample[]> {
    const clonePath = repo.clonePath!;
    const ranked = await this.container.repoIntel.getConventionSamples(repo.id, SAMPLE_FILE_COUNT);
    // Config files first (high signal), then ranked source files; dedupe.
    const paths = [...new Set([...CONFIG_FILES, ...ranked])];

    const samples: ConventionSample[] = [];
    for (const path of paths) {
      const content = await readFile(join(clonePath, path), 'utf8').catch(() => null);
      if (content && content.trim().length > 0) {
        samples.push({ path, content: content.slice(0, MAX_SAMPLE_CHARS) });
      }
    }
    return samples;
  }

  /**
   * Pick the first configured provider and route a CHEAP model for it. Extraction
   * is a low-stakes classification task, so we never pay flagship prices.
   */
  private async resolveCheapLlm(): Promise<{ llm: LLMProvider; model: string }> {
    const candidates: Array<{ id: 'openai' | 'anthropic' | 'openrouter'; model: string }> = [
      { id: 'openai', model: routeModel('classify', 'openai') },
      { id: 'anthropic', model: routeModel('classify', 'anthropic') },
      { id: 'openrouter', model: 'openai/gpt-4o-mini' },
    ];
    for (const c of candidates) {
      try {
        const llm = await this.container.llm(c.id);
        return { llm, model: c.model };
      } catch {
        // key not configured for this provider — try the next.
      }
    }
    throw new ConfigError('No LLM provider is configured. Add an API key in Settings to extract conventions.');
  }
}
