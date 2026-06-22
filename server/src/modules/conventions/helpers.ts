import type { ConventionCandidate, ConventionDraft } from '@devdigest/shared';
import type { ConventionRow } from '../../db/rows.js';

/** Map a persisted convention row to the public `ConventionCandidate` DTO. */
export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    repo_id: row.repoId ?? null,
    run_id: row.runId ?? null,
    category: row.category ?? null,
    rule: row.rule,
    evidence_path: row.evidencePath ?? null,
    evidence_snippet: row.evidenceSnippet ?? null,
    evidence_start_line: row.evidenceStartLine ?? null,
    evidence_end_line: row.evidenceEndLine ?? null,
    confidence: row.confidence ?? null,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * Map an accepted convention row back to a `ConventionDraft` so the pure
 * assembler (reviewer-core) can build the skill body. Missing line numbers
 * default to 1 (full-file-ish), never undefined.
 */
export function rowToDraft(row: ConventionRow): ConventionDraft {
  const start = row.evidenceStartLine ?? 1;
  return {
    category: row.category ?? 'General',
    rule: row.rule,
    evidence: {
      file: row.evidencePath ?? '',
      start_line: start,
      end_line: row.evidenceEndLine ?? start,
      snippet: row.evidenceSnippet ?? '',
    },
    confidence: row.confidence ?? 0,
  };
}
