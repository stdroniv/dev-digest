import { readFileSync } from 'node:fs';
import type { CiFailOn, CiFile, Provider, ReviewStrategy } from '@devdigest/shared';
import { agentManifestFile, buildAgentManifest } from './manifest.js';
import { type PostAs, type TriggerType, workflowFile } from './workflow.js';
import { SlugAllocator } from './slug.js';
import {
  DEFAULT_RUNNER_DIST_PATH,
  DEFAULT_WORKFLOW_VERSION,
  MEMORY_FILE_PATH,
  RUNNER_FILE_PATH,
  skillFilePath,
} from './constants.js';

// Re-exported so callers (T6/T7) can catch these without importing
// `manifest.ts`/`workflow.ts` directly — `bundle.ts` is the single public
// entry point (Rec1).
export { InvalidManifestError } from './manifest.js';
export type { PostAs, TriggerType } from './workflow.js';

/**
 * The subset of an `agents` row/DTO the bundle needs to build the manifest.
 * A structural type (not the full `Agent` DTO) so tests can build a minimal
 * literal without pulling in repository types; the real `Agent` DTO
 * (`toAgentDto` in `modules/agents/helpers.ts`) satisfies this shape as-is.
 */
export interface BundleAgent {
  name: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  strategy: ReviewStrategy;
  ci_fail_on: CiFailOn;
}

/**
 * One of the agent's linked skills, as the caller (T6) resolves it from
 * `agent_skills JOIN skills` (mirrors the shape `AgentsRepository.linkedSkills`
 * already returns). `enabled: false` counts as UNRESOLVED for CI export
 * purposes (AC-12) — mirroring the production review path's own
 * enabled-only filter (server INSIGHTS.md "The skill.enabled gate now has
 * TWO independent enforcement points") — so a disabled skill's body is never
 * silently shipped to CI, and never silently dropped from the manifest's
 * `skills:` list either; export blocks and names it instead.
 */
export interface BundleSkill {
  name: string;
  body: string;
  enabled: boolean;
}

/** Thrown when a linked skill can't be bundled (AC-12) — export aborts before any file is produced. */
export class UnresolvedSkillError extends Error {
  constructor(public readonly skillName: string) {
    super(`Linked skill "${skillName}" could not be resolved for export`);
    this.name = 'UnresolvedSkillError';
  }
}

export interface BundleOptions {
  /** This agent's linked skills, in link order. Defaults to none. */
  linkedSkills?: BundleSkill[];
  /**
   * Slugs already taken by OTHER agents in the workspace (e.g. derived from
   * every other agent that has a CI installation) — consulted for AC-15
   * disambiguation. Input contract for the caller (T6, which wires the DB):
   * this set MUST EXCLUDE the current agent's own previously-derived slug,
   * so re-exporting the SAME agent keeps producing the SAME slug and stays
   * idempotent (AC-17) — only a genuinely different agent's colliding name
   * should ever force a disambiguating suffix. Defaults to empty (no other
   * exported agents yet).
   */
  existingSlugs?: Iterable<string>;
  /** Bumped by the caller on every (re-)export/config update (AC-41). Defaults to 1 (first export). */
  workflowVersion?: number;
  /** CI trigger event types (AC-6). Defaults to `['opened', 'synchronize']`. */
  triggers?: TriggerType[];
  /** "Post results as" (AC-7/19). Defaults to `'github_review'`. */
  postAs?: PostAs;
  /** Override where the committed runner build is read from (tests only — production always reads `runner/dist/runner.mjs`). */
  runnerDistPath?: string;
}

export interface Bundle {
  /** The slug this bundle was keyed under (AC-15/16) — callers persist/reuse it for idempotent re-export (AC-17). */
  slug: string;
  /** The exact, ordered committed file set (AC-2) — preview, the zip download, and install all read this SAME array (Rec1/AC-11). */
  files: CiFile[];
}

/**
 * The single "assemble bundle" generator (Rec1). The Preview step, the zip
 * download, and the install (commit+PR) path all call this so every path
 * validates identically BEFORE any commit ever happens (AC-11): skill
 * resolution (AC-12) and manifest validation (AC-14) both run here, and a
 * thrown error means no `CiFile` was ever produced, so nothing partial can
 * leak downstream into a commit.
 */
export function assembleBundle(agent: BundleAgent, options: BundleOptions = {}): Bundle {
  const linkedSkills = options.linkedSkills ?? [];

  // AC-12 first, before any slug/manifest work — block + name the skill,
  // produce nothing.
  for (const skill of linkedSkills) {
    if (!skill.enabled) throw new UnresolvedSkillError(skill.name);
  }

  const agentSlug = new SlugAllocator(options.existingSlugs).allocate(agent.name);

  // Skill files live in their own `.devdigest/skills/` namespace — only need
  // to be unique against EACH OTHER within this bundle (see slug.ts's
  // SlugAllocator input-contract doc).
  const skillSlugs = new SlugAllocator();
  const resolvedSkills = linkedSkills.map((skill) => ({
    slug: skillSlugs.allocate(skill.name),
    ...skill,
  }));

  const manifest = buildAgentManifest({
    name: agent.name,
    slug: agentSlug,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.system_prompt,
    skills: resolvedSkills.map((s) => s.slug),
    strategy: agent.strategy,
    ci_fail_on: agent.ci_fail_on,
    workflow_version: options.workflowVersion ?? DEFAULT_WORKFLOW_VERSION,
  });

  const runnerContents = readCommittedRunner(options.runnerDistPath ?? DEFAULT_RUNNER_DIST_PATH);

  // AC-2 order: manifest, one file per linked skill, the empty memory.jsonl,
  // the bundled runner, then the workflow.
  const files: CiFile[] = [
    agentManifestFile(manifest),
    ...resolvedSkills.map(
      (s): CiFile => ({ path: skillFilePath(s.slug), contents: s.body, editable: true }),
    ),
    { path: MEMORY_FILE_PATH, contents: '', editable: true },
    { path: RUNNER_FILE_PATH, contents: runnerContents, editable: true },
    workflowFile({ slug: agentSlug, postAs: options.postAs, triggers: options.triggers }),
  ];

  return { slug: agentSlug, files };
}

function readCommittedRunner(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `Could not read the committed CI runner build at "${path}" — build it first (cd runner && node build.mjs).`,
      { cause: err },
    );
  }
}
