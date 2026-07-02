/**
 * T6 — pure union/dedup/order logic for the run-time effective document set
 * (`modules/reviews/effective-documents.ts`). Hermetic: no DB, no container.
 *
 * Proves AC-17 (union), AC-18 (dedup by path keeps the agent-level position),
 * AC-19 (agent docs first in persisted order, then per enabled skill in given
 * skill order then that skill's own doc order), that a disabled skill's docs
 * never enter the effective set (the caller simply omits them from
 * `enabledSkillDocs` — this test proves that omission is sufficient), and
 * that the function is now repo-agnostic (2-arg signature, T6): the
 * `pullRepoId` parameter and `excludedByRepoMismatch` result field were
 * removed entirely. Callers (`run-executor.ts`, T7) now always fetch
 * `linkedDocuments(id, repo.id)` pre-scoped to the reviewed PR's own repo, so
 * a run-time mismatch can no longer exist by construction — there is nothing
 * left for this pure function to exclude.
 */
import { describe, it, expect } from 'vitest';
import { computeEffectiveDocuments } from '../src/modules/reviews/effective-documents.js';

const REPO_A = '11111111-1111-1111-1111-111111111111';
const REPO_B = '22222222-2222-2222-2222-222222222222';

describe('computeEffectiveDocuments', () => {
  it('AC-17: unions the agent docs with every enabled skill doc', () => {
    const { documents } = computeEffectiveDocuments(
      [{ path: 'specs/agent-only.md', order: 0, repo_id: REPO_A }],
      [
        {
          skillId: 'skill-1',
          skillName: 'Skill One',
          docs: [{ path: 'docs/skill-only.md', order: 0, repo_id: REPO_A }],
        },
      ],
    );

    expect(documents.map((r) => r.path)).toEqual(['specs/agent-only.md', 'docs/skill-only.md']);
    expect(documents[0]!.origin).toEqual({ type: 'agent' });
    expect(documents[1]!.origin).toEqual({
      type: 'skill',
      skill_id: 'skill-1',
      skill_name: 'Skill One',
    });
  });

  it('AC-18: dedupes a path shared across agent + multiple skills, keeping the AGENT position', () => {
    const shared = 'specs/shared.md';
    const { documents } = computeEffectiveDocuments(
      [{ path: shared, order: 0, repo_id: REPO_A }],
      [
        {
          skillId: 'skill-1',
          skillName: 'Skill One',
          docs: [{ path: shared, order: 0, repo_id: REPO_A }],
        },
        {
          skillId: 'skill-2',
          skillName: 'Skill Two',
          docs: [{ path: shared, order: 0, repo_id: REPO_A }],
        },
      ],
    );

    // exactly one entry for the shared path, at the agent-level position, tagged agent
    const matches = documents.filter((r) => r.path === shared);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.origin).toEqual({ type: 'agent' });
  });

  it('AC-18: dedupes a path shared across two skills only (no agent attachment), keeping the FIRST skill', () => {
    const shared = 'docs/shared-skill-only.md';
    const { documents } = computeEffectiveDocuments(
      [],
      [
        {
          skillId: 'skill-1',
          skillName: 'Skill One',
          docs: [{ path: shared, order: 0, repo_id: REPO_A }],
        },
        {
          skillId: 'skill-2',
          skillName: 'Skill Two',
          docs: [{ path: shared, order: 0, repo_id: REPO_A }],
        },
      ],
    );

    const matches = documents.filter((r) => r.path === shared);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.origin).toEqual({
      type: 'skill',
      skill_id: 'skill-1',
      skill_name: 'Skill One',
    });
  });

  it('AC-19: agent docs first (in persisted order), then per skill (in skill order) then per-doc order', () => {
    const { documents } = computeEffectiveDocuments(
      // deliberately unsorted input — the function must sort by `order`, not input position
      [
        { path: 'specs/agent-second.md', order: 1, repo_id: REPO_A },
        { path: 'specs/agent-first.md', order: 0, repo_id: REPO_A },
      ],
      [
        {
          skillId: 'skill-2',
          skillName: 'Skill Two',
          docs: [
            { path: 'docs/skill2-second.md', order: 1, repo_id: REPO_A },
            { path: 'docs/skill2-first.md', order: 0, repo_id: REPO_A },
          ],
        },
        {
          skillId: 'skill-1',
          skillName: 'Skill One',
          docs: [{ path: 'docs/skill1-only.md', order: 0, repo_id: REPO_A }],
        },
      ],
    );

    // enabledSkillDocs is passed in the CALLER's chosen skill order (skill-2 then
    // skill-1 here); this function does not re-sort skills themselves, only docs
    // within a skill and the agent's own docs.
    expect(documents.map((r) => r.path)).toEqual([
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
    const { documents } = computeEffectiveDocuments(
      [{ path: 'specs/agent.md', order: 0, repo_id: REPO_A }],
      [
        {
          skillId: 'enabled-skill',
          skillName: 'Enabled Skill',
          docs: [{ path: 'docs/enabled.md', order: 0, repo_id: REPO_A }],
        },
        // A disabled skill's docs would have looked like this — intentionally
        // NOT included in the array passed to computeEffectiveDocuments:
        // { skillId: 'disabled-skill', skillName: 'Disabled Skill', docs: [{ path: 'docs/disabled.md', order: 0, repo_id: REPO_A }] },
      ],
    );

    expect(documents.map((r) => r.path)).toEqual(['specs/agent.md', 'docs/enabled.md']);
    expect(documents.some((r) => r.path === 'docs/disabled.md')).toBe(false);
  });

  it('returns an empty document list for an empty effective set (nothing attached anywhere)', () => {
    const result = computeEffectiveDocuments([], []);
    expect(result.documents).toEqual([]);
    // The result no longer carries an `excludedByRepoMismatch` field at all.
    expect(result).not.toHaveProperty('excludedByRepoMismatch');
  });

  // ---- T6: no more repo-mismatch exclusion (superseded AC-31 pre-check) ---

  it('no longer excludes anything on a repo_id mismatch — docs anchored to DIFFERENT repo_ids from each other are still unioned as normal', () => {
    // Pre-fix this function took a third `pullRepoId` argument and wholesale-
    // excluded any origin whose repo_id disagreed with it. That check is gone:
    // this function has no repo concept anymore. It is the CALLER's
    // responsibility (run-executor.ts fetches `linkedDocuments(id, repo.id)`
    // scoped to the reviewed PR's own repo) to ensure only same-repo links are
    // ever passed in — AC-31 now holds by construction, not by a check here.
    const { documents } = computeEffectiveDocuments(
      [{ path: 'specs/a.md', order: 0, repo_id: REPO_A }],
      [
        {
          skillId: 'skill-1',
          skillName: 'Skill One',
          docs: [{ path: 'docs/b.md', order: 0, repo_id: REPO_B }],
        },
      ],
    );

    expect(documents.map((r) => r.path)).toEqual(['specs/a.md', 'docs/b.md']);
  });

  it('unions docs whose repo_id is null (legacy/unanchored rows) exactly like any other doc', () => {
    const { documents } = computeEffectiveDocuments(
      [{ path: 'specs/legacy.md', order: 0, repo_id: null }],
      [
        {
          skillId: 'legacy-skill',
          skillName: 'Legacy Skill',
          docs: [{ path: 'docs/legacy-skill.md', order: 0, repo_id: null }],
        },
      ],
    );

    expect(documents.map((r) => r.path)).toEqual(['specs/legacy.md', 'docs/legacy-skill.md']);
  });
});
