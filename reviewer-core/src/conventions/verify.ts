import type { ConventionDraft } from '@devdigest/shared';

/**
 * Convention citation grounding — the mandatory mechanical gate, analogous to
 * grounding.ts for review findings. Pure code, NO model.
 *
 * A candidate is kept ONLY if its cited evidence actually exists: the file must
 * be one of the sampled files AND the cited snippet must appear in that file's
 * contents. Candidates that fail are dropped (the model "hallucinated" the
 * evidence) so they never reach the UI or the generated skill.
 *
 * As a bonus, we RE-DERIVE the true line range from where the snippet actually
 * occurs and overwrite the draft's evidence lines. The model's reported line
 * numbers often drift; correcting them here guarantees the clickable GitHub link
 * points at the real code.
 */

export interface ConventionVerifyResult {
  kept: ConventionDraft[];
  dropped: { draft: ConventionDraft; reason: string }[];
}

/** Collapse runs of whitespace so trivial formatting differences don't reject a real match. */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Find the snippet's location in the file by matching its first non-blank line,
 * then spanning the snippet's line count (clamped to the file). Returns a 1-based
 * inclusive [start, end] range, or null if the snippet isn't present.
 */
export function locateSnippet(
  content: string,
  snippet: string,
): { start: number; end: number } | null {
  const fileLines = content.split('\n');
  const snipLines = snippet
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (snipLines.length === 0) return null;

  const first = snipLines[0]!;
  for (let i = 0; i < fileLines.length; i++) {
    if (normalize(fileLines[i]!).includes(normalize(first))) {
      const start = i + 1;
      const end = Math.min(fileLines.length, i + snipLines.length);
      return { start, end };
    }
  }
  return null;
}

/** Apply the grounding gate to a set of drafts against the sampled file contents. */
export function verifyConventions(
  drafts: ConventionDraft[],
  files: Map<string, string>,
): ConventionVerifyResult {
  const kept: ConventionDraft[] = [];
  const dropped: { draft: ConventionDraft; reason: string }[] = [];

  for (const draft of drafts) {
    const content = files.get(draft.evidence.file);
    if (content === undefined) {
      dropped.push({ draft, reason: `file '${draft.evidence.file}' is not one of the sampled files` });
      continue;
    }
    const loc = locateSnippet(content, draft.evidence.snippet);
    if (!loc) {
      dropped.push({ draft, reason: `cited snippet not found in '${draft.evidence.file}'` });
      continue;
    }
    // Keep, with the line range corrected to where the snippet truly lives.
    kept.push({
      ...draft,
      evidence: { ...draft.evidence, start_line: loc.start, end_line: loc.end },
    });
  }

  return { kept, dropped };
}

/** Human-readable summary, e.g. "3/5 verified". */
export function verificationSummary(result: ConventionVerifyResult): string {
  const total = result.kept.length + result.dropped.length;
  return `${result.kept.length}/${total} verified`;
}
