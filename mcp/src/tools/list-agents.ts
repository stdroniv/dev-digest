import { okResult, runTool } from '../errors.js';
import { getWorkspaceId } from '../context.js';
import { ListAgentsInput, listAgentsInput, listAgentsOutput } from '../schemas.js';
import type { ToolDeps } from '../deps.js';
import type { ToolDefinition } from './types.js';

const DESCRIPTION =
  'List the AI code-review agents configured in this local DevDigest workspace. A ' +
  'DevDigest *agent* is a named reviewer = an LLM provider + model + system prompt + ' +
  'linked skills. Returns concise metadata so you can pass an agent\'s `name` to ' +
  'devdigest_review_pr or devdigest_get_findings. Read-only.';

export function makeListAgentsTool(deps: ToolDeps): ToolDefinition {
  return {
    name: 'devdigest_list_agents',
    config: {
      title: 'List PR review agents',
      description: DESCRIPTION,
      inputSchema: listAgentsInput,
      outputSchema: listAgentsOutput,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    handler: (rawArgs) =>
      runTool(async () => {
        const input = ListAgentsInput.parse(rawArgs);
        const workspaceId = await getWorkspaceId(deps.container);
        const agents = await deps.services.agents.list(workspaceId);
        const filtered = input.enabled_only ? agents.filter((a) => a.enabled) : agents;
        // OMIT system_prompt / output_schema / id / version (large/low-signal);
        // `name` is the stable human-readable handle for the other tools.
        const out = filtered.map((a) => ({
          name: a.name,
          description: a.description,
          enabled: a.enabled,
          strategy: a.strategy,
          provider: a.provider,
          model: a.model,
        }));
        return okResult({ agents: out, count: out.length });
      }, deps.logger),
  };
}
