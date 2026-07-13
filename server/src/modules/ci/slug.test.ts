import { describe, expect, it } from 'vitest';
import { SlugAllocator, slugify } from './slug.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Security Reviewer')).toBe('security-reviewer');
  });

  it('strips punctuation and collapses repeated separators', () => {
    expect(slugify('API / Security  Reviewer!!')).toBe('api-security-reviewer');
  });

  it('falls back to a default when nothing alphanumeric survives', () => {
    expect(slugify('!!!')).toBe('agent');
    expect(slugify('')).toBe('agent');
  });
});

describe('SlugAllocator', () => {
  it('returns the plain slug when there is no collision', () => {
    const allocator = new SlugAllocator();
    expect(allocator.allocate('Security Reviewer')).toBe('security-reviewer');
  });

  it('disambiguates two different names that slugify identically (AC-15)', () => {
    const allocator = new SlugAllocator();
    const first = allocator.allocate('Security Reviewer');
    const second = allocator.allocate('security reviewer'); // same slug, different name
    expect(first).toBe('security-reviewer');
    expect(second).toBe('security-reviewer-2');
    expect(first).not.toBe(second);
  });

  it('keeps disambiguating on a third collision', () => {
    const allocator = new SlugAllocator();
    expect(allocator.allocate('Foo')).toBe('foo');
    expect(allocator.allocate('Foo!')).toBe('foo-2');
    expect(allocator.allocate('  foo  ')).toBe('foo-3');
  });

  it('seeds from existingSlugs so a name colliding with a PRIOR export is disambiguated', () => {
    const allocator = new SlugAllocator(['security-reviewer']);
    expect(allocator.allocate('Security Reviewer')).toBe('security-reviewer-2');
  });

  it('reuses the same slug across separate allocator instances when existingSlugs excludes it (idempotent re-export, AC-17)', () => {
    // Simulates: this agent's OWN slug is excluded from `existingSlugs` on
    // re-export, so recomputing from the same name reproduces the same slug.
    const firstExport = new SlugAllocator([]);
    const slugA = firstExport.allocate('Security Reviewer');

    const reExport = new SlugAllocator([]); // still excludes "Security Reviewer"'s own slug
    const slugB = reExport.allocate('Security Reviewer');

    expect(slugA).toBe(slugB);
    expect(slugA).toBe('security-reviewer');
  });
});
