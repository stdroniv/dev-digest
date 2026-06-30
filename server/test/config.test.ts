import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../src/platform/config.js';

describe('loadConfig — cloneDir resolution', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    // Restore cwd in case a test changed it.
    process.chdir(originalCwd);
  });

  it('returns an absolute path ending with server/clones by default', () => {
    const { cloneDir } = loadConfig({});
    expect(path.isAbsolute(cloneDir)).toBe(true);
    expect(cloneDir).toMatch(/[/\\]server[/\\]clones$/);
  });

  it('resolves a relative DEVDIGEST_CLONE_DIR against the server package dir', () => {
    const { cloneDir } = loadConfig({ DEVDIGEST_CLONE_DIR: 'foo' });
    expect(path.isAbsolute(cloneDir)).toBe(true);
    expect(cloneDir).toMatch(/[/\\]server[/\\]foo$/);
  });

  it('returns an absolute DEVDIGEST_CLONE_DIR verbatim', () => {
    const abs = '/custom/absolute/path';
    const { cloneDir } = loadConfig({ DEVDIGEST_CLONE_DIR: abs });
    expect(cloneDir).toBe(abs);
  });

  it('resolves to the same path regardless of process.cwd()', () => {
    const before = loadConfig({}).cloneDir;
    try {
      process.chdir(os.tmpdir());
      const after = loadConfig({}).cloneDir;
      expect(after).toBe(before);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
