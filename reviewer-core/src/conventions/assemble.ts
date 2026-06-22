import type { ConventionDraft } from '@devdigest/shared';

/**
 * Merge accepted convention drafts into ONE `repo-conventions` skill body.
 *
 * The body is grouped by category and, per rule, cites the file:line and shows
 * the proving snippet — so a reviewing agent can both apply the rule and point at
 * precedent. Only ACCEPTED drafts should be passed in; rejected candidates are
 * filtered out by the caller and never reach this function.
 *
 * Pure: deterministic string assembly, no I/O.
 */

export const REPO_CONVENTIONS_SKILL_NAME = 'repo-conventions';

export interface AssembledConventionSkill {
  name: string;
  description: string;
  /** Markdown body, ready to drop into the skill editor. */
  body: string;
  /** Unique evidence file paths (persisted on skills.evidence_files). */
  evidenceFiles: string[];
}

/** Render a 1-based inclusive range as "23" or "23-31". */
function fmtRange(start: number, end: number): string {
  return start === end ? `${start}` : `${start}-${end}`;
}

/** Group drafts by category, preserving first-seen order (case-insensitive key). */
function groupByCategory(drafts: ConventionDraft[]): Map<string, ConventionDraft[]> {
  const groups = new Map<string, ConventionDraft[]>();
  for (const d of drafts) {
    const label = d.category.trim() || 'General';
    const key = label.toLowerCase();
    const existing = groups.get(key);
    if (existing) existing.push(d);
    else groups.set(key, [d]);
  }
  return groups;
}

export function assembleConventionSkill(
  accepted: ConventionDraft[],
  opts: { repoName?: string } = {},
): AssembledConventionSkill {
  const repoName = opts.repoName?.trim() || 'this repository';
  const groups = groupByCategory(accepted);

  const sections: string[] = [];
  for (const drafts of groups.values()) {
    // Use the first draft's original (un-lowercased) category label as the heading.
    const heading = drafts[0]!.category.trim() || 'General';
    const lines: string[] = [`## ${heading}`];
    for (const d of drafts) {
      const range = fmtRange(d.evidence.start_line, d.evidence.end_line);
      const rule = d.rule.trim();
      lines.push(`- ${rule}`);
      lines.push(`  Detected in \`${d.evidence.file}:${range}\`:`);
      lines.push('  ```');
      for (const ln of d.evidence.snippet.split('\n')) lines.push(`  ${ln}`);
      lines.push('  ```');
    }
    sections.push(lines.join('\n'));
  }

  const intro = `House coding conventions for \`${repoName}\`. When reviewing a change, flag anything that violates a rule below and cite the offending \`file:line\`.`;
  const body =
    accepted.length === 0
      ? `# ${REPO_CONVENTIONS_SKILL_NAME}\n\n${intro}\n\n_No conventions selected yet._\n`
      : `# ${REPO_CONVENTIONS_SKILL_NAME}\n\n${intro}\n\n${sections.join('\n\n')}\n`;

  const evidenceFiles = [...new Set(accepted.map((d) => d.evidence.file))];
  const n = accepted.length;

  return {
    name: REPO_CONVENTIONS_SKILL_NAME,
    description: `${n} house convention${n === 1 ? '' : 's'} extracted from ${repoName}`,
    body,
    evidenceFiles,
  };
}
