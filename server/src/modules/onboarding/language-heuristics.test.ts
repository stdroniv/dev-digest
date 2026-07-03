/**
 * language-heuristics — hermetic unit tests for the README symlink-escape fix.
 *
 * `findReadme` (via `safeReadFile`) is reached from `grounding.ts`
 * `assembleFallbackGrounding` for non-indexed repos (AC-32), and its return
 * value is embedded verbatim as `grounding.readme` in the LLM prompt. Because
 * the imported repo is untrusted, it can commit `README.md` as a REAL OS
 * symlink pointing outside the clone — a string-prefix containment check on
 * `resolve()` alone does NOT catch this (`resolve()` normalizes the path
 * string but never follows symlinks), so this suite proves the `realpath`
 * re-validation closes that gap without breaking the normal, non-symlink case.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findReadme } from './language-heuristics.js';

describe('findReadme — symlink escape guard', () => {
  const tmpDirs: string[] = [];
  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it('reads a normal, in-clone README.md', async () => {
    const clonePath = await mkdtemp(join(tmpdir(), 'onboarding-readme-'));
    tmpDirs.push(clonePath);
    await writeFile(join(clonePath, 'README.md'), '# Legit\nIn-clone content.', 'utf8');

    const content = await findReadme(clonePath);

    expect(content).toContain('In-clone content');
  });

  it('does NOT read a README.md that is a real OS symlink pointing outside the clone', async () => {
    const clonePath = await mkdtemp(join(tmpdir(), 'onboarding-readme-clone-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'onboarding-readme-outside-'));
    tmpDirs.push(clonePath, outsideDir);

    const secretPath = join(outsideDir, 'secret.txt');
    await writeFile(secretPath, 'TOP SECRET — must never reach the LLM prompt', 'utf8');
    await symlink(secretPath, join(clonePath, 'README.md'));

    const content = await findReadme(clonePath);

    expect(content).toBeNull();
  });

  it('degrades gracefully (no throw) when a symlinked README.md is a dangling/self-referential link', async () => {
    const clonePath = await mkdtemp(join(tmpdir(), 'onboarding-readme-dangling-'));
    tmpDirs.push(clonePath);
    await symlink(join(clonePath, 'does-not-exist.txt'), join(clonePath, 'README.md'));

    await expect(findReadme(clonePath)).resolves.toBeNull();
  });
});
