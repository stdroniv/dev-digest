import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { CiFile } from '@devdigest/shared';
import { zipFiles } from './zip.js';

const FILES: CiFile[] = [
  { path: '.devdigest/agents/security-reviewer.yaml', contents: 'name: Security Reviewer\n', editable: true },
  { path: '.devdigest/skills/api-security.md', contents: '# API security\n', editable: true },
  { path: '.devdigest/memory.jsonl', contents: '', editable: true },
  { path: '.devdigest/runner.mjs', contents: 'console.log("runner");\n', editable: true },
  {
    path: '.github/workflows/devdigest-review-security-reviewer.yml',
    contents: 'name: DevDigest Review\n',
    editable: true,
  },
];

describe('zipFiles', () => {
  it('produces a zip containing the identical file set (AC-10)', () => {
    const zipped = zipFiles(FILES);
    const entries = unzipSync(zipped);

    expect(Object.keys(entries).sort()).toEqual(FILES.map((f) => f.path).sort());
    for (const file of FILES) {
      expect(strFromU8(entries[file.path]!)).toBe(file.contents);
    }
  });

  it('round-trips an empty file (memory.jsonl, AC-5) with zero bytes', () => {
    const zipped = zipFiles(FILES);
    const entries = unzipSync(zipped);
    expect(strFromU8(entries['.devdigest/memory.jsonl']!)).toBe('');
  });
});
