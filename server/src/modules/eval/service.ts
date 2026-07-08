import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Agent,
  EvalCase,
  EvalComparison,
  EvalDashboard,
  EvalExpectedFinding,
  EvalMetricDelta,
  EvalOwnerKind,
  EvalRunGroup,
  EvalRunRecord,
  EvalTrendPoint,
  LLMProvider,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { AgentVersionConfig, EvalExpectedFinding as EvalExpectedFindingSchema } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { resolveFeatureModelWithFallback } from '../settings/feature-models.js';
import { toAgentDto } from '../agents/helpers.js';
import type { AgentRow } from '../../db/rows.js';
import {
  aggregate,
  computeCitationAccuracy,
  computePrecision,
  computeRecall,
  matchFinding,
  type AggregateResult,
  type PerCaseScore,
  type ScorableFinding,
} from './scoring/index.js';
import { EvalRepository, type EvalCaseRow, type EvalRunRow, type RunGroupRows } from './repository.js';

/**
 * T6 — eval application layer: create-from-finding (freeze), run orchestration
 * (real reviewer OR an injected mock — AC-11/T5), dashboard/trend, comparison,
 * and promote. No I/O of its own beyond the injected `Container` + repository.
 */

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalOwnerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles ?? null,
    input_meta: row.inputMeta ?? null,
    expected_output: row.expectedOutput ?? [],
    notes: row.notes,
  };
}

/** Parse a case's `expected_output` jsonb into typed expectations. A
 *  malformed/legacy shape degrades to `[]` rather than throwing (AC-20). */
function parseExpected(row: Pick<EvalCaseRow, 'expectedOutput'>): EvalExpectedFinding[] {
  const parsed = z.array(EvalExpectedFindingSchema).safeParse(row.expectedOutput ?? []);
  return parsed.success ? parsed.data : [];
}

function toRunRecordDto(row: EvalRunRow, caseName: string | null): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: caseName,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput ?? [],
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
  };
}

function toPerCaseScore(row: EvalRunRow): PerCaseScore {
  return {
    recall: row.recall ?? 0,
    precision: row.precision ?? 0,
    citation_accuracy: row.citationAccuracy ?? 0,
    pass: row.pass ?? false,
  };
}

function sumCost(rows: { costUsd: number | null }[]): number | null {
  const costs = rows.map((r) => r.costUsd).filter((c): c is number => c != null);
  return costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null;
}

function toRunGroupDto(agentId: string, group: RunGroupRows): EvalRunGroup {
  const agg: AggregateResult = aggregate(group.rows.map(toPerCaseScore));
  return {
    id: group.runGroupId,
    run_group_id: group.runGroupId,
    agent_id: agentId,
    agent_version: group.agentVersion,
    ran_at: group.ranAt.toISOString(),
    recall: agg.recall,
    precision: agg.precision,
    citation_accuracy: agg.citation_accuracy,
    traces_passed: agg.traces_passed,
    traces_total: agg.traces_total,
    cost_usd: sumCost(group.rows),
  };
}

/** Legible "which metric moved and by how much" alert (AC-14). `null` when
 *  there is no previous run to compare against, or every delta is negligible. */
function buildAlert(
  delta: { recall: number; precision: number; citation_accuracy: number },
  hasPrevious: boolean,
): string | null {
  if (!hasPrevious) return null;
  const entries: [string, number][] = [
    ['Recall', delta.recall],
    ['Precision', delta.precision],
    ['Citation accuracy', delta.citation_accuracy],
  ];
  const [label, value] = entries.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
  const pts = Math.round(Math.abs(value) * 100);
  if (pts === 0) return null;
  const dir = value >= 0 ? 'rose' : 'dipped';
  return `${label} ${dir} ${pts}pt${pts === 1 ? '' : 's'}`;
}

