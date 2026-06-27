import { okResult, runTool } from '../errors.js';
import { getWorkspaceId } from '../context.js';
import { parsePrRef, resolvePull } from '../resolvers.js';
import {
  GetBlastRadiusInput,
  getBlastRadiusInput,
  getBlastRadiusOutput,
} from '../schemas.js';
import type { ToolDeps } from '../deps.js';
import type { ToolDefinition } from './types.js';

const DESCRIPTION =
  'Return the impact/blast radius (callers and callees affected) of the symbols changed ' +
  'in a pull request. NOTE: not yet implemented in this build — the tool returns a ' +
  'structured `not_implemented` status so clients can integrate against the final ' +
  'contract now.';

const NOT_IMPLEMENTED_MESSAGE =
  'Blast-radius analysis is not yet available in this DevDigest build. The contract is ' +
  'final; use devdigest_get_findings or devdigest_review_pr meanwhile.';

export function makeGetBlastRadiusTool(deps: ToolDeps): ToolDefinition {
  return {
    name: 'devdigest_get_blast_radius',
    config: {
      title: 'Get the blast radius of changed symbols (not yet implemented)',
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
        // Validate `pr` resolves (early, actionable error) even though the
        // analysis itself is a stub.
        const ref = parsePrRef(input.pr);
        const prRef = `${ref.fullName}#${ref.number}`;
        await resolvePull(deps, workspaceId, ref);

        return okResult({
          status: 'not_implemented',
          message: NOT_IMPLEMENTED_MESSAGE,
          pr: prRef,
          symbol: input.symbol ?? null,
          impacted: [],
        });
      }, deps.logger),
  };
}
