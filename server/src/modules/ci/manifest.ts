import { stringify } from 'yaml';
// Value import — `.safeParse` is a runtime call; a type-only import silently
// strips it to zero bytes at compile time (server INSIGHTS.md:99).
import { AgentManifest } from '@devdigest/shared';
import type { AgentManifest as AgentManifestType, AgentManifestInput, CiFile } from '@devdigest/shared';
import { manifestFilePath } from './constants.js';

/** Thrown when a built manifest object fails validation against the shared `AgentManifest` schema (AC-14) — refuse rather than commit an invalid manifest. */
export class InvalidManifestError extends Error {
  constructor(
    message: string,
    public readonly issues: string,
  ) {
    super(message);
    this.name = 'InvalidManifestError';
  }
}

/**
 * Validate `input` against the SAME `AgentManifest` Zod schema the CI runner
 * loads at review time (`runner/src/manifest.ts`) — one contract, two
 * consumers (AC-13). Refuses (throws `InvalidManifestError`) rather than
 * returning a best-effort/partial manifest (AC-14). The shape carries no
 * secret field, so a valid manifest can never embed a key (AC-26).
 */
export function buildAgentManifest(input: AgentManifestInput): AgentManifestType {
  const result = AgentManifest.safeParse(input);
  if (!result.success) {
    const name = typeof (input as { name?: unknown }).name === 'string' ? (input as { name: string }).name : '(unnamed)';
    throw new InvalidManifestError(`Agent manifest for "${name}" failed validation against the shared schema`, result.error.message);
  }
  return result.data;
}

/** Serialize a validated manifest to human-readable, editable YAML (AC-3). */
export function serializeAgentManifest(manifest: AgentManifestType): string {
  return stringify(manifest, { lineWidth: 0 });
}

/** The manifest as a committed `CiFile` at `.devdigest/agents/<slug>.yaml` (AC-2). */
export function agentManifestFile(manifest: AgentManifestType): CiFile {
  return {
    path: manifestFilePath(manifest.slug),
    contents: serializeAgentManifest(manifest),
    editable: true,
  };
}
