import { okResult, runTool } from '../errors.js';
import { getWorkspaceId } from '../context.js';
import { parseRepoRef, resolveRepo } from '../resolvers.js';
import { paginate } from '../format.js';
import {
  GetConventionsInput,
  getConventionsInput,
  getConventionsOutput,
  type ConventionOut,
} from '../schemas.js';
import type { ToolDeps } from '../deps.js';
import type { ToolDefinition } from './types.js';

const DESCRIPTION =
  "Return the coding conventions the user has ACCEPTED for a repo (status='accepted'). " +
  'A *convention* is a house rule (e.g. error handling, naming) the Conventions ' +
  'Extractor proposed and the user approved. `repo` is `owner/repo`. Pending/rejected ' +
  'candidates are never returned. Read-only.';

export function makeGetConventionsTool(deps: ToolDeps): ToolDefinition {
  return {
    name: 'devdigest_get_conventions',
    config: {
      title: "Get a repo's accepted conventions",
      description: DESCRIPTION,
      inputSchema: getConventionsInput,
      outputSchema: getConventionsOutput,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    handler: (rawArgs) =>
      runTool(async () => {
        const input = GetConventionsInput.parse(rawArgs);
        const workspaceId = await getWorkspaceId(deps.container);
        const ref = parseRepoRef(input.repo);
        const repo = await resolveRepo(deps, workspaceId, ref);

        // Accepted-only — never the pending/rejected set (decision #3).
        const accepted = await deps.services.conventions.listAccepted(workspaceId, repo.id);
        const filtered = input.category
          ? accepted.filter((c) => c.category === input.category)
          : accepted;

        const page = paginate(filtered, input.limit, input.cursor);
        const detailed = input.response_format === 'detailed';
        const conventions: ConventionOut[] = page.items.map((c) => {
          const base: ConventionOut = {
            rule: c.rule,
            category: c.category,
            evidence_path: c.evidence_path,
            evidence_start_line: c.evidence_start_line,
            evidence_end_line: c.evidence_end_line,
            confidence: c.confidence,
          };
          // `summary` omits the potentially-large snippet.
          return detailed ? { ...base, evidence_snippet: c.evidence_snippet ?? undefined } : base;
        });

        return okResult({
          repo: ref.fullName,
          conventions,
          total: page.total,
          returned: page.returned,
          has_more: page.hasMore,
          next_cursor: page.nextCursor,
        });
      }, deps.logger),
  };
}
