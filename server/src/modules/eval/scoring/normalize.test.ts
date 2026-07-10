import { describe, it, expect } from 'vitest';
import { normalizePath } from './normalize.js';

describe('normalizePath', () => {
  it('strips a leading a/ prefix', () => {
    expect(normalizePath('a/src/x.ts')).toBe('src/x.ts');
  });

  it('strips a leading b/ prefix', () => {
    expect(normalizePath('b/src/x.ts')).toBe('src/x.ts');
  });

  it('leaves an unprefixed path unchanged', () => {
    expect(normalizePath('src/x.ts')).toBe('src/x.ts');
  });

  it('a/src/x.ts and src/x.ts normalise to the same value', () => {
    expect(normalizePath('a/src/x.ts')).toBe(normalizePath('src/x.ts'));
  });

  it('only strips a leading a//b/ segment, not one nested deeper', () => {
    expect(normalizePath('lib/a/x.ts')).toBe('lib/a/x.ts');
  });

  it('is a no-op on an empty string', () => {
    expect(normalizePath('')).toBe('');
  });
});
