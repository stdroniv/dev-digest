/**
 * T5 — pure Markdown-discovery walk (`documents/helpers.ts`).
 *
 * Hermetic: no DB, no container. Builds a temp fixture tree on disk and
 * asserts recursive `.md` collection under multiple roots at varying depth,
 * correct per-root origin tagging, POSIX-normalised repo-relative paths, and
 * exclusion of non-`.md` files.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectMarkdownFiles } from '../src/modules/documents/helpers.js';

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (dir && dir !== root) await mkdir(dir, { recursive: true });
  await writeFile(full, contents);
}

describe('collectMarkdownFiles', () => {
  let clonePath: string;

  beforeEach(async () => {
    clonePath = await mkdtemp(join(tmpdir(), 'documents-discovery-'));
  });
  afterEach(async () => {
    await rm(clonePath, { recursive: true, force: true });
  });

  it('recursively collects .md files at any depth under multiple roots', async () => {
    await writeFileAt(clonePath, 'specs/SPEC-01.md', '# spec');
    await writeFileAt(clonePath, 'specs/nested/deep/child.md', '# nested');
    await writeFileAt(clonePath, 'docs/README.md', '# docs');
    await writeFileAt(clonePath, 'docs/guides/getting-started.md', '# guide');

    const found = await collectMarkdownFiles(clonePath, ['specs', 'docs']);
    const paths = found.map((f) => f.path).sort();

    expect(paths).toEqual([
      'docs/README.md',
      'docs/guides/getting-started.md',
      'specs/SPEC-01.md',
      'specs/nested/deep/child.md',
    ]);
  });

  it('tags each discovered file with its originating root', async () => {
    await writeFileAt(clonePath, 'specs/a.md', '# a');
    await writeFileAt(clonePath, 'docs/b.md', '# b');

    const found = await collectMarkdownFiles(clonePath, ['specs', 'docs']);
    const byPath = new Map(found.map((f) => [f.path, f.root]));

    expect(byPath.get('specs/a.md')).toBe('specs');
    expect(byPath.get('docs/b.md')).toBe('docs');
  });

  it('excludes non-.md files', async () => {
    await writeFileAt(clonePath, 'specs/notes.md', '# keep');
    await writeFileAt(clonePath, 'specs/data.json', '{}');
    await writeFileAt(clonePath, 'specs/script.ts', 'export {}');
    await writeFileAt(clonePath, 'specs/notes.mdx', '# not plain md');

    const found = await collectMarkdownFiles(clonePath, ['specs']);

    expect(found.map((f) => f.path)).toEqual(['specs/notes.md']);
  });

  it('silently skips a configured root that does not exist under the clone', async () => {
    await writeFileAt(clonePath, 'docs/present.md', '# present');

    const found = await collectMarkdownFiles(clonePath, ['docs', 'insights']);

    expect(found.map((f) => f.path)).toEqual(['docs/present.md']);
  });

  it('normalises paths to POSIX forward slashes', async () => {
    await writeFileAt(clonePath, 'specs/nested/child.md', '# nested');

    const found = await collectMarkdownFiles(clonePath, ['specs']);

    expect(found[0]?.path).toBe('specs/nested/child.md');
    expect(found[0]?.path).not.toContain('\\');
  });
});
