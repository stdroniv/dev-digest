import type { FeatureModelChoice, SmartDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { routeModel } from '../../platform/model-router.js';
import type { BlastResponse } from '../blast/types.js';

/**
 * Pure input builders + best-effort model probing for the Why+Risk Brief
 * (SPEC-03 T7). These render already-computed server data (blast, smart diff)
 * into plain text blocks that name REAL file paths / endpoint strings — the
 * generator (reviewer-core) never sees raw diff/code, and its post-hoc
 * grounding oracle (`changedFiles`/`impactedEndpoints`) can only keep refs the
 * model actually had something concrete to cite.
 */

// ---- Blast-radius text block ------------------------------------------------

/**
 * Render a blast-radius response as plain-text: impacted endpoints/crons (real
 * strings, matching the `impactedEndpoints` oracle passed to the generator),
 * then each changed symbol with its file + caller count. Returns `null` when
 * there is genuinely nothing to say (no symbols, no endpoints, no crons) —
 * distinct from `blast === null` (blast unavailable), which the caller handles.
 */
export function buildBlastBlock(blast: BlastResponse): string | null {
  const lines: string[] = [];

  if (blast.impactedEndpoints.length > 0) {
    lines.push(`Impacted HTTP endpoints: ${blast.impactedEndpoints.join(', ')}`);
  }
  if (blast.impactedCrons.length > 0) {
    lines.push(`Impacted cron jobs: ${blast.impactedCrons.join(', ')}`);
  }
  if (blast.symbols.length > 0) {
    lines.push('Changed symbols:');
    for (const sym of blast.symbols) {
      lines.push(`- ${sym.name} (${sym.kind}) in ${sym.file}: ${sym.callers.length} cross-file caller(s)`);
    }
  }
  if (blast.degraded) {
    lines.push(
      `Note: blast-radius analysis is degraded${blast.reason ? ` (${blast.reason})` : ''} — results may be incomplete.`,
    );
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

// ---- Smart-diff (grouped diff stats) text block -----------------------------

/**
 * Render grouped diff statistics as plain text: one section per non-empty
 * role group (core/wiring/boilerplate), each file with its real path +
 * add/delete counts (real paths, matching the `changedFiles` oracle).
 */
export function buildSmartDiffBlock(smartDiff: SmartDiff): string | null {
  const lines: string[] = [];

  for (const group of smartDiff.groups) {
    if (group.files.length === 0) continue;
    lines.push(`${group.role} files:`);
    for (const file of group.files) {
      lines.push(`- ${file.path} (+${file.additions}/-${file.deletions})`);
    }
  }

  if (smartDiff.split_suggestion.too_big) {
    lines.push(
      `Note: this PR is large (${smartDiff.split_suggestion.total_lines} total changed lines) — consider splitting.`,
    );
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

// ---- Changed-file extractor --------------------------------------------------

/** Extract the flat list of changed-file paths from persisted `pr_files` rows. */
export function extractChangedFiles(files: { path: string }[]): string[] {
  return files.map((f) => f.path);
}

// ---- Reachable-model probe ---------------------------------------------------

/**
 * Probe configured providers directly (no reviewer-run to borrow a reachable
 * model from — this is a standalone POST), mirroring
 * `BlastSummaryService.resolveCheapLlm`: try each provider in order, return
 * the first one whose client can be constructed (a real key is configured /
 * injected), else `null` (never throws) when none is configured.
 */
export async function resolveReachableModel(container: Container): Promise<FeatureModelChoice | null> {
  const candidates: FeatureModelChoice[] = [
    { provider: 'openai', model: routeModel('summary', 'openai') },
    { provider: 'anthropic', model: routeModel('summary', 'anthropic') },
    { provider: 'openrouter', model: 'openai/gpt-4o-mini' },
  ];
  for (const candidate of candidates) {
    try {
      await container.llm(candidate.provider);
      return candidate;
    } catch {
      // Provider not configured — try the next.
    }
  }
  return null;
}
