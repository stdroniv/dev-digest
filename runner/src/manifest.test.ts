import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest, ManifestError } from './manifest.js';

describe('loadManifest', () => {
  it('parses and validates a well-formed manifest (AC-13)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'devdigest-manifest-'));
    const path = join(dir, 'agent.yaml');
    writeFileSync(
      path,
      [
        'name: Test Agent',
        'slug: test-agent',
        'model: deepseek/deepseek-v4-flash',
        'system_prompt: "Review carefully."',
        'skills: [security-review]',
        'ci_fail_on: warning',
        'workflow_version: 3',
        '',
      ].join('\n'),
      'utf8',
    );
    const manifest = loadManifest(path);
    expect(manifest.name).toBe('Test Agent');
    expect(manifest.slug).toBe('test-agent');
    expect(manifest.provider).toBe('openrouter'); // schema default
    expect(manifest.strategy).toBe('auto'); // schema default
    expect(manifest.skills).toEqual(['security-review']);
    expect(manifest.ci_fail_on).toBe('warning');
    expect(manifest.workflow_version).toBe(3);
  });

  it('normalizes a null `skills:` key to an empty array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'devdigest-manifest-'));
    const path = join(dir, 'agent.yaml');
    writeFileSync(
      path,
      ['name: Test Agent', 'slug: test-agent', 'model: x', 'system_prompt: "x"', 'skills:', ''].join('\n'),
      'utf8',
    );
    expect(loadManifest(path).skills).toEqual([]);
  });

  it('refuses (throws ManifestError) on a schema-invalid manifest (AC-14) — missing required fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'devdigest-manifest-'));
    const path = join(dir, 'agent.yaml');
    writeFileSync(path, 'name: Missing everything else\n', 'utf8');
    expect(() => loadManifest(path)).toThrow(ManifestError);
  });

  it('refuses (throws ManifestError) on a missing file', () => {
    expect(() => loadManifest('/nonexistent/path/agent.yaml')).toThrow(ManifestError);
  });
});
