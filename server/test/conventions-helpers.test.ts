import { describe, it, expect } from 'vitest';
import { ConventionCandidate } from '@devdigest/shared';
import { toConventionDto, rowToDraft } from '../src/modules/conventions/helpers.js';
import type { ConventionRow } from '../src/db/rows.js';

/**
 * Pure DTO/Draft mappers for the conventions module — hermetic (no DB). Proves
 * the persisted row shape round-trips through the public contract and back into
 * the assembler's draft shape.
 */

const row = (over: Partial<ConventionRow> = {}): ConventionRow => ({
  id: 'c1',
  workspaceId: 'ws1',
  repoId: 'repo1',
  runId: 'run1',
  category: 'Data access',
  rule: 'Await db calls',
  evidencePath: 'src/a.ts',
  evidenceSnippet: 'await db.find(id)',
  evidenceStartLine: 2,
  evidenceEndLine: 2,
  confidence: 0.9,
  status: 'accepted',
  accepted: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...over,
});

describe('toConventionDto', () => {
  it('maps a row to a contract-valid candidate (snake_case, ISO date)', () => {
    const dto = toConventionDto(row());
    expect(() => ConventionCandidate.parse(dto)).not.toThrow();
    expect(dto.evidence_path).toBe('src/a.ts');
    expect(dto.evidence_start_line).toBe(2);
    expect(dto.status).toBe('accepted');
    expect(dto.created_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('passes nullable evidence through as null', () => {
    const dto = toConventionDto(
      row({ category: null, evidencePath: null, evidenceSnippet: null, evidenceStartLine: null, evidenceEndLine: null, confidence: null }),
    );
    expect(() => ConventionCandidate.parse(dto)).not.toThrow();
    expect(dto.category).toBeNull();
    expect(dto.evidence_path).toBeNull();
    expect(dto.confidence).toBeNull();
  });
});

describe('rowToDraft', () => {
  it('rebuilds a draft for the assembler', () => {
    const draft = rowToDraft(row());
    expect(draft.category).toBe('Data access');
    expect(draft.evidence.file).toBe('src/a.ts');
    expect(draft.evidence.start_line).toBe(2);
  });

  it('defaults missing line numbers to 1 rather than undefined', () => {
    const draft = rowToDraft(row({ evidenceStartLine: null, evidenceEndLine: null }));
    expect(draft.evidence.start_line).toBe(1);
    expect(draft.evidence.end_line).toBe(1);
  });
});
