import { okResult, runTool } from '../errors.js';
import { getWorkspaceId } from '../context.js';
import { parsePrRef, resolvePull, resolveAgentByName } from '../resolvers.js';
import { projectFinding, selectFindings, paginate } from '../format.js';
import { GetFindingsInput, getFindingsInput, getFindingsOutput } from '../schemas.js';
import type { ToolDeps } from '../deps.js';
import type { ToolDefinition } from './types.js';

const DESCRIPTION =
  'Fetch grounded review findings for an already-reviewed pull request, newest review ' +
  'per agent by default. `pr` is `owner/repo#number`. Filter server-side by `agent` ' +
  'name, `severity`, `category`, or `file`; results are paginated. Use ' +
  '`response_format:detailed` only when you need the rationale and suggested fix. ' +
  'Read-only.';

export function makeGetFindingsTool(deps: ToolDeps): ToolDefinition {
  return {
    name: 'devdigest_get_findings',
    config: {
      title: 'Get findings for a pull request',
      description: DESCRIPTION,
      inputSchema: getFindingsInput,
      outputSchema: getFindingsOutput,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    handler: (rawArgs) =>
      runTool(async () => {
        const input = GetFindingsInput.parse(rawArgs);
        const workspaceId = await getWorkspaceId(deps.container);
        const ref = parsePrRef(input.pr);
        const prRef = `${ref.fullName}#${ref.number}`;
        const { pull } = await resolvePull(deps, workspaceId, ref);

        let agentId: string | undefined;
        if (input.agent) {
          const agent = await resolveAgentByName(deps, workspaceId, input.agent);
          agentId = agent.id;
        }

        const reviews = await deps.services.reviews.reviewsForPull(workspaceId, pull.id);
        const selected = selectFindings(reviews, {
          agentId,
          severity: input.severity,
          category: input.category,
          file: input.file,
          includeDismissed: input.include_dismissed,
          allRuns: input.all_runs,
        });

        const page = paginate(selected, input.limit, input.cursor);
        const detailed = input.response_format === 'detailed';
        const findings = page.items.map((f) => projectFinding(f, detailed));
        const truncatedNote = page.hasMore
          ? `Showing ${page.returned} of ${page.total} matching findings; pass next_cursor for the next page.`
          : null;

        return okResult({
          pr: prRef,
          findings,
          total_matched: page.total,
          returned: page.returned,
          has_more: page.hasMore,
          next_cursor: page.nextCursor,
          truncated_note: truncatedNote,
        });
      }, deps.logger),
  };
}
