/**
 * pr-ref — hermetic unit tests.
 *
 * Covers parsePrRef + stripPrRef with the cases listed in the plan:
 * squash subject, merge subject, body-only ref (ignored), no ref,
 * multi-digit numbers, empty string.
 */
import { describe, it, expect } from 'vitest';
import { parsePrRef, stripPrRef } from './pr-ref.js';

describe('parsePrRef', () => {
  it('parses squash-merge subject "Add rate limiting (#482)"', () => {
    expect(parsePrRef('Add rate limiting (#482)')).toBe(482);
  });

  it('parses merge-commit subject "Merge pull request #77 from acme/feat"', () => {
    expect(parsePrRef('Merge pull request #77 from acme/feat')).toBe(77);
  });

  it('ignores a (# N) on a non-first line (body-only ref)', () => {
    expect(parsePrRef('Some title\n(#12)')).toBeNull();
  });

  it('returns null for a plain subject with no ref', () => {
    expect(parsePrRef('Fix typo in README')).toBeNull();
  });

  it('handles multi-digit numbers', () => {
    expect(parsePrRef('Refactor auth (#12345)')).toBe(12345);
  });

  it('handles single-digit numbers (no leading zeros)', () => {
    expect(parsePrRef('Fix (#3)')).toBe(3);
  });

  it('returns null for an empty string', () => {
    expect(parsePrRef('')).toBeNull();
  });

  it('does not match (#N) when it appears mid-subject', () => {
    // A ref in the middle (e.g. someone wrote "(#5) fix") is NOT a trailing ref.
    expect(parsePrRef('(#5) fix something')).toBeNull();
  });
});

describe('stripPrRef', () => {
  it('strips trailing (#N) from squash subject', () => {
    expect(stripPrRef('Add rate limiting (#482)')).toBe('Add rate limiting');
  });

  it('returns subject unchanged when no ref is present', () => {
    expect(stripPrRef('Fix typo in README')).toBe('Fix typo in README');
  });

  it('trims surrounding whitespace after strip', () => {
    expect(stripPrRef('Add feature  (#99)  ')).toBe('Add feature');
  });

  it('handles an empty string without throwing', () => {
    expect(stripPrRef('')).toBe('');
  });

  it('only removes from the first line (ignores body)', () => {
    // The body is not touched; only the subject is stripped.
    expect(stripPrRef('Subject (#7)\nsome body')).toBe('Subject');
  });
});
