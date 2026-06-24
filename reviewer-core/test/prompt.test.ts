/**
 * assemblePrompt — PR description slot (the fix that was missing: the PR body
 * never reached the prompt). Pins rendering, omit-when-empty, untrusted-wrap,
 * truncation, and ordering (before the diff).
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  const { messages } = assemblePrompt(parts);
  return messages[1]!.content;
}

function systemOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[0]!.content;
}

describe('assemblePrompt — shared injection guard (server + CI)', () => {
  const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF' });

  it('appends the guard to the agent system prompt', () => {
    expect(sys.startsWith('AGENT-SYS')).toBe(true);
    expect(sys).toMatch(/<untrusted>.*DATA to be analyzed/s);
  });

  it('forbids "intentional/test/demo" claims from descoping the review', () => {
    // The defense that replaced the keyword sanitizer: a general, trusted,
    // language-agnostic rule — not text parsing of untrusted input.
    expect(sys).toMatch(/test fixture|intentional|demo/i);
    expect(sys).toMatch(/never reduce|never .*descope|REPORT it/i);
    expect(sys).toMatch(/any language/i);
  });
});

describe('assemblePrompt — ## PR description', () => {
  it('renders the section (untrusted-wrapped) before the diff when present', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR description');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('Adds rate limiting to the public /api endpoints.');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Diff to review'));
    expect(assembly.pr_description).toContain('Adds rate limiting');
  });

  it('omits the section when prDescription is undefined or blank (no behaviour change)', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR description');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.pr_description ?? null).toBeNull();
    expect(userOf({ system: 'sys', diff: 'DIFF', prDescription: '   ' })).not.toContain(
      '## PR description',
    );
  });

  it('truncates a huge body to the 4k cap', () => {
    const { assembly } = assemblePrompt({
      system: 'sys',
      diff: 'D',
      prDescription: 'x'.repeat(10_000),
    });
    expect((assembly.pr_description as string).length).toBe(4000);
  });
});

describe('assemblePrompt — ## PR Intent', () => {
  const INTENT_TEXT =
    'Summary: Add rate limiting.\n\nIn scope:\n• /api routes\n\nOut of scope:\n• Auth changes';

  it('renders the section with the rule and untrusted wrapper when prIntent is set', () => {
    const user = userOf({ system: 'sys', diff: 'DIFF', prIntent: INTENT_TEXT });

    expect(user).toContain('## PR Intent');
    // Trusted scope-discipline rule (must be OUTSIDE the untrusted block).
    // The rule must NOT allow scope to silence real defects — align with INJECTION_GUARD.
    expect(user).toContain('frame finding rationale');
    expect(user).toMatch(/can never\s+reduce the count or severity of real defects/i);
    expect(user).toContain('report it regardless of stated scope');
    // Intent content must be inside an untrusted wrapper
    expect(user).toContain('<untrusted source="pr-intent">');
    expect(user).toContain('Summary: Add rate limiting.');
    expect(user).toContain('</untrusted>');
  });

  it('places the PR Intent section before the diff', () => {
    const user = userOf({ system: 'sys', diff: 'DIFF', prIntent: INTENT_TEXT });
    expect(user.indexOf('## PR Intent')).toBeLessThan(user.indexOf('## Diff to review'));
  });

  it('places the PR Intent section after the PR description', () => {
    const user = userOf({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Some body',
      prIntent: INTENT_TEXT,
    });
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## PR Intent'));
  });

  it('omits the section when prIntent is undefined (no behaviour change)', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR Intent');
  });

  it('omits the section when prIntent is blank', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF', prIntent: '   ' })).not.toContain('## PR Intent');
  });
});
