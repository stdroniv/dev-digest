import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
// Value import (not `import type`) — `.safeParse` is a runtime call, and a
// type-only import silently strips it to zero bytes at compile time (server
// INSIGHTS.md:99).
import { AgentManifest } from '@devdigest/shared';
import type { AgentManifest as AgentManifestType } from '@devdigest/shared';

/** Thrown on a missing/unreadable manifest file OR a schema-invalid manifest (AC-13/14). */
export class ManifestError extends Error {}

/**
 * Load `.devdigest/agents/<slug>.yaml` and validate it against the SAME
 * `AgentManifest` Zod schema the studio writes it with (AC-13) — one
 * contract, two consumers. Refuses (throws) on invalid YAML or a
 * schema-invalid manifest rather than guessing at a partial config.
 */
export function loadManifest(path: string): AgentManifestType {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ManifestError(
      `Agent manifest not found at "${path}": ${(err as Error).message}`,
    );
  }

  let obj: unknown;
  try {
    obj = parseYaml(raw);
  } catch (err) {
    throw new ManifestError(`Agent manifest at "${path}" is not valid YAML: ${(err as Error).message}`);
  }

  const result = AgentManifest.safeParse(obj);
  if (!result.success) {
    throw new ManifestError(
      `Agent manifest at "${path}" failed validation: ${result.error.message}`,
    );
  }
  return result.data;
}