/**
 * Minimal LCS-based unified-style line diff (no external `diff` dependency —
 * none is installed). Identical inputs → `''` (same-version compare stays
 * empty, per the spec edge case). Good enough for system-prompt-sized text;
 * not intended for huge files.
 */
export function diffLines(oldText: string, newText: string): string {
  if (oldText === newText) return '';
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push(`- ${a[i]}`);
      i++;
    } else {
      out.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < n) {
    out.push(`- ${a[i]}`);
    i++;
  }
  while (j < m) {
    out.push(`+ ${b[j]}`);
    j++;
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** T5 — inject the deterministic mock reviewer LLM instead of resolving the
   *  real provider via `container.llm(...)`. Used only by tests/`verify:l06`. */
  llmOverride?: LLMProvider;
}

export type CreateFromFindingResult =
  | { status: 'created'; case: EvalCase }
  | { status: 'already_exists'; case: EvalCase }
  | { status: 'no_decision' }
  | { status: 'not_found' };

export interface AuthorCaseInput {
  name: string;
  input_diff?: string;
  input_files?: unknown;
  input_meta?: unknown;
  expected_output?: unknown;
  notes?: string | null;
}

export interface UpdateCaseInput {
  name?: string;
  expected_output?: unknown;
  notes?: string | null;
}

export interface RunAllAgentsResult {
  agent_id: string;
  agent_name: string;
  ok: boolean;
  run?: EvalRunGroup;
  error?: string;
}

/** Ad-hoc cross-agent dashboard shape (no dedicated T1 contract — `EvalDashboard`
 *  is scoped to one owner). Documented for the client hooks to conform to. */
export interface CrossAgentDashboard {
  agents: (EvalRunGroup & { agent_name: string; cases_total: number })[];
  recent_runs: (EvalRunGroup & { agent_name: string })[];
}

