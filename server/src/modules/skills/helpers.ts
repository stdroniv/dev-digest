import type { Skill, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping and the
 * body-version-bump rule. No I/O. The token count is injected by the service
 * (it owns the tokenizer adapter); helpers stay side-effect-free.
 */

/** Map a persisted skill row to the public `Skill` DTO, with a derived token count. */
export function toSkillDto(row: SkillRow, tokens?: number): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    ...(tokens !== undefined ? { tokens } : {}),
  };
}

/** Map a `skill_versions` row to the public `SkillVersion` DTO. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * True when a patch changes the skill BODY relative to the existing row. Only a
 * body change bumps the version + appends an immutable snapshot — editing the
 * name/description/type or toggling `enabled` does NOT version (mirrors the
 * agent config-version rule, but the skill's versioned surface is its body).
 */
export function isBodyChange(
  existing: Pick<SkillRow, 'body'>,
  patch: { body?: string },
): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}

/**
 * Derive a skill name from the first markdown `#`/`##` heading, falling back to
 * a slug-ish default. Used by the import preview when the user gives no name.
 */
export function deriveSkillName(body: string, fallback = 'imported-skill'): string {
  for (const line of body.split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line.trim());
    if (m) {
      return m[1]!
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    }
  }
  return fallback;
}
