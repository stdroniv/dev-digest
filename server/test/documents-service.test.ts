/**
 * T5 — `DocumentsService` (DB-less). Injects a fake `tokenizer` via
 * `ContainerOverrides` and a real temp-dir clone (fake "git" path) — no DB,
 * no testcontainers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentsService } from '../src/modules/documents/service.js';
import type { Container } from '../src/platform/container.js';

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (dir && dir !== root) await mkdir(dir, { recursive: true });
  await writeFile(full, contents);
}

/** Fake container: only `tokenizer` is exercised by the paths under test. */
function makeContainer(): Container {
  return {
    tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
  } as unknown as Container;
}

describe('DocumentsService.readContent', () => {
  let clonePath: string;

  beforeEach(async () => {
    clonePath = await mkdtemp(join(tmpdir(), 'documents-service-'));
  });
  afterEach(async () => {
    await rm(clonePath, { recursive: true, force: true });
  });

  it('returns null for a missing path', async () => {
    const service = new DocumentsService(makeContainer());
    const result = await service.readContent(
      { id: 'repo1', workspaceId: 'ws1', clonePath },
      'specs/does-not-exist.md',
    );
    expect(result).toBeNull();
  });

  it('returns null when the repo has no clone path', async () => {
    const service = new DocumentsService(makeContainer());
    const result = await service.readContent(
      { id: 'repo1', workspaceId: 'ws1', clonePath: null },
      'specs/anything.md',
    );
    expect(result).toBeNull();
  });

  it('returns fresh file content for an existing path', async () => {
    await writeFileAt(clonePath, 'specs/SPEC-01.md', '# hello');
    const service = new DocumentsService(makeContainer());
    const result = await service.readContent(
      { id: 'repo1', workspaceId: 'ws1', clonePath },
      'specs/SPEC-01.md',
    );
    expect(result).toBe('# hello');
  });

  it('returns null (never file contents) for a path that resolves outside clonePath, even if it bypasses route-level validation', async () => {
    // Defense-in-depth: this proves the guard lives INSIDE the service too,
    // not only at the route layer — e.g. a pre-existing persisted row from
    // before the route-level fix must still be safely refused here.
    const outsideDir = await mkdtemp(join(tmpdir(), 'documents-service-outside-'));
    try {
      await writeFile(join(outsideDir, 'secret.md'), 'TOP SECRET');
      const service = new DocumentsService(makeContainer());

      // Compute a `..`-based relative path from clonePath to the sibling
      // outside directory's secret file, exactly as a traversal payload would.
      const traversal = `../${outsideDir.slice(clonePath.lastIndexOf('/') + 1)}/secret.md`;
      const result = await service.readContent(
        { id: 'repo1', workspaceId: 'ws1', clonePath },
        traversal,
      );
      expect(result).toBeNull();
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('returns null for an absolute path passed directly to readContent (bypassing route validation)', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'documents-service-abs-'));
    try {
      const absPath = join(outsideDir, 'secret.md');
      await writeFile(absPath, 'TOP SECRET');
      const service = new DocumentsService(makeContainer());
      const result = await service.readContent(
        { id: 'repo1', workspaceId: 'ws1', clonePath },
        absPath,
      );
      expect(result).toBeNull();
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('DocumentsService.preview', () => {
  let clonePath: string;

  beforeEach(async () => {
    clonePath = await mkdtemp(join(tmpdir(), 'documents-service-preview-'));
  });
  afterEach(async () => {
    await rm(clonePath, { recursive: true, force: true });
  });

  it('mirrors readContent (null for a missing path, content otherwise)', async () => {
    await writeFileAt(clonePath, 'docs/README.md', '# readme');
    const service = new DocumentsService(makeContainer());
    const repo = { id: 'repo1', workspaceId: 'ws1', clonePath };

    expect(await service.preview(repo, 'docs/missing.md')).toBeNull();
    expect(await service.preview(repo, 'docs/README.md')).toBe('# readme');
  });
});

describe('DocumentsService.discover', () => {
  it('signals "not cloned" distinctly when the repo has no clone path', async () => {
    const service = new DocumentsService(makeContainer());
    const result = await service.discover({ id: 'repo1', workspaceId: 'ws1', clonePath: null });
    expect(result).toEqual({ cloned: false });
  });

  it('signals "not cloned" distinctly when the clone directory is absent on disk', async () => {
    const service = new DocumentsService(makeContainer());
    const result = await service.discover({
      id: 'repo1',
      workspaceId: 'ws1',
      clonePath: '/tmp/does-not-exist-devdigest-fixture',
    });
    expect(result).toEqual({ cloned: false });
  });
});
