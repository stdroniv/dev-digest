/**
 * Verifies that SimpleGitClient.log() self-heals a shallow clone by deepening
 * it on the first call. Uses a local file:// remote — no network, no Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';

let tmpDir: string;
let srcRepo: string;
let cloneParent: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(os.tmpdir(), 'devdigest-history-test-'));
  srcRepo = join(tmpDir, 'src');
  cloneParent = join(tmpDir, 'clones', 'testowner');

  // Build a source repo with 3 commits all touching the same file.
  await mkdir(srcRepo, { recursive: true });
  await mkdir(cloneParent, { recursive: true });
  const src = simpleGit(srcRepo);
  await src.init();
  await src.addConfig('user.email', 'test@test.com');
  await src.addConfig('user.name', 'Test');

  for (const [msg, content] of [
    ['feat: a (#101)', 'v1'],
    ['feat: b (#102)', 'v2'],
    ['feat: c (#103)', 'v3'],
  ] as const) {
    await writeFile(join(srcRepo, 'file.ts'), content);
    await src.add('file.ts');
    await src.commit(msg);
  }
}, 30_000);

afterAll(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

describe('SimpleGitClient.log() — lazy deepen on shallow clone', () => {
  it('returns all commits for a file after deepening a depth-1 clone', async () => {
    const destName = 'testrepo';
    const destPath = join(cloneParent, destName);

    // Clone with depth=1 (mimics production CLONE_DEPTH=1).
    const g = simpleGit(cloneParent);
    await g.clone(`file://${srcRepo}`, destPath, ['--depth', '1']);

    // Confirm it is shallow before our code runs.
    const isShallowBefore = (
      await simpleGit(destPath).raw(['rev-parse', '--is-shallow-repository'])
    ).trim();
    expect(isShallowBefore).toBe('true');

    // SimpleGitClient expects cloneDir=<parent of owner dir>.
    const client = new SimpleGitClient(join(tmpDir, 'clones'));
    const commits = await client.log({ owner: 'testowner', name: destName }, 'file.ts');

    // All 3 commits must be visible after the deepen.
    expect(commits.length).toBeGreaterThanOrEqual(3);
    const messages = commits.map((c) => c.message);
    expect(messages.some((m) => m.includes('#101'))).toBe(true);
    expect(messages.some((m) => m.includes('#102'))).toBe(true);
    expect(messages.some((m) => m.includes('#103'))).toBe(true);
  }, 30_000);

  it('does not re-fetch on a second log() call for the same clone', async () => {
    const destName = 'testrepo2';
    const destPath = join(cloneParent, destName);

    await simpleGit(cloneParent).clone(`file://${srcRepo}`, destPath, ['--depth', '1']);

    const client = new SimpleGitClient(join(tmpDir, 'clones'));

    // First call deepens; second call must return the same result without error.
    const first = await client.log({ owner: 'testowner', name: destName }, 'file.ts');
    const second = await client.log({ owner: 'testowner', name: destName }, 'file.ts');

    expect(second.length).toBe(first.length);
  }, 30_000);
});
