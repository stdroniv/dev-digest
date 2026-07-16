// Value import — `.safeParse` is a runtime call; a type-only import silently
// strips it to zero bytes at compile time (server INSIGHTS.md:99).
import { CiResultArtifact } from '@devdigest/shared';
import type { CiFailOn, CiRunStatus, GitHubClient, RepoRef, WorkflowRunMeta } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConfigError } from '../../platform/errors.js';
import { workflowFileName } from './constants.js';
import {
  type ArtifactSeverityCounts,
  blockersFromCounts,
  deriveTerminalStatus,
  parseRepoRef,
  resolveAgentSlug,
} from './helpers.js';
import { CiRepository } from './repository.js';

/**
 * T6 — pull GitHub Actions runs + `devdigest-result.json` artifacts into
 * `ci_runs` + `agent_runs(source='ci')` (AC-30/31/32/33/34).
 */

const ARTIFACT_NAME = 'devdigest-result.json';
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_PER_PAGE = 20;

export interface ReconcileOptions {
  /** Bounds the Actions-run window to the last N days per installation (AC-34). Defaults to 7. */
  windowDays?: number;
  /** Bounds the number of runs fetched per installation (AC-34). Defaults to 20. */
  perPage?: number;
  /** Best-effort structured logger for per-installation failures (see below). */
  logger?: { warn: (obj: unknown, msg?: string) => void };
}

export interface ReconcileSummary {
  installationsChecked: number;
  /** Installations whose GitHub calls failed (deleted repo, no access, rate limit, …)
   *  and were skipped rather than aborting the whole sweep (see per-installation catch below). */
  installationsFailed: number;
  runsSeen: number;
  ciRunsUpserted: number;
  agentRunsCreated: number;
}

export interface RunOutcome {
  status: CiRunStatus;
  findingsCount: number | null;
  costUsd: number | null;
  durationMs: number | null;
  prNumber: number | null;
  /** Best-effort PR title (AC-35's Pull request column) — null when unknown or lookup fails. */
  prTitle: string | null;
  /** Per-severity breakdown from the artifact — fills the CI Runs page Findings column (AC-35). */
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
  /** Findings that trip the agent's "Fail CI on" gate; null when unknown (running/failed, AC-31/32). */
  blockers: number | null;
  /** Failure/skip note (AC-31/32) — written to `agent_runs.error`. Null on a clean success. */
  note: string | null;
}

/**
 * Derive the terminal (or `running`) outcome for one Actions run. Only
 * `completed` runs are inspected for an artifact (AC-32); `queued`/
 * `in_progress` map straight to `running` with no fabricated data.
 */
