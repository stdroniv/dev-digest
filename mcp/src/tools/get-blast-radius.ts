import { okResult, runTool } from '../errors.js';
import { getWorkspaceId } from '../context.js';
import { parsePrRef, resolvePull } from '../resolvers.js';
import { projectBlast } from '../format.js';
import {
  GetBlastRadiusInput,
  getBlastRadiusInput,
  getBlastRadiusOutput,
} from '../schemas.js';
import type { ToolDeps } from '../deps.js';
import type { ToolDefinition } from './types.js';

const DESCRIPTION =
  'Return the blast radius of the symbols changed in a pull request: each changed symbol ' +
  'grouped with its cross-file CALLERS (rank-desc, capped at 20) and the HTTP endpoints / ' +
  'cron jobs reachable from those caller files. `pr` is `owner/repo#number`; pass `symbol` ' +
  'to restrict to one changed symbol by exact name. Analysis is callers-only and single-hop ' +
  '(no callee or multi-depth traversal) and reads only the repo-intel index — zero AI calls. ' +
  'The `index`, `degraded`, and `resolution` fields honestly report when the index is partial ' +
  'or references stayed unresolved (some callers may be missing). Read-only.';

export function makeGetBlastRadiusTool(deps: ToolDeps): ToolDefinition {
  return {
    name: 'devdigest_get_blast_radius',
    config: {
      title: 'Get the blast radius of changed symbols',
      description: DESCRIPTION,
      inputSchema: getBlastRadiusInput,
      outputSchema: getBlastRadiusOutput,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    handler: (rawArgs) =>
      runTool(async () => {
        const input = GetBlastRadiusInput.parse(rawArgs);
        const workspaceId = await getWorkspaceId(deps.container);
        const ref = parsePrRef(input.pr);
        const prRef = `${ref.fullName}#${ref.number}`;
        // Resolve the PR first for an actionable not-found error (this also means
        // BlastService's own NotFoundError path is never reached).
        const { pull } = await resolvePull(deps, workspaceId, ref);

        const response = await deps.services.blast.getBlast(workspaceId, pull.id);
        return okResult(projectBlast(prRef, response, input.symbol));
      }, deps.logger),
  };
}
