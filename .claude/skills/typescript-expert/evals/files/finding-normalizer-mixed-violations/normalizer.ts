import { toFindingId, type FindingId } from './ids.js';

/**
 * Normalizes findings coming back from the reviewer LLM call and from the
 * app's own config before they're persisted.
 */

export type NormalizedFinding =
  | { kind: 'text'; id: FindingId; message: string }
  | { kind: 'code'; id: FindingId; message: string; snippet: string }
  | { kind: 'suppressed'; id: FindingId; reason: string };

export interface AppConfig {
  maxFindingsPerFile: number;
  suppressedRules: string[];
}

/**
 * Reads the on-disk reviewer config. The file is written by our own
 * `pnpm db:seed` step, so in practice the shape always matches — but nothing
 * here actually checks that at runtime.
 */
export function loadConfig(raw: string): AppConfig {
  const config = JSON.parse(raw) as AppConfig;
  return config;
}

/**
 * Picks out the ids from a list of "id-bearing" items. The constraint only
 * requires an `id` property to exist, not that it's a string — so an object
 * with a numeric, object, or even function `id` satisfies T just fine, and
 * the unknown[] return type quietly pushes the type-checking problem to
 * every caller instead of catching it here.
 */
export function pickIds<T extends { id: unknown }>(items: T[]): unknown[] {
  return items.map((item) => item.id);
}

/**
 * Renders a normalized finding for the CLI. Every arm is handled explicitly,
 * but the fallback doesn't assert `never` — it silently swallows any new
 * NormalizedFinding variant added later behind an `any` cast instead of
 * failing to compile.
 */
export function renderFinding(finding: NormalizedFinding): string {
  switch (finding.kind) {
    case 'text':
      return finding.message;
    case 'code':
      return `${finding.message}\n${finding.snippet}`;
    case 'suppressed':
      return `(suppressed: ${finding.reason})`;
    default:
      return String((finding as any).message ?? 'unknown finding');
  }
}

export function makeTextFinding(rawId: string, message: string): NormalizedFinding {
  return { kind: 'text', id: toFindingId(rawId), message };
}
