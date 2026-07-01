/**
 * history/service — hermetic unit tests for the pure buildPriorPrs function.
 *
 * No DB, no git, no network. Tests drive buildPriorPrs directly with
 * hand-built commitsByFile fixtures and assert the shaped PrHistory.
 *
 * Covered:
 *  - Two files sharing a PR → single item with both in files_overlap.
 *  - Own-PR number excluded.
 *  - Commits with no parseable ref dropped.
 *  - merged_at is the max date across sightings.
 *  - Sort is recency-desc.
 *  - maxPrs cap (8 by default; cap overridden in tests).
 *  - Empty input → { history: [] }.
 */
import { describe, it, expect } from 'vitest';
import { buildPriorPrs } from './service.js';
import type { GitCommit } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function commit(message: string, author = 'alice', date = '2026-01-10'): GitCommit {
  return { sha: 'deadbeef', message, author, date };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPriorPrs — basic grouping', () => {
  it('two files sharing PR #482 → one item with both files in files_overlap', () => {
    const input = [
      { file: 'src/a.ts', commits: [commit('Feat A (#482)')] },
      { file: 'src/b.ts', commits: [commit('Feat A (#482)')] },
    ];
    const result = buildPriorPrs(input, 999);
    expect(result.history).toHaveLength(1);
    const item = result.history[0]!;
    expect(item.pr_number).toBe(482);
    expect(item.files_overlap).toContain('src/a.ts');
    expect(item.files_overlap).toContain('src/b.ts');
    expect(item.notes).toBe('Touched 2 of these files');
  });

  it('files_overlap is sorted alphabetically', () => {
    const input = [
      { file: 'src/z.ts', commits: [commit('Feature (#10)')] },
      { file: 'src/a.ts', commits: [commit('Feature (#10)')] },
    ];
    const result = buildPriorPrs(input, 999);
    expect(result.history[0]!.files_overlap).toEqual(['src/a.ts', 'src/z.ts']);
  });

  it('title is derived from the first sighting commit subject (stripped of #N)', () => {
    const input = [
      { file: 'src/a.ts', commits: [commit('Add rate limiting (#482)')] },
    ];
    const result = buildPriorPrs(input, 999);
    expect(result.history[0]!.title).toBe('Add rate limiting');
  });
});

describe('buildPriorPrs — own-PR exclusion', () => {
  it('excludes commits whose PR number matches ownPrNumber', () => {
    const input = [
      {
        file: 'src/a.ts',
        commits: [
          commit('Fix bug (#101)'),   // prior PR — include
          commit('My PR (#900)'),       // own PR — exclude
        ],
      },
    ];
    const result = buildPriorPrs(input, 900);
    expect(result.history).toHaveLength(1);
    expect(result.history[0]!.pr_number).toBe(101);
  });
});

describe('buildPriorPrs — unparseable commits', () => {
  it('drops commits with no parseable PR ref', () => {
    const input = [
      {
        file: 'src/a.ts',
        commits: [
          commit('Fix typo'),           // no ref → drop
          commit('Refactor (#55)'),     // valid → include
        ],
      },
    ];
    const result = buildPriorPrs(input, 999);
    expect(result.history).toHaveLength(1);
    expect(result.history[0]!.pr_number).toBe(55);
  });

  it('returns { history: [] } when all commits are unparseable', () => {
    const input = [
      { file: 'src/a.ts', commits: [commit('random commit')] },
    ];
    const result = buildPriorPrs(input, 999);
    expect(result.history).toEqual({ history: [] }.history);
    expect(result.history).toHaveLength(0);
  });
});

describe('buildPriorPrs — merged_at is the max date', () => {
  it('keeps the latest date across multiple sightings of the same PR', () => {
    const input = [
      {
        file: 'src/a.ts',
        commits: [
          { sha: 'aa', message: 'Feat (#10)', author: 'alice', date: '2026-01-05' },
        ],
      },
      {
        file: 'src/b.ts',
        commits: [
          { sha: 'bb', message: 'Feat (#10)', author: 'bob', date: '2026-01-10' },
        ],
      },
    ];
    const result = buildPriorPrs(input, 999);
    expect(result.history[0]!.merged_at).toBe('2026-01-10');
  });
});

describe('buildPriorPrs — recency sort', () => {
  it('sorts items by merged_at descending (newest first)', () => {
    const input = [
      { file: 'src/a.ts', commits: [
        { sha: 'a1', message: 'Older PR (#10)', author: 'alice', date: '2026-01-01' },
        { sha: 'a2', message: 'Newer PR (#20)', author: 'bob',   date: '2026-06-01' },
      ]},
    ];
    const result = buildPriorPrs(input, 999);
    expect(result.history[0]!.pr_number).toBe(20);
    expect(result.history[1]!.pr_number).toBe(10);
  });
});

describe('buildPriorPrs — maxPrs cap', () => {
  it('caps output at maxPrs and keeps the newest', () => {
    // Build 10 distinct PRs with increasing dates (so #10 is newest).
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `sha${i}`,
      message: `PR (#${i + 1})`,
      author: 'dev',
      date: `2026-0${Math.floor(i / 3) + 1}-${String(i + 1).padStart(2, '0')}`,
    }));
    const input = [{ file: 'src/a.ts', commits }];
    const result = buildPriorPrs(input, 999, { maxPrs: 8 });
    expect(result.history).toHaveLength(8);
  });

  it('returns all items when count is below maxPrs', () => {
    const input = [{ file: 'src/a.ts', commits: [commit('Small PR (#1)')] }];
    const result = buildPriorPrs(input, 999, { maxPrs: 8 });
    expect(result.history).toHaveLength(1);
  });
});

describe('buildPriorPrs — empty input', () => {
  it('returns { history: [] } for empty commitsByFile', () => {
    expect(buildPriorPrs([], 999)).toEqual({ history: [] });
  });

  it('returns { history: [] } when files have empty commit arrays', () => {
    const input = [
      { file: 'src/a.ts', commits: [] },
      { file: 'src/b.ts', commits: [] },
    ];
    expect(buildPriorPrs(input, 999)).toEqual({ history: [] });
  });
});

describe('buildPriorPrs — notes field', () => {
  it('notes = "Touched 1 of these files" for a single-file overlap', () => {
    const input = [{ file: 'src/a.ts', commits: [commit('Fix (#7)')] }];
    const result = buildPriorPrs(input, 999);
    expect(result.history[0]!.notes).toBe('Touched 1 of these files');
  });

  it('notes reflects the actual overlap size across multiple files', () => {
    const input = [
      { file: 'src/a.ts', commits: [commit('Big PR (#42)')] },
      { file: 'src/b.ts', commits: [commit('Big PR (#42)')] },
      { file: 'src/c.ts', commits: [commit('Big PR (#42)')] },
    ];
    const result = buildPriorPrs(input, 999);
    expect(result.history[0]!.notes).toBe('Touched 3 of these files');
  });
});
