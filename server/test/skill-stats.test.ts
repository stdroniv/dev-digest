/**
 * Skill stats — pure aggregation logic (`computeSkillStats`). Hermetic: no DB.
 * Proves the percentage math, the zero-denominator → 0 guards, and the category
 * rollup ordering. The DB join that feeds the raw shape is covered by
 * skill-stats.it.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { computeSkillStats, type SkillStatsRaw } from '../src/modules/skills/helpers.js';

const d = (iso: string) => new Date(iso);

describe('computeSkillStats', () => {
  it('computes all metrics from raw aggregates', () => {
    const raw: SkillStatsRaw = {
      agents: [
        { id: 'a1', name: 'Alpha' },
        { id: 'a2', name: 'Beta' },
        { id: 'a3', name: 'Gamma' },
      ],
      reviewsInWindowTotal: 8,
      reviewsInWindowForSkill: 6,
      findings: [
        { category: 'bug', acceptedAt: d('2026-06-01'), dismissedAt: null },
        { category: 'bug', acceptedAt: d('2026-06-02'), dismissedAt: null },
        { category: 'bug', acceptedAt: null, dismissedAt: d('2026-06-03') },
        { category: 'perf', acceptedAt: d('2026-06-04'), dismissedAt: null },
        { category: 'perf', acceptedAt: null, dismissedAt: d('2026-06-05') },
        { category: 'security', acceptedAt: d('2026-06-06'), dismissedAt: null },
      ],
    };

    const stats = computeSkillStats('skill-1', 30, raw);

    expect(stats.skill_id).toBe('skill-1');
    expect(stats.window_days).toBe(30);
    expect(stats.used_by).toEqual({
      count: 3,
      agents: [
        { id: 'a1', name: 'Alpha' },
        { id: 'a2', name: 'Beta' },
        { id: 'a3', name: 'Gamma' },
      ],
    });
    // 6 / 8 = 75%
    expect(stats.pull_frequency_pct).toBe(75);
    // accepted 4 of 6 decided = 66.666… → 66.7
    expect(stats.accept_rate_pct).toBe(66.7);
    expect(stats.findings_30d).toBe(6);
    // descending by count
    expect(stats.findings_by_category).toEqual([
      { category: 'bug', count: 3 },
      { category: 'perf', count: 2 },
      { category: 'security', count: 1 },
    ]);
  });

  it('returns 0 pull frequency when there are no in-window reviews', () => {
    const raw: SkillStatsRaw = {
      agents: [],
      reviewsInWindowTotal: 0,
      reviewsInWindowForSkill: 0,
      findings: [],
    };
    const stats = computeSkillStats('s', 30, raw);
    expect(stats.pull_frequency_pct).toBe(0);
    expect(stats.accept_rate_pct).toBe(0);
    expect(stats.findings_30d).toBe(0);
    expect(stats.used_by.count).toBe(0);
    expect(stats.findings_by_category).toEqual([]);
  });

  it('returns 0 accept rate when findings exist but none are decided', () => {
    const raw: SkillStatsRaw = {
      agents: [{ id: 'a1', name: 'Alpha' }],
      reviewsInWindowTotal: 2,
      reviewsInWindowForSkill: 1,
      findings: [
        { category: 'bug', acceptedAt: null, dismissedAt: null },
        { category: 'bug', acceptedAt: null, dismissedAt: null },
      ],
    };
    const stats = computeSkillStats('s', 30, raw);
    expect(stats.accept_rate_pct).toBe(0);
    expect(stats.findings_30d).toBe(2);
    expect(stats.findings_by_category).toEqual([{ category: 'bug', count: 2 }]);
    expect(stats.pull_frequency_pct).toBe(50);
  });

  it('breaks category count ties alphabetically', () => {
    const raw: SkillStatsRaw = {
      agents: [],
      reviewsInWindowTotal: 1,
      reviewsInWindowForSkill: 0,
      findings: [
        { category: 'style', acceptedAt: d('2026-06-01'), dismissedAt: null },
        { category: 'perf', acceptedAt: d('2026-06-01'), dismissedAt: null },
        { category: 'bug', acceptedAt: d('2026-06-01'), dismissedAt: null },
      ],
    };
    const stats = computeSkillStats('s', 30, raw);
    expect(stats.findings_by_category.map((c) => c.category)).toEqual(['bug', 'perf', 'style']);
  });

  it('rounds pull frequency to one decimal place', () => {
    const raw: SkillStatsRaw = {
      agents: [],
      reviewsInWindowTotal: 3,
      reviewsInWindowForSkill: 1,
      findings: [],
    };
    // 1 / 3 = 33.333… → 33.3
    expect(computeSkillStats('s', 30, raw).pull_frequency_pct).toBe(33.3);
  });
});
