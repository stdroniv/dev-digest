import { describe, it, expect } from 'vitest';
import type { ConventionDraft } from '@devdigest/shared';
import { verifyConventions, verificationSummary, locateSnippet } from '../src/index.js';

/**
 * The grounding gate for conventions: a candidate survives only if its cited
 * file is among the sampled files AND its snippet actually appears there. The
 * surviving draft's line range is re-derived from the real match location.
 */
describe('verifyConventions', () => {
  const fileA = ['export function ok() {', '  return await db.find(id);', '}'].join('\n');
  const files = new Map<string, string>([['src/a.ts', fileA]]);

  const grounded: ConventionDraft = {
    category: 'Data access',
    rule: 'Await db calls',
    evidence: { file: 'src/a.ts', start_line: 99, end_line: 99, snippet: 'return await db.find(id);' },
    confidence: 0.9,
  };

  it('keeps a grounded candidate and corrects its line range', () => {
    const { kept, dropped } = verifyConventions([grounded], files);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
    // line re-derived from the real match (line 2), not the model's bogus 99.
    expect(kept[0]!.evidence.start_line).toBe(2);
    expect(kept[0]!.evidence.end_line).toBe(2);
  });

  it('drops a candidate whose file was not sampled', () => {
    const ghost: ConventionDraft = {
      ...grounded,
      evidence: { ...grounded.evidence, file: 'src/missing.ts' },
    };
    const { kept, dropped } = verifyConventions([ghost], files);
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.reason).toMatch(/not one of the sampled files/);
  });

  it('drops a candidate whose snippet is not in the file (hallucinated evidence)', () => {
    const fake: ConventionDraft = {
      ...grounded,
      evidence: { ...grounded.evidence, snippet: 'const x = totallyMadeUp();' },
    };
    const { kept, dropped } = verifyConventions([fake], files);
    expect(kept).toHaveLength(0);
    expect(dropped[0]!.reason).toMatch(/snippet not found/);
  });

  it('matches despite whitespace/indentation differences', () => {
    const reindented: ConventionDraft = {
      ...grounded,
      evidence: { ...grounded.evidence, snippet: 'return   await db.find(id);' },
    };
    expect(verifyConventions([reindented], files).kept).toHaveLength(1);
  });

  it('summary reports kept/total', () => {
    const ghost: ConventionDraft = { ...grounded, evidence: { ...grounded.evidence, file: 'x' } };
    expect(verificationSummary(verifyConventions([grounded, ghost], files))).toBe('1/2 verified');
  });
});

describe('locateSnippet', () => {
  it('spans multiple snippet lines', () => {
    const content = ['a', 'b', 'c', 'd'].join('\n');
    expect(locateSnippet(content, 'b\nc')).toEqual({ start: 2, end: 3 });
  });
  it('returns null for an absent snippet', () => {
    expect(locateSnippet('a\nb', 'zzz')).toBeNull();
  });
});