export class EvalService {
  private repo: EvalRepository;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
  }

  private get agentsRepo() {
    return this.container.agentsRepo;
  }

  private get reviewRepo() {
    return this.container.reviewRepo;
  }

  // ---- create-from-finding (AC-1..AC-5) ------------------------------------

  async createCaseFromFinding(workspaceId: string, findingId: string): Promise<CreateFromFindingResult> {
    const ctx = await this.reviewRepo.findingContext(findingId);
    if (!ctx) return { status: 'not_found' };
    const { finding, review, pull } = ctx;
    if (pull.workspaceId !== workspaceId) return { status: 'not_found' };
    if (!review.agentId) return { status: 'not_found' };

    if (finding.acceptedAt == null && finding.dismissedAt == null) {
      return { status: 'no_decision' };
    }

    // Idempotent per finding (AC-5) — including a previously soft-deleted case,
    // so re-clicking after a delete surfaces "already added" rather than
    // silently minting a duplicate.
    const existing = await this.repo.findByFindingId(workspaceId, review.agentId, findingId);
    if (existing) return { status: 'already_exists', case: toEvalCaseDto(existing) };

    const repoRow = await this.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) return { status: 'not_found' };

    // Freeze the input: the diff fragment the finding was reviewed against.
    // `loadDiff` prefers real `git diff`, falls back to pr_files reconstruction
    // — we freeze the RESOLVED raw text so replays are stable regardless of
    // which path produced it (server/CLAUDE.md `loadDiff` gotcha).
    const diff = await loadDiff(this.container, this.reviewRepo, workspaceId, pull, repoRow);

    const expectedOutput: EvalExpectedFinding[] =
      finding.acceptedAt != null
        ? [
            {
              file: finding.file,
              start_line: finding.startLine,
              end_line: finding.endLine,
              severity: finding.severity as EvalExpectedFinding['severity'],
              category: finding.category as EvalExpectedFinding['category'],
              title: finding.title,
            },
          ]
        : [];

    const name = finding.title ? `From finding: ${finding.title}` : `From finding ${finding.id}`;

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: review.agentId,
      name,
      // Frozen input is DATA, never instructions (spec §Untrusted inputs) —
      // stored verbatim and only ever re-parsed (`parseUnifiedDiff`) or
      // scanned for citation lines, never interpolated into a prompt as
      // trusted text.
      inputDiff: diff.raw,
      inputMeta: {
        source_finding_id: findingId,
        pr_title: pull.title,
        pr_number: pull.number,
        pr_body: pull.body ?? null,
      },
      expectedOutput,
      notes: null,
    });
    return { status: 'created', case: toEvalCaseDto(row) };
  }

  // ---- case management (AC-6, AC-22, AC-23, AC-24) -------------------------

  async listCases(workspaceId: string, agentId: string): Promise<EvalCase[] | undefined> {
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listCasesForOwner(workspaceId, 'agent', agentId);
    return rows.map(toEvalCaseDto);
  }

  async authorCase(
    workspaceId: string,
    agentId: string,
    input: AuthorCaseInput,
  ): Promise<EvalCase | undefined> {
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: input.name,
      inputDiff: input.input_diff ?? '',
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output ?? [],
      notes: input.notes ?? null,
    });
    return toEvalCaseDto(row);
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: UpdateCaseInput,
  ): Promise<EvalCase | undefined> {
    const row = await this.repo.updateCase(workspaceId, caseId, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.expected_output !== undefined ? { expectedOutput: patch.expected_output } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    return row ? toEvalCaseDto(row) : undefined;
  }

  /** Soft-delete — see `EvalRepository` class doc for why (AC-24). */
  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, caseId);
  }

  // ---- run orchestration (AC-9, AC-10, AC-25, AC-26) -----------------------

  /**
   * Run one case: rebuild the `UnifiedDiff` from the frozen `input_diff`,
   * execute the agent's CURRENT config through the real `reviewPullRequest`
   * (or the injected `llmOverride` — T5), score via the pure scorer (T3), and
   * persist ONE per-case row tagged with `runGroupId` + `agentVersion`.
   */
  private async runCase(
    agent: AgentRow,
    caseRow: EvalCaseRow,
    runGroupId: string,
    opts: RunOptions,
    workspaceId: string,
  ): Promise<EvalRunRow> {
    const start = Date.now();
    const diff = parseUnifiedDiff(caseRow.inputDiff ?? '');

    // Resolve the 'eval_runner' feature-model slot via three-tier policy:
    // workspace override → the agent's own {provider, model} as the caller-
    // supplied reachable model → registry default. With no override this is
    // byte-identical to running the agent's own configured model (R1a).
    const resolved = await resolveFeatureModelWithFallback(
      this.container,
      workspaceId,
      'eval_runner',
      { provider: agent.provider as Provider, model: agent.model },
    );
    const llm = opts.llmOverride ?? (await this.container.llm(resolved.provider));

    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: resolved.model,
      diff,
      llm,
      strategy: (agent.strategy as ReviewStrategy) ?? undefined,
      task: `Eval case: ${caseRow.name}`,
      sessionId: `eval:${agent.id}:${caseRow.id}`,
    });

    const expected = parseExpected(caseRow);
    const actual: ScorableFinding[] = outcome.review.findings.map((f) => ({
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
    }));
    const recall = computeRecall(expected, actual);
    const precision = computePrecision(expected, actual);
    const citationAccuracy = computeCitationAccuracy(actual, caseRow.inputDiff ?? '');
    const pass = recall === 1 && precision === 1;

    return this.repo.insertRun({
      caseId: caseRow.id,
      actualOutput: outcome.review.findings,
      pass,
      recall,
      precision,
      citationAccuracy,
      durationMs: Date.now() - start,
      costUsd: outcome.costUsd,
      runGroupId,
      agentVersion: agent.version,
    });
  }

  /** "Run all evals" for an agent (AC-9): every LIVE case, one shared
   *  run_group_id, attributed to the agent's CURRENT version (AC-10: identical
   *  case inputs are used regardless of which version runs — only the config
   *  varies). Empty set → defined aggregate, never throws (AC-20). */
  async runAllForAgent(
    workspaceId: string,
    agentId: string,
    opts: RunOptions = {},
  ): Promise<EvalRunGroup> {
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agentId);
    const runGroupId = randomUUID();
    const rows: EvalRunRow[] = [];
    for (const c of cases) {
      rows.push(await this.runCase(agent, c, runGroupId, opts, workspaceId));
    }
    const ranAt = rows.reduce((max, r) => (r.ranAt > max ? r.ranAt : max), new Date());
    return toRunGroupDto(agentId, { runGroupId, agentVersion: agent.version, ranAt, rows });
  }

  /** Run a single case (AC-25) — persists exactly one per-case row like a full
   *  run; the agent's derived aggregate re-reads the LATEST row per case, so
   *  this single run immediately updates it. */
  async runSingleCase(
    workspaceId: string,
    caseId: string,
    opts: RunOptions = {},
  ): Promise<{ run: EvalRunRecord; case: EvalCase } | undefined> {
    const caseRow = await this.repo.getCase(workspaceId, caseId);
    if (!caseRow) return undefined;
    if (caseRow.ownerKind !== 'agent') {
      throw new ValidationError('Only agent-owned eval cases can be run (skill eval cases are out of scope)');
    }
    const agent = await this.agentsRepo.getById(workspaceId, caseRow.ownerId);
    if (!agent) throw new NotFoundError('Owning agent not found');
    const runGroupId = randomUUID();
    const run = await this.runCase(agent, caseRow, runGroupId, opts, workspaceId);
    return { run: toRunRecordDto(run, caseRow.name), case: toEvalCaseDto(caseRow) };
  }

  /** "Run all agents" (AC-26) — each agent's set runs independently; one
   *  agent's failure is isolated and the rest still complete. */
  async runAllAgents(workspaceId: string, opts: RunOptions = {}): Promise<RunAllAgentsResult[]> {
    const agents = await this.agentsRepo.list(workspaceId);
    const results: RunAllAgentsResult[] = [];
    for (const agent of agents) {
      try {
        const run = await this.runAllForAgent(workspaceId, agent.id, opts);
        results.push({ agent_id: agent.id, agent_name: agent.name, ok: true, run });
      } catch (err) {
        results.push({
          agent_id: agent.id,
          agent_name: agent.name,
          ok: false,
          error: (err as Error).message,
        });
      }
    }
    return results;
  }

  // ---- history + dashboard (AC-8, AC-14, AC-15, AC-17, AC-28) --------------

  async runHistory(workspaceId: string, agentId: string): Promise<EvalRunGroup[] | undefined> {
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const groups = await this.repo.listRunGroups(workspaceId, 'agent', agentId);
    return groups.map((g) => toRunGroupDto(agentId, g));
  }

  async agentDashboard(workspaceId: string, agentId: string): Promise<EvalDashboard | undefined> {
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agentId);
    const latest = await this.repo.latestRunsForOwner(workspaceId, 'agent', agentId);
    const current = aggregate(latest.map(toPerCaseScore));

    const groups = await this.repo.listRunGroups(workspaceId, 'agent', agentId); // newest-first
    const trend: EvalTrendPoint[] = [...groups].reverse().map((g) => {
      const agg = aggregate(g.rows.map(toPerCaseScore));
      return {
        ran_at: g.ranAt.toISOString(),
        recall: agg.recall,
        precision: agg.precision,
        citation_accuracy: agg.citation_accuracy,
        pass_rate: agg.traces_total > 0 ? agg.traces_passed / agg.traces_total : 1,
        cost_usd: sumCost(g.rows),
      };
    });

    // Delta vs the run BEFORE the most recent run_group (AC-14: "between the
    // two most recent runs"). `current` (derived from each case's LATEST row)
    // and `groups[0]` coincide right after a full run-all; a single-case
    // re-run since then still reads as "current" per AC-25.
    const previous = groups[1];
    const previousAgg = previous ? aggregate(previous.rows.map(toPerCaseScore)) : undefined;
    const delta = {
      recall: current.recall - (previousAgg?.recall ?? current.recall),
      precision: current.precision - (previousAgg?.precision ?? current.precision),
      citation_accuracy: current.citation_accuracy - (previousAgg?.citation_accuracy ?? current.citation_accuracy),
    };

    const recentRuns = [...latest]
      .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
      .slice(0, 20)
      .map((r) => toRunRecordDto(r, r.caseName));

    return {
      owner_kind: 'agent',
      owner_id: agentId,
      cases_total: cases.length,
      current: {
        recall: current.recall,
        precision: current.precision,
        citation_accuracy: current.citation_accuracy,
        traces_passed: current.traces_passed,
        traces_total: current.traces_total,
        cost_usd: sumCost(latest),
      },
      delta,
      trend,
      recent_runs: recentRuns,
      alert: buildAlert(delta, previous !== undefined),
    };
  }

  /** Cross-agent dashboard (AC-17): each agent's latest metrics + a recent
   *  cross-agent runs list, newest-first. */
  async dashboard(workspaceId: string): Promise<CrossAgentDashboard> {
    const agents = await this.agentsRepo.list(workspaceId);
    const perAgent: CrossAgentDashboard['agents'] = [];
    const allGroups: CrossAgentDashboard['recent_runs'] = [];

    for (const agent of agents) {
      const cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agent.id);
      const latest = await this.repo.latestRunsForOwner(workspaceId, 'agent', agent.id);
      const agg = aggregate(latest.map(toPerCaseScore));
      const latestRanAt = latest.reduce((max, r) => (r.ranAt > max ? r.ranAt : max), new Date(0));
      perAgent.push({
        id: agent.id,
        run_group_id: '',
        agent_id: agent.id,
        agent_version: agent.version,
        ran_at: (latest.length > 0 ? latestRanAt : new Date()).toISOString(),
        recall: agg.recall,
        precision: agg.precision,
        citation_accuracy: agg.citation_accuracy,
        traces_passed: agg.traces_passed,
        traces_total: agg.traces_total,
        cost_usd: sumCost(latest),
        agent_name: agent.name,
        cases_total: cases.length,
      });

      const groups = await this.repo.listRunGroups(workspaceId, 'agent', agent.id);
      for (const g of groups.slice(0, 5)) {
        allGroups.push({ ...toRunGroupDto(agent.id, g), agent_name: agent.name });
      }
    }

    allGroups.sort((a, b) => new Date(b.ran_at).getTime() - new Date(a.ran_at).getTime());
    return { agents: perAgent, recent_runs: allGroups.slice(0, 20) };
  }

  // ---- comparison + promote (AC-16, AC-27) ---------------------------------

  async compare(workspaceId: string, oldRunGroupId: string, newRunGroupId: string): Promise<EvalComparison> {
    const [oldRows, newRows] = await Promise.all([
      this.repo.getRunGroupRows(oldRunGroupId),
      this.repo.getRunGroupRows(newRunGroupId),
    ]);
    if (oldRows.length === 0 || newRows.length === 0) {
      throw new NotFoundError('Run group not found');
    }
    const oldCase = await this.repo.getCaseIncludingDeleted(workspaceId, oldRows[0]!.caseId);
    const newCase = await this.repo.getCaseIncludingDeleted(workspaceId, newRows[0]!.caseId);
    if (!oldCase || !newCase) throw new NotFoundError('Eval case not found for run group');
    const agentId = oldCase.ownerId;

    const oldRanAt = oldRows.reduce((max, r) => (r.ranAt > max ? r.ranAt : max), oldRows[0]!.ranAt);
    const newRanAt = newRows.reduce((max, r) => (r.ranAt > max ? r.ranAt : max), newRows[0]!.ranAt);
    const oldGroup = toRunGroupDto(agentId, {
      runGroupId: oldRunGroupId,
      agentVersion: oldRows[0]!.agentVersion,
      ranAt: oldRanAt,
      rows: oldRows,
    });
    const newGroup = toRunGroupDto(agentId, {
      runGroupId: newRunGroupId,
      agentVersion: newRows[0]!.agentVersion,
      ranAt: newRanAt,
      rows: newRows,
    });

    const metricDelta = (o: number, n: number): EvalMetricDelta => ({ old: o, new: n, delta: n - o });

    // Same-version compare → empty prompt diff (edge case). Different versions
    // → diff the two `agent_versions` snapshots' system prompts.
    let systemPromptDiff = '';
    if (
      oldGroup.agent_version != null &&
      newGroup.agent_version != null &&
      oldGroup.agent_version !== newGroup.agent_version
    ) {
      const [oldVersion, newVersion] = await Promise.all([
        this.agentsRepo.getVersion(agentId, oldGroup.agent_version),
        this.agentsRepo.getVersion(agentId, newGroup.agent_version),
      ]);
      const oldCfg = oldVersion ? AgentVersionConfig.safeParse(oldVersion.configJson) : undefined;
      const newCfg = newVersion ? AgentVersionConfig.safeParse(newVersion.configJson) : undefined;
      systemPromptDiff = diffLines(
        oldCfg?.success ? oldCfg.data.system_prompt : '',
        newCfg?.success ? newCfg.data.system_prompt : '',
      );
    }

    const versions = [oldGroup.agent_version, newGroup.agent_version].filter(
      (v): v is number => v != null,
    );
    const newerVersion = versions.length > 0 ? Math.max(...versions) : null;

    return {
      old_run: oldGroup,
      new_run: newGroup,
      recall: metricDelta(oldGroup.recall, newGroup.recall),
      precision: metricDelta(oldGroup.precision, newGroup.precision),
      citation_accuracy: metricDelta(oldGroup.citation_accuracy, newGroup.citation_accuracy),
      cost_usd: metricDelta(oldGroup.cost_usd ?? 0, newGroup.cost_usd ?? 0),
      system_prompt_diff: systemPromptDiff,
      newer_version: newerVersion,
    };
  }

  /**
   * Promote (AC-27) — the ONLY write the comparison view exposes: set the
   * agent's active config to the target version's immutable snapshot.
   * Applied via the existing agents-module update path (bumps to a NEW
   * version + snapshots it — `agent_versions` rows are never mutated in
   * place, matching the append-only convention the rest of the codebase
   * relies on); same-version target → no-op (already active).
   */
  async promote(workspaceId: string, agentId: string, version: number): Promise<Agent | undefined> {
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    if (agent.version === version) return toAgentDto(agent); // already active — no-op

    const target = await this.agentsRepo.getVersion(agentId, version);
    if (!target) throw new NotFoundError('Agent version not found');
    const cfg = AgentVersionConfig.parse(target.configJson);

    const updated = await this.agentsRepo.update(workspaceId, agentId, {
      provider: cfg.provider,
      model: cfg.model,
      systemPrompt: cfg.system_prompt,
      outputSchema: cfg.output_schema,
      strategy: cfg.strategy,
      ciFailOn: cfg.ci_fail_on,
      repoIntel: cfg.repo_intel,
    });
    if (!updated) return undefined;
    await this.agentsRepo.setSkills(agentId, cfg.skills);
    const finalRow = await this.agentsRepo.getById(workspaceId, agentId);
    return finalRow ? toAgentDto(finalRow) : undefined;
  }
}

// Exported for the run-path test / verify:l06 (AC-13 proof needs to inspect
// the pure matcher directly alongside the run service).
export { matchFinding };
