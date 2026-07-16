import { createHash } from 'node:crypto';
import type {
  CiFailOn,
  CiInstallation,
  CiRunStatus,
  CiTarget,
  Provider,
  ReviewStrategy,
  RepoRef,
} from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { buildAgentManifest } from './manifest.js';
import { SlugAllocator } from './slug.js';
import type { BundleAgent } from './bundle.js';

/**
 * Pure helpers for the `ci` module's install/reconcile/drift logic (T6). No
 * I/O — DB access lives in `repository.ts`, GitHub calls in
 * `service.ts`/`reconcile.ts`.
 */

// ---- agent row -> bundle input ---------------------------------------------

/** The subset of a persisted `agents` row the CI module needs. Matches
 *  `bundle.ts`'s `BundleAgent` field-for-field except for casing, so mapping
 *  is a straight rename. */
export interface AgentConfigRow {
  name: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  ciFailOn: CiFailOn;
}

/** Map a persisted agent row to the shape `bundle.ts`'s `assembleBundle` needs. */
export function toBundleAgent(row: AgentConfigRow): BundleAgent {
  return {
    name: row.name,
    provider: row.provider,
    model: row.model,
    system_prompt: row.systemPrompt,
    strategy: row.strategy,
    ci_fail_on: row.ciFailOn,
  };
}

// ---- repo ref parsing -------------------------------------------------------

const REPO_REF_RE = /^([^/]+)\/([^/]+)$/;

/**
 * Parse "owner/name" into a `RepoRef` (AC-9). Throws `ValidationError` on any
 * other shape — the same defensive validation a route schema would also
 * apply; the service does its own check rather than trusting the caller
 * (server INSIGHTS.md: validate path/ref-like input at write time).
 */
export function parseRepoRef(repo: string): RepoRef {
  const m = REPO_REF_RE.exec(repo.trim());
  if (!m) throw new ValidationError(`Invalid repo "${repo}" — expected "owner/name"`);
  return { owner: m[1]!, name: m[2]! };
}

// ---- slug resolution (mirrors bundle.ts's own allocator use) ---------------

/**
 * Resolve the slug this agent's name currently allocates to, given the set of
 * slugs already taken by every OTHER exported agent (AC-15/17) — the exact
 * same computation `assembleBundle` makes internally via `SlugAllocator`, so
 * a caller who isn't assembling a full bundle (the drift check, reconcile's
 * workflow-filename lookup) can recover the same filename-keying slug
 * without the file I/O `assembleBundle` requires (reading the committed
 * runner build) or the AC-12 disabled-skill gate it enforces.
 */
export function resolveAgentSlug(name: string, existingSlugs: Iterable<string>): string {
  return new SlugAllocator(existingSlugs).allocate(name);
}

// ---- config hash (drift, AC-40) --------------------------------------------

/**
 * The agent's CURRENT config hash — independent of any particular
 * export/`workflow_version` — compared against
 * `ci_installations.installed_config_hash` to detect drift (AC-40). Built
 * from the SAME `buildAgentManifest` (manifest.ts) the bundle's own manifest
 * file is serialized from, so drift is exact (T6 gotcha), with
 * `workflow_version` excluded from the hashed object: it's a monotonically
 * bumped install-time counter, not part of the agent's config, and must not
 * itself cause drift (otherwise every re-export would "drift" again
 * immediately after being installed).
 */
export function computeConfigHash(agent: BundleAgent, skillNames: string[], slug: string): string {
  const skillAllocator = new SlugAllocator();
  const skillSlugs = skillNames.map((n) => skillAllocator.allocate(n));
  const manifest = buildAgentManifest({
    name: agent.name,
    slug,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.system_prompt,
    skills: skillSlugs,
    strategy: agent.strategy,
    ci_fail_on: agent.ci_fail_on,
    workflow_version: 0,
  });
  const { workflow_version: _workflowVersion, ...configOnly } = manifest;
  return createHash('sha256').update(JSON.stringify(configOnly)).digest('hex');
}

// ---- blockers from artifact severity counts --------------------------------

/** Mirrors reviewer-core's `FAIL_ON_MIN_RANK` (`output/to-review.ts`) —
 *  duplicated here (not imported) because that table is an internal, not a
 *  package-root export, and the codebase convention is to only import
 *  shared logic through a package's PUBLIC surface. */
const FAIL_ON_MIN_RANK: Record<CiFailOn, number> = {
  never: Number.POSITIVE_INFINITY,
  critical: 3,
  warning: 2,
  any: 1,
};

export interface ArtifactSeverityCounts {
  critical: number;
  warning: number;
  suggestion: number;
}

/**
 * How many of the artifact's findings trip the agent's "Fail CI on" gate —
 * the CI-run counterpart of reviewer-core's `countBlockers`, which operates
 * on `Finding[]` (unavailable here: the artifact carries per-severity
 * aggregates only, never individual findings — AC-30).
 */
export function blockersFromCounts(counts: ArtifactSeverityCounts, failOn: CiFailOn): number {
  const min = FAIL_ON_MIN_RANK[failOn];
  let n = 0;
  if (3 >= min) n += counts.critical;
  if (2 >= min) n += counts.warning;
  if (1 >= min) n += counts.suggestion;
  return n;
}

// ---- terminal status derivation (AC-31/32/33) ------------------------------

/**
 * Derive the terminal `ci_runs`/`agent_runs` status from a SCHEMA-VALID
 * artifact. `status: 'skipped_no_credentials'` is reported explicitly by the
 * runner (AC-27); otherwise the outcome is derived from `findings_count`
 * ALONE — never from severity/blockers — so a run that executed successfully
 * and produced CRITICAL findings is still `succeeded` (AC-33). `failed` is
 * reserved for the runner itself failing to produce a review (missing or
 * schema-invalid artifact) and is decided by the CALLER before this function
 * is ever reached — it never returns `failed`.
 */
export function deriveTerminalStatus(artifact: {
  status?: CiRunStatus | null;
  findings_count: number;
}): Exclude<CiRunStatus, 'failed' | 'running'> {
  if (artifact.status === 'skipped_no_credentials') return 'skipped_no_credentials';
  return artifact.findings_count > 0 ? 'succeeded' : 'no_findings';
}

// ---- CiInstallation DTO -----------------------------------------------------

export interface InstallationDtoInput {
  id: string;
  agentId: string;
  repo: string;
  targetType: CiTarget;
  installedAt: Date;
  workflowVersion: number;
}

/** Map a persisted installation row + read-time-derived fields (AC-39/40) to
 *  the public `CiInstallation` DTO. */
export function toCiInstallationDto(
  row: InstallationDtoInput,
  status: CiRunStatus | null,
  lastRunAt: Date | null,
  updateAvailable: boolean,
): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    target: row.targetType,
    installed_at: row.installedAt.toISOString(),
    workflow_version: row.workflowVersion,
    status,
    last_run_at: lastRunAt ? lastRunAt.toISOString() : null,
    update_available: updateAvailable,
  };
}
