import { describe, it, expect } from 'vitest';
import type { ConventionDraft } from '@devdigest/shared';
import { assembleConventionSkill, REPO_CONVENTIONS_SKILL_NAME } from '../src/index.js';

const draft = (over: Partial<ConventionDraft> & { category: string }): ConventionDraft => ({
  rule: 'A rule',
  evidence: { file: 'src/a.ts', start_line: 23, end_line: 31, snippet: 'const x = 1;' },
  confidence: 0.8,
  ...over,
});

describe('assembleConventionSkill', () => {
  it('groups by category with file:line evidence and a fenced snippet', () => {
    const { name, body, evidenceFiles } = assembleConventionSkill(
      [
        draft({ category: 'Error handling', rule: 'Use async/await', evidence: { file: 'src/api/users.ts', start_line: 23, end_line: 31, snippet: 'const user = await db.users.find(id);' } }),
        draft({ category: 'Error handling', rule: 'No floating promises' }),
        draft({ category: 'Naming', rule: 'camelCase locals', evidence: { file: 'src/lib/x.ts', start_line: 5, end_line: 5, snippet: 'const fooBar = 1;' } }),
      ],
      { repoName: 'payments-api' },
    );
    expect(name).toBe(REPO_CONVENTIONS_SKILL_NAME);
    expect(body).toContain('## Error handling');
    expect(body).toContain('## Naming');
    expect(body).toContain('Detected in `src/api/users.ts:23-31`:');
    expect(body).toContain('const user = await db.users.find(id);');
    // single-line range renders without a dash
    expect(body).toContain('`src/lib/x.ts:5`:');
    // unique evidence files
    expect(evidenceFiles.sort()).toEqual(['src/a.ts', 'src/api/users.ts', 'src/lib/x.ts']);
  });

  it('description counts the conventions and names the repo', () => {
    expect(assembleConventionSkill([draft({ category: 'X' })], { repoName: 'acme' }).description).toBe(
      '1 house convention extracted from acme',
    );
    expect(
      assembleConventionSkill([draft({ category: 'X' }), draft({ category: 'Y' })], { repoName: 'acme' })
        .description,
    ).toBe('2 house conventions extracted from acme');
  });

  it('handles an empty accepted set without throwing', () => {
    const { body, evidenceFiles } = assembleConventionSkill([]);
    expect(body).toContain('No conventions selected yet');
    expect(evidenceFiles).toEqual([]);
  });
});
