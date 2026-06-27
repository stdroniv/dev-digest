import type { RunBus } from '@devdigest/api/platform/sse.js';
import type { AgentRow } from '@devdigest/api/db/rows.js';
import { McpToolError, okResult, runTool } from '../errors.js';
import { getWorkspaceId } from '../context.js';
import { parsePrRef, resolvePull, resolveAgentByName } from '../resolvers.js';
import {
  projectFinding,
  sortFindings,
  summarize,
  REVIEW_PR_FINDINGS_CAP,
} from '../format.js';
import {
  ReviewPrInput,
  reviewPrInput,
  reviewPrOutput,
  type RunStatus,
} from '../schemas.js';
import type { ToolDeps } from '../deps.js';
import type { ToolDefinition } from './types.js';

const DESCRIPTION =
  'Run one named review agent — or every enabled agent — against an already-imported ' +
  'pull request and BLOCK until the review finishes, returning a findings summary. ' +
  '`pr` is `owner/repo#number` (e.g. acme/payments-api#482). Provide either `agent` ' +
  '(a name from devdigest_list_agents) or `all:true`. If the review exceeds ' +
  '`timeout_seconds` the tool returns the run ids with a still-running status instead ' +
  'of hanging — call devdigest_get_findings later to collect results. This performs ' +
  'work (LLM + git/GitHub calls) and is not idempotent.';

const TERMINAL: ReadonlySet<string> = new Set(['done', 'failed', 'cancelled']);

function mapStatus(status: string | null | undefined): RunStatus {
  return status && TERMINAL.has(status) ? (status as RunStatus) : 'running';
}

/**
 * Block until every run signals done on the in-process bus, racing a timeout.
 *
 * `runBus.onDone` fires immediately (via queueMicrotask) for an already-completed
 * run, so there is no subscribe-after-complete race. On timeout we DETACH the
 * listeners (their unsubscribe fns) and return false — the runs keep running
 * in-process; we never cancel them.
 */
function waitForRuns(runBus: RunBus, runIds: string[], timeoutSeconds: number): Promise<boolean> {
  const unsubs: Array<() => void> = [];
  const allDone = Promise.all(
    runIds.map(
      (id) =>
        new Promise<void>((resolve) => {
          unsubs.push(runBus.onDone(id, () => resolve()));
        }),
    ),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutSeconds * 1000);
  });

  return Promise.race([allDone.then(() => 'done' as const), timeout]).then((result) => {
    if (timer) clearTimeout(timer);
    if (result === 'timeout') {
      for (const unsub of unsubs) unsub();
      return false;
    }
    return true;
  });
}

export function makeReviewPrTool(deps: ToolDeps): ToolDefinition {
  return {
    name: 'devdigest_review_pr',
    config: {
      title: 'Run a review agent on a pull request',
      description: DESCRIPTION,
      inputSchema: reviewPrInput,
      outputSchema: reviewPrOutput,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        // LLM + GitHub are external, open-world.
        openWorldHint: true,
      },
    },
    handler: (rawArgs) =>
      runTool(async () => {
        const input = ReviewPrInput.parse(rawArgs);

        // Cross-field rule: exactly one of `agent` / `all:true`.
        const hasAgent = typeof input.agent === 'string' && input.agent.trim() !== '';
        if (hasAgent === input.all) {
          throw new McpToolError(
            'Provide exactly one of `agent` (an agent name) or `all:true` — not both, not neither.',
          );
        }

        const workspaceId = await getWorkspaceId(deps.container);
        const ref = parsePrRef(input.pr);
        const prRef = `${ref.fullName}#${ref.number}`;
        const { pull } = await resolvePull(deps, workspaceId, ref);

        // Resolve which agents to run (reuse the service's business logic).
        let targets: AgentRow[];
        if (input.all) {
          targets = await deps.services.reviews.resolveTargets(workspaceId, { all: true });
        } else {
          const agent = await resolveAgentByName(deps, workspaceId, input.agent!);
          targets = await deps.services.reviews.resolveTargets(workspaceId, { agentId: agent.id });
        }
        if (targets.length === 0) {
          throw new McpToolError(
            'No enabled agents to run. Enable an agent in the web UI or pass a specific `agent` name.',
          );
        }

        // Kick off the (fire-and-forget) review; block on the run bus.
        const { runs } = await deps.services.reviews.runReview(
          workspaceId,
          pull.id,
          targets,
          deps.logger,
        );
        const runIds = runs.map((r) => r.run_id);
        const completed = await waitForRuns(deps.container.runBus, runIds, input.timeout_seconds);

        if (!completed) {
          return okResult({
            pr: prRef,
            completed: false,
            runs: runs.map((r) => ({
              run_id: r.run_id,
              agent_name: r.agent_name,
              status: 'running' as RunStatus,
              error: null,
            })),
            summary: { critical: 0, warning: 0, suggestion: 0, total: 0, blockers: 0 },
            findings: [],
            message:
              `Review still running after ${input.timeout_seconds}s. Call ` +
              `devdigest_get_findings { pr: "${prRef}" } later to collect results.`,
          });
        }

        // Completed: collect findings from THIS request's runs only.
        const reviews = await deps.services.reviews.reviewsForPull(workspaceId, pull.id);
        const runIdSet = new Set(runIds);
        const matched = [];
        for (const review of reviews) {
          if (review.kind !== 'review') continue;
          if (!review.run_id || !runIdSet.has(review.run_id)) continue;
          for (const f of review.findings) {
            if (f.dismissed_at != null) continue; // reviewsForPull includes dismissed
            matched.push(f);
          }
        }
        const sorted = sortFindings(matched);
        const summary = summarize(sorted);
        const detailed = input.response_format === 'detailed';
        const projected = sorted.slice(0, REVIEW_PR_FINDINGS_CAP).map((f) => projectFinding(f, detailed));

        // Final per-run status (done/failed/cancelled) from the run history.
        const runSummaries = await deps.services.reviews.listRuns(workspaceId, pull.id);
        const byRun = new Map(runSummaries.map((r) => [r.run_id, r]));
        const runsOut = runs.map((r) => {
          const s = byRun.get(r.run_id);
          return {
            run_id: r.run_id,
            agent_name: r.agent_name,
            status: mapStatus(s?.status),
            error: s?.error ?? null,
          };
        });

        const truncated = sorted.length > REVIEW_PR_FINDINGS_CAP;
        const message = truncated
          ? `Showing ${REVIEW_PR_FINDINGS_CAP} of ${sorted.length} findings; call ` +
            `devdigest_get_findings { pr: "${prRef}", severity: "CRITICAL" } to narrow.`
          : null;

        return okResult({
          pr: prRef,
          completed: true,
          runs: runsOut,
          summary,
          findings: projected,
          message,
        });
      }, deps.logger),
  };
}