export async function deriveRunOutcome(
  github: GitHubClient,
  repo: RepoRef,
  run: WorkflowRunMeta,
  ciFailOn: CiFailOn,
): Promise<RunOutcome> {
  if (run.status !== 'completed') {
    return {
      status: 'running',
      findingsCount: null,
      costUsd: null,
      durationMs: null,
      prNumber: null,
      prTitle: null,
      critical: null,
      warning: null,
      suggestion: null,
      blockers: null,
      note: null,
    };
  }

  // Presence-checked by the caller before this is ever invoked; `!` is safe here.
  const bytes = await github.downloadRunArtifact!(repo, run.id, ARTIFACT_NAME);
  if (bytes === null) {
    return {
      status: 'failed',
      findingsCount: null,
      costUsd: null,
      durationMs: null,
      prNumber: null,
      prTitle: null,
      critical: null,
      warning: null,
      suggestion: null,
      blockers: null,
      note: 'No result artifact was found for this run — the job likely failed or errored before upload.',
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (err) {
    return {
      status: 'failed',
      findingsCount: null,
      costUsd: null,
      durationMs: null,
      prNumber: null,
      prTitle: null,
      critical: null,
      warning: null,
      suggestion: null,
      blockers: null,
      note: `Result artifact was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const parsed = CiResultArtifact.safeParse(json);
  if (!parsed.success) {
    return {
      status: 'failed',
      findingsCount: null,
      costUsd: null,
      durationMs: null,
      prNumber: null,
      prTitle: null,
      critical: null,
      warning: null,
      suggestion: null,
      blockers: null,
      note: `Result artifact failed schema validation: ${parsed.error.message}`,
    };
  }

  const artifact = parsed.data;
  // findings_count ALONE decides succeeded vs no_findings — never severity —
  // so a run that found CRITICALs is still `succeeded` (AC-33).
  const status = deriveTerminalStatus({ status: artifact.status, findings_count: artifact.findings_count });
  const counts: ArtifactSeverityCounts = {
    critical: artifact.critical ?? 0,
    warning: artifact.warning ?? 0,
    suggestion: artifact.suggestion ?? 0,
  };
  // skipped_no_credentials never blocks a merge (AC-27), regardless of counts.
  const blockers = status === 'skipped_no_credentials' ? 0 : blockersFromCounts(counts, ciFailOn);

  // Best-effort PR title (AC-35's Pull request column) — a lookup failure (no
  // token, deleted PR, rate limit, …) degrades to null; it never fails ingest.
  let prTitle: string | null = null;
  if (artifact.pr_number != null) {
    try {
      const pr = await github.getPullRequest(repo, artifact.pr_number);
      prTitle = pr?.title ?? null;
    } catch {
      prTitle = null;
    }
  }

  return {
    status,
    findingsCount: artifact.findings_count,
    costUsd: artifact.cost_usd,
    durationMs: artifact.duration_ms ?? null,
    prNumber: artifact.pr_number ?? null,
    prTitle,
    critical: artifact.critical ?? null,
    warning: artifact.warning ?? null,
    suggestion: artifact.suggestion ?? null,
    blockers,
    note: null,
  };
}

/**
 * Sweep every installation across every workspace, pulling recent Actions
 * runs + artifacts (AC-34) and digesting them into `ci_runs` + a matching
 * `agent_runs(source='ci')` row (AC-30). Safe to call repeatedly: `ci_runs`
 * is upserted by `(ci_installation_id, actions_run_id)` (the T4 unique key),
 * and `agent_runs` is written exactly once per Actions run — on the
 * reconcile call that FIRST observes a terminal status for it (see
 * `CiRepository.upsertCiRun`'s `justBecameTerminal`) — so a re-reconcile of
 * an already-terminal run updates `ci_runs` in place without inserting a
 * second `agent_runs` row.
 */
export async function reconcileCiRuns(
  container: Container,
  opts: ReconcileOptions = {},
): Promise<ReconcileSummary> {
  const repo = new CiRepository(container.db);
  const github = await container.github();
  if (!github.listWorkflowRuns || !github.downloadRunArtifact) {
    // Optional adapter methods — absence is a config/wiring problem, not a
    // crash (server INSIGHTS.md: guard optional port methods, don't assume).
    throw new ConfigError(
      'The configured GitHub client does not support CI Actions reconcile (listWorkflowRuns/downloadRunArtifact).',
    );
  }

  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const perPage = opts.perPage ?? DEFAULT_PER_PAGE;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const installations = await repo.listAllInstallations();
  let runsSeen = 0;
  let ciRunsUpserted = 0;
  let agentRunsCreated = 0;
  let installationsFailed = 0;

  for (const installation of installations) {
    try {
      const agent = await repo.getAgentConfig(installation.agentId);
      if (!agent) continue; // orphaned installation (agent deleted underneath it) — skip, don't crash the sweep

      const otherNames = await repo.otherExportedAgentNames(agent.workspaceId, installation.agentId);
      const existingSlugs = new Set<string>();
      for (const name of otherNames) existingSlugs.add(resolveAgentSlug(name, existingSlugs));
      const slug = resolveAgentSlug(agent.name, existingSlugs);

      const repoRef = parseRepoRef(installation.repo);
      const runs = await github.listWorkflowRuns(repoRef, {
        workflowFileName: workflowFileName(slug),
        since,
        perPage,
      });

      for (const run of runs) {
        runsSeen++;
        const outcome = await deriveRunOutcome(github, repoRef, run, agent.ciFailOn);

        const { justBecameTerminal } = await repo.upsertCiRun({
          ciInstallationId: installation.id,
          actionsRunId: run.id,
          prNumber: outcome.prNumber,
          prTitle: outcome.prTitle,
          ranAt: new Date(run.createdAt),
          status: outcome.status,
          findingsCount: outcome.findingsCount,
          critical: outcome.critical,
          warning: outcome.warning,
          suggestion: outcome.suggestion,
          durationMs: outcome.durationMs,
          costUsd: outcome.costUsd,
          githubUrl: run.htmlUrl,
          source: 'ci',
        });
        ciRunsUpserted++;

        if (justBecameTerminal) {
          await repo.insertAgentRun({
            workspaceId: agent.workspaceId,
            agentId: installation.agentId,
            provider: agent.provider,
            model: agent.model,
            status: outcome.status,
            error: outcome.note,
            findingsCount: outcome.findingsCount,
            blockers: outcome.blockers,
            costUsd: outcome.costUsd,
            durationMs: outcome.durationMs,
          });
          agentRunsCreated++;
        }
      }
    } catch (err) {
      // One installation's repo being deleted/inaccessible/rate-limited (a real
      // GitHub 404/403/429) must not abort every OTHER installation's reconcile —
      // skip it and keep sweeping (AC-34 is best-effort across the whole fleet).
      installationsFailed++;
      opts.logger?.warn(
        { installationId: installation.id, repo: installation.repo, err: (err as Error).message },
        'reconcile: skipping installation after a GitHub API failure',
      );
    }
  }

  return {
    installationsChecked: installations.length,
    installationsFailed,
    runsSeen,
    ciRunsUpserted,
    agentRunsCreated,
  };
}
