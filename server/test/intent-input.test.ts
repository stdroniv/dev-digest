/**
 * intent-input.ts — hermetic unit tests.
 *
 * Acceptance (plan C1): given a sample patch, only path + hunk-header lines remain.
 */
import { describe, it, expect } from 'vitest';
import { buildHunkHeadersBlock, buildFullPatchText, buildSpecDocsBlock, isDocFile } from '../src/modules/reviews/intent-input.js';

const FILES = [
  {
    path: 'src/middleware/rate-limit.ts',
    additions: 42,
    deletions: 0,
    patch:
      '@@ -0,0 +1,42 @@\n' +
      "+import Redis from 'ioredis';\n" +
      '+const redis = new Redis();\n' +
      '+\n' +
      '+export function rateLimit() {\n' +
      '+  return async (req: Request) => {\n' +
      '+    const key = req.ip;\n' +
      '+    const count = await redis.incr(key);\n' +
      '+    if (count > 100) throw new Error("rate limited");\n' +
      '+  };\n' +
      '+}\n',
  },
  {
    path: 'src/app.ts',
    additions: 3,
    deletions: 1,
    patch:
      '@@ -3,6 +3,7 @@\n' +
      ' import express from "express";\n' +
      '-import { oldMiddleware } from "./old";\n' +
      '+import { rateLimit } from "./middleware/rate-limit";\n' +
      ' \n' +
      '@@ -15,7 +16,9 @@\n' +
      ' app.use(express.json());\n' +
      '+app.use(rateLimit());\n',
  },
  {
    path: 'src/no-patch.ts',
    additions: 0,
    deletions: 0,
    patch: undefined,
  },
  {
    path: 'docs/plans/rate-limit.md',
    additions: 5,
    deletions: 1,
    patch:
      '@@ -1,4 +1,8 @@\n' +
      ' # Rate limit plan\n' +
      '-Old intro line.\n' +
      '+Updated intro line.\n' +
      '+\n' +
      '+## Goal\n' +
      '+Add Redis-backed rate limiting to all public API routes.\n' +
      '+Out of scope: auth changes.',
  },
];

describe('buildHunkHeadersBlock', () => {
  it('contains file paths and hunk headers', () => {
    const block = buildHunkHeadersBlock(FILES);
    expect(block).toContain('src/middleware/rate-limit.ts');
    expect(block).toContain('@@ -0,0 +1,42 @@');
    expect(block).toContain('src/app.ts');
    expect(block).toContain('@@ -3,6 +3,7 @@');
    expect(block).toContain('@@ -15,7 +16,9 @@');
  });

  it('omits added/removed code lines (lines starting with + or -)', () => {
    const block = buildHunkHeadersBlock(FILES);
    expect(block).not.toContain("import Redis from 'ioredis'");
    expect(block).not.toContain('import express from "express"');
    expect(block).not.toContain('app.use(express.json())');
    // No line should start with + or - (only @@ lines and paths allowed)
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      expect(trimmed).not.toMatch(/^[+-]/);
    }
  });

  it('omits files with no patch', () => {
    const block = buildHunkHeadersBlock(FILES);
    expect(block).not.toContain('src/no-patch.ts');
  });

  it('omits files with patch but no hunk headers', () => {
    const noHunkFiles = [{ path: 'src/binary.bin', additions: 1, deletions: 0, patch: 'Binary file' }];
    const block = buildHunkHeadersBlock(noHunkFiles);
    expect(block).toBe('');
  });

  it('omits markdown doc files (those go to buildSpecDocsBlock instead)', () => {
    const block = buildHunkHeadersBlock(FILES);
    expect(block).not.toContain('docs/plans/rate-limit.md');
    expect(block).not.toContain('Rate limit plan');
  });
});

describe('isDocFile', () => {
  it('matches .md, .mdx, .markdown', () => {
    expect(isDocFile('docs/plans/foo.md')).toBe(true);
    expect(isDocFile('README.mdx')).toBe(true);
    expect(isDocFile('CHANGELOG.markdown')).toBe(true);
  });

  it('does not match code or other files', () => {
    expect(isDocFile('src/foo.ts')).toBe(false);
    expect(isDocFile('docs/image.png')).toBe(false);
    expect(isDocFile('notes.txt')).toBe(false);
  });
});

describe('buildSpecDocsBlock', () => {
  it('includes path and reconstructed prose for markdown files', () => {
    const block = buildSpecDocsBlock(FILES);
    expect(block).toContain('docs/plans/rate-limit.md');
    expect(block).toContain('Rate limit plan');
    expect(block).toContain('Add Redis-backed rate limiting');
    expect(block).toContain('Out of scope: auth changes');
  });

  it('includes updated and context lines, excludes removed lines', () => {
    const block = buildSpecDocsBlock(FILES);
    expect(block).toContain('Updated intro line.');
    expect(block).not.toContain('Old intro line.');
  });

  it('excludes hunk headers from the prose', () => {
    const block = buildSpecDocsBlock(FILES);
    expect(block).not.toContain('@@ -1,4 +1,8 @@');
  });

  it('excludes non-doc files', () => {
    const block = buildSpecDocsBlock(FILES);
    expect(block).not.toContain('src/middleware/rate-limit.ts');
    expect(block).not.toContain('src/app.ts');
  });

  it('returns empty string when no doc files are present', () => {
    const nonDocFiles = FILES.filter((f) => !isDocFile(f.path));
    expect(buildSpecDocsBlock(nonDocFiles)).toBe('');
  });
});

describe('buildFullPatchText', () => {
  it('returns concatenated patches for all files with a patch', () => {
    const full = buildFullPatchText(FILES);
    expect(full).toContain('src/middleware/rate-limit.ts');
    expect(full).toContain("import Redis from 'ioredis'");
    expect(full).toContain('src/app.ts');
    expect(full).not.toContain('src/no-patch.ts');
  });
});
