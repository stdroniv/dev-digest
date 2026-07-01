/**
 * T9 — pure union/dedup/order logic for the run-time effective document set
 * (`modules/reviews/effective-documents.ts`). Hermetic: no DB, no container.
 *
 * Proves AC-17 (union), AC-18 (dedup by path keeps the agent-level position),
 * AC-19 (agent docs first in persisted order, then per enabled skill in given
 * skill order then that skill's own doc order), and that a disabled skill's
 * docs never enter the effective set (the caller simply omits them from
 * `enabledSkillDocs` — this test proves that omission is sufficient).
 */
import { describe, it, expect } from 'vitest';
import { computeEffectiveDocuments } from '../src/modules/reviews/effective-documents.js';

describe('computeEffectiveDocuments', () => {
  it('AC-17: unions the agent docs with every enabled skill doc', () => {
    const result = computeEffectiveDocuments(
      [{ path: 'specs/agent-only.md', order: 0 }],
      [
        {
          skillId: 'skill-1',
          skillName: 'Skill One',
          docs: [{ path: 'docs/skill-only.md', order: 0 }],
        },
      ],
    );

    expect(result.map((r) => r.path)).toEqual(['specs/agent-only.md', 'docs/skill-only.md']);
    expect(result[0]!.origin).toEqual({ type: 'agent' });
    expect(result[1]!.origin).toEqual({
      type: 'skill',
      skill_id: 'skill-1',
      skill_name: 'Skill One',
    });
  });

  it('AC-18: dedupes a path shared across agent + multiple skills, keeping the AGENT position', () => {
    const shared = 'specs/shared.md';
    const result = computeEffectiveDocuments(
      [{ path: shared, order: 0 }],
      [
        { skillId: 'skill-1', skillName: 'Skill One', docs: [{ path: shared, order: 0 }] },
        { skillId: 'skill-2', skillName: 'Skill Two', docs: [{ path: shared, order: 0 }] },
      ],
    );

    // exactly one entry for the shared path, at the agent-level position, tagged agent
    const matches = result.filter((r) => r.path === shared);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.origin).toEqual({ type: 'agent' });
  });

  it('AC-18: dedupes a path shared across two skills only (no agent attachment), keeping the FIRST skill', () => {
    const shared = 'docs/shared-skill-only.md';
    const result = computeEffectiveDocuments(
      [],
      [
        { skillId: 'skill-1', skillName: 'Skill One', docs: [{ path: shared, order: 0 }] },
        { skillId: 'skill-2', skillName: 'Skill Two', docs: [{ path: shared, order: 0 }] },
      ],
    );

    const matches = result.filter((r) => r.path === shared);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.origin).toEqual({
      type: 'skill',
      skill_id: 'skill-1',
      skill_name: 'Skill One',
    });
  });

  it('AC-19: agent docs first (in persisted order), then per skill (in skill order) then per-doc order', () => {
    const result = computeEffectiveDocuments(
      // deliberately unsorted input — the function must sort by `order`, not input position
      [
        { path: 'specs/agent-second.md', order: 1 },
        { path: 'specs/agent-first.md', order: 0 },
      ],
      [
        {
          skillId: 'skill-2',
          skillName: 'Skill Two',
          docs: [
            { path: 'docs/skill2-second.md', order: 1 },
            { path: 'docs/skill2-first.md', order: 0 },
          ],
        },
        {
          skillId: 'skill-1',
          skillName: 'Skill One',
          docs: [{ path: 'docs/skill1-only.md', order: 0 }],
        },
      ],
    );

    // enabledSkillDocs is passed in the CALLER's chosen skill order (skill-2 then
    // skill-1 here); this function does not re-sort skills themselves, only docs
    // within a skill and the agent's own docs.
    expect(result.map((r) => r.path)).toEqual([
      'specs/agent-first.md',
      'specs/agent-second.md',
      'docs/skill2-first.md',
      'docs/skill2-second.md',
      'docs/skill1-only.md',
    ]);
  });

  it('excludes a disabled skill entirely when the caller omits it from enabledSkillDocs', () => {
    // The caller (run-executor.ts) filters `linkedSkills.filter(l => l.skill.enabled)`
    // BEFORE building enabledSkillDocs — so a disabled skill's docs never appear
    // here at all. This test proves that omission is sufficient: no doc from a
    // "disabled" skill (simply never passed in) leaks into the effective set.
    const result = computeEffectiveDocuments(
      [{ path: 'specs/agent.md', order: 0 }],
      [
        {
          skillId: 'enabled-skill',
          skillName: 'Enabled Skill',
          docs: [{ path: 'docs/enabled.md', order: 0 }],
        },
        // A disabled skill's docs would have looked like this — intentionally
        // NOT included in the array passed to computeEffectiveDocuments:
        // { skillId: 'disabled-skill', skillName: 'Disabled Skill', docs: [{ path: 'docs/disabled.md', order: 0 }] },
      ],
    );

    expect(result.map((r) => r.path)).toEqual(['specs/agent.md', 'docs/enabled.md']);
    expect(result.some((r) => r.path === 'docs/disabled.md')).toBe(false);
  });

  it('returns [] for an empty effective set (nothing attached anywhere)', () => {
    expect(computeEffectiveDocuments([], [])).toEqual([]);
  });
});
