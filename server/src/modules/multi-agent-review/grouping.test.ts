import { describe, it, expect } from 'vitest';
import { computeConflicts, isGenuineConflict, type ReviewedAgentFindings } from './grouping.js';

/** Build a minimal reviewed-agent fixture. */
function agent(
  agent_id: string,
  persona: string,
  findings: ReviewedAgentFindings['findings'] = [],
): ReviewedAgentFindings {
  return { agent_id, persona, findings };
}

describe('computeConflicts (AC-26/27/29)', () => {
  it('groups findings by normalized file + overlapping inclusive line range (AC-26)', () => {
    const agents: ReviewedAgentFindings[] = [
      agent('a1', 'Security', [
        { file: 'a/src/x.ts', start_line: 10, end_line: 12, severity: 'CRITICAL', title: 'Leak' },
      ]),
      agent('a2', 'Performance', [
        { file: 'src/x.ts', start_line: 11, end_line: 11, severity: 'WARNING', title: 'Slow path' },
      ]),
    ];
    const conflicts = computeConflicts(agents);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.file).toBe('src/x.ts'); // 'a/' diff prefix normalized away
    expect(conflicts[0]!.takes).toHaveLength(2);
  });

  it('does NOT group non-overlapping line ranges in the same file', () => {
    const agents: ReviewedAgentFindings[] = [
      agent('a1', 'Security', [
        { file: 'src/x.ts', start_line: 10, end_line: 12, severity: 'CRITICAL', title: 'Leak' },
      ]),
      agent('a2', 'Performance', [
        { file: 'src/x.ts', start_line: 40, end_line: 42, severity: 'WARNING', title: 'Slow path' },
      ]),
    ];
    const conflicts = computeConflicts(agents);
    expect(conflicts).toHaveLength(2);
  });

  it('every reviewed agent gets a take: flagged → verdict=severity+title note, did-not-flag → verdict="ignored"+empty note (AC-27)', () => {
    const agents: ReviewedAgentFindings[] = [
      agent('a1', 'Security', [
        { file: 'src/x.ts', start_line: 10, end_line: 10, severity: 'CRITICAL', title: 'Hardcoded secret' },
      ]),
      agent('a2', 'Performance', []), // reviewed, found nothing here
    ];
    const [conflict] = computeConflicts(agents);
    expect(conflict).toBeDefined();
    const takeByAgent = new Map(conflict!.takes.map((t) => [t.agent_id, t]));
    expect(takeByAgent.get('a1')).toEqual({
      agent_id: 'a1',
      persona: 'Security',
      verdict: 'CRITICAL',
      note: 'Hardcoded secret',
    });
    expect(takeByAgent.get('a2')).toEqual({
      agent_id: 'a2',
      persona: 'Performance',
      verdict: 'ignored',
      note: '',
    });
  });

  it('falls back to rationale for the note when title is empty (Q4)', () => {
    const agents: ReviewedAgentFindings[] = [
      agent('a1', 'Security', [
        {
          file: 'src/x.ts',
          start_line: 10,
          end_line: 10,
          severity: 'CRITICAL',
          title: '',
          rationale: 'A live key is committed.',
        },
      ]),
    ];
    const [conflict] = computeConflicts(agents);
    expect(conflict!.takes[0]!.note).toBe('A live key is committed.');
  });

  it('a failed/running agent (simply absent from the input) is never enumerated as "did not flag"', () => {
    // Only the two REVIEWED (status='done') agents are passed in — a third,
    // failed/running agent is never part of `agents` at all (per the plan's
    // "Reviewed-agent set": the caller filters columns to status==='done'
    // before building this input).
    const agents: ReviewedAgentFindings[] = [
      agent('a1', 'Security', [
        { file: 'src/x.ts', start_line: 10, end_line: 10, severity: 'CRITICAL', title: 'Leak' },
      ]),
      agent('a2', 'Performance', []),
    ];
    const [conflict] = computeConflicts(agents);
    expect(conflict!.takes).toHaveLength(2);
    expect(conflict!.takes.some((t) => t.agent_id === 'failed-agent')).toBe(false);
  });

  it('emits a row for a full-consensus location too (not just genuine conflicts) — AC-27/AC-28 need it to filter client-side', () => {
    const agents: ReviewedAgentFindings[] = [
      agent('a1', 'Security', [
        { file: 'src/x.ts', start_line: 10, end_line: 10, severity: 'WARNING', title: 'Same finding' },
      ]),
      agent('a2', 'Performance', [
        { file: 'src/x.ts', start_line: 10, end_line: 10, severity: 'WARNING', title: 'Same finding, too' },
      ]),
    ];
    const [conflict] = computeConflicts(agents);
    expect(conflict).toBeDefined();
    expect(conflict!.takes.every((t) => t.verdict === 'WARNING')).toBe(true);
    expect(isGenuineConflict(conflict!)).toBe(false);
    // AC-29 wire field mirrors the predicate (client filters on this, no re-derivation).
    expect(conflict!.is_conflict).toBe(false);
  });
});

describe('isGenuineConflict (AC-29 classification)', () => {
  it('is a conflict when ≥1 flagged and ≥1 other reviewed agent did not', () => {
    const [conflict] = computeConflicts([
      agent('a1', 'Security', [
        { file: 'src/x.ts', start_line: 1, end_line: 1, severity: 'CRITICAL', title: 'X' },
      ]),
      agent('a2', 'Performance', []),
    ]);
    expect(isGenuineConflict(conflict!)).toBe(true);
    expect(conflict!.is_conflict).toBe(true);
  });

  it('is a conflict when reviewing agents assigned divergent severities (all flagged, no "ignored")', () => {
    const [conflict] = computeConflicts([
      agent('a1', 'Security', [
        { file: 'src/x.ts', start_line: 1, end_line: 1, severity: 'CRITICAL', title: 'X' },
      ]),
      agent('a2', 'Performance', [
        { file: 'src/x.ts', start_line: 1, end_line: 1, severity: 'SUGGESTION', title: 'Y' },
      ]),
    ]);
    expect(isGenuineConflict(conflict!)).toBe(true);
  });

  it('is NOT a conflict when every reviewing agent agrees on the same severity', () => {
    const [conflict] = computeConflicts([
      agent('a1', 'Security', [
        { file: 'src/x.ts', start_line: 1, end_line: 1, severity: 'WARNING', title: 'X' },
      ]),
      agent('a2', 'Performance', [
        { file: 'src/x.ts', start_line: 1, end_line: 1, severity: 'WARNING', title: 'Y' },
      ]),
    ]);
    expect(isGenuineConflict(conflict!)).toBe(false);
  });
});
