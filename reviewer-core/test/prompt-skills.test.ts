/**
 * assemblePrompt — ## Skills / rules slot (L02). Skills are the team-rule blocks
 * an agent links; they are TRUSTED (vetted) content, so — unlike the diff/PR body
 * — they are NOT delimiter-wrapped. Pins rendering, ordering (before the diff),
 * join, omit-when-empty, and the assembly record.
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';

function assemble(parts: Parameters<typeof assemblePrompt>[0]) {
  const { messages, assembly } = assemblePrompt(parts);
  return { user: messages[1]!.content, assembly };
}

describe('assemblePrompt — ## Skills / rules', () => {
  it('renders ordered skill blocks before the diff, joined by a blank line', () => {
    const { user, assembly } = assemble({
      system: 'sys',
      diff: 'DIFF',
      skills: ['# Rule A\nfirst', '# Rule B\nsecond'],
    });
    expect(user).toContain('## Skills / rules');
    expect(user).toContain('# Rule A\nfirst');
    expect(user).toContain('# Rule B\nsecond');
    // order preserved + joined with a blank line
    expect(user.indexOf('# Rule A')).toBeLessThan(user.indexOf('# Rule B'));
    expect(user).toContain('first\n\n# Rule B');
    // skills come before the diff
    expect(user.indexOf('## Skills / rules')).toBeLessThan(user.indexOf('## Diff to review'));
    // assembly record carries the joined block for the trace
    expect(assembly.skills).toBe('# Rule A\nfirst\n\n# Rule B\nsecond');
  });

  it('does NOT delimiter-wrap skills (trusted content, unlike the diff)', () => {
    const { user } = assemble({ system: 'sys', diff: 'DIFF', skills: ['plain rule body'] });
    // the skills section text must not be fenced as untrusted data
    const section = user.slice(user.indexOf('## Skills / rules'), user.indexOf('## Diff to review'));
    expect(section).not.toContain('<untrusted');
    expect(section).toContain('plain rule body');
  });

  it('omits the section when skills is undefined or empty (no behaviour change)', () => {
    expect(assemble({ system: 'sys', diff: 'DIFF' }).user).not.toContain('## Skills / rules');
    expect(assemble({ system: 'sys', diff: 'DIFF' }).assembly.skills ?? null).toBeNull();
    expect(assemble({ system: 'sys', diff: 'DIFF', skills: [] }).user).not.toContain(
      '## Skills / rules',
    );
    expect(assemble({ system: 'sys', diff: 'DIFF', skills: [] }).assembly.skills ?? null).toBeNull();
  });
});
