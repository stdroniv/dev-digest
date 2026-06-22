import type {
  Skill,
  SkillSource,
  SkillStats,
  SkillStatsAgent,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
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

/**
 * Raw aggregates the repository pulls for one skill's Stats tab. Kept as plain
 * numbers + rows so the percentage math lives in `computeSkillStats` (pure, unit
 * tested) rather than in SQL.
 */
export interface SkillStatsRaw {
  /** Agents linked to the skill (id + name), already ordered for display. */
  agents: SkillStatsAgent[];
  /** In-window reviews with a non-null agent_id (the pull-frequency denominator). */
  reviewsInWindowTotal: number;
  /** In-window reviews produced by an agent that uses this skill (numerator). */
  reviewsInWindowForSkill: number;
  /** In-window findings from this skill's agents, with their accept/dismiss state. */
  findings: { category: string; acceptedAt: Date | null; dismissedAt: Date | null }[];
}

/** Round to one decimal place (percentages render as e.g. 71.4%). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Fold raw per-skill aggregates into the public `SkillStats` DTO. Pure: owns the
 * percentage rounding, the zero-denominator → 0 guards (pull frequency with no
 * reviews; accept rate with nothing decided), and the category rollup (sorted
 * descending by count, then name for stable ordering).
 */
export function computeSkillStats(
  skillId: string,
  windowDays: number,
  raw: SkillStatsRaw,
): SkillStats {
  const pullFrequencyPct =
    raw.reviewsInWindowTotal > 0
      ? round1((raw.reviewsInWindowForSkill / raw.reviewsInWindowTotal) * 100)
      : 0;

  let accepted = 0;
  let decided = 0;
  const byCategory = new Map<string, number>();
  for (const f of raw.findings) {
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
    const isAccepted = f.acceptedAt != null;
    const isDismissed = f.dismissedAt != null;
    if (isAccepted) accepted += 1;
    if (isAccepted || isDismissed) decided += 1;
  }
  const acceptRatePct = decided > 0 ? round1((accepted / decided) * 100) : 0;

  const findingsByCategory = [...byCategory.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  return {
    skill_id: skillId,
    window_days: windowDays,
    used_by: { count: raw.agents.length, agents: raw.agents },
    pull_frequency_pct: pullFrequencyPct,
    accept_rate_pct: acceptRatePct,
    findings_30d: raw.findings.length,
    findings_by_category: findingsByCategory,
  };
}
