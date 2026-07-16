import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  assembleBundle,
  type BundleAgent,
  InvalidManifestError,
  UnresolvedSkillError,
} from './bundle.js';
import { DEFAULT_RUNNER_DIST_PATH } from './constants.js';

const AGENT: BundleAgent = {
  name: 'Security Reviewer',
  provider: 'openrouter',
  model: 'anthropic/claude-3.5-sonnet',
  system_prompt: 'You are a security-focused reviewer.',
  strategy: 'auto',
  ci_fail_on: 'critical',
};

// Deterministic, hermetic fixture standing in for the T2-committed
// runner/dist/runner.mjs — most tests override `runnerDistPath` so they don't
// depend on that build artifact's real (large, changing) content.
const tmpDir = mkdtempSync(join(tmpdir(), 'devdigest-ci-bundle-'));
const fixtureRunnerPath = join(tmpDir, 'runner.mjs');
writeFileSync(fixtureRunnerPath, '// fixture runner build\nconsole.log("devdigest runner");\n');

afterAll(() => {
  // Best-effort cleanup; not load-bearing for the test outcome.
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('assembleBundle — file set (AC-2/5)', () => {
  it('produces exactly the committed file set in order, incl. the empty memory.jsonl and the runner', () => {
    const bundle = assembleBundle(AGENT, {
      linkedSkills: [{ name: 'API Security', body: '# API security checklist\n', enabled: true }],
      runnerDistPath: fixtureRunnerPath,
    });

    expect(bundle.slug).toBe('security-reviewer');
    expect(bundle.files.map((f) => f.path)).toEqual([
      '.devdigest/agents/security-reviewer.yaml',
      '.devdigest/skills/api-security.md',
      '.devdigest/memory.jsonl',
      '.devdigest/runner.mjs',
      '.github/workflows/devdigest-review-security-reviewer.yml',
    ]);

    const memory = bundle.files.find((f) => f.path === '.devdigest/memory.jsonl');
    expect(memory?.contents).toBe(''); // AC-5

    const runner = bundle.files.find((f) => f.path === '.devdigest/runner.mjs');
    expect(runner?.contents).toContain('devdigest runner');

    const skill = bundle.files.find((f) => f.path === '.devdigest/skills/api-security.md');
    expect(skill?.contents).toBe('# API security checklist\n');

    for (const file of bundle.files) expect(file.editable).toBe(true);
  });

  it('produces the file set with zero linked skills', () => {
    const bundle = assembleBundle(AGENT, { runnerDistPath: fixtureRunnerPath });
    expect(bundle.files.map((f) => f.path)).toEqual([
      '.devdigest/agents/security-reviewer.yaml',
      '.devdigest/memory.jsonl',
      '.devdigest/runner.mjs',
      '.github/workflows/devdigest-review-security-reviewer.yml',
    ]);
  });

  it('the manifest lists exactly the bundled skill slugs, so the runner can resolve them', () => {
    const bundle = assembleBundle(AGENT, {
      linkedSkills: [
        { name: 'API Security', body: '# a\n', enabled: true },
        { name: 'Injection Checklist', body: '# b\n', enabled: true },
      ],
      runnerDistPath: fixtureRunnerPath,
    });
    const manifestFile = bundle.files[0]!;
    const manifest = parseYaml(manifestFile.contents) as { skills: string[] };
    const skillFilePaths = bundle.files
      .filter((f) => f.path.startsWith('.devdigest/skills/'))
      .map((f) => f.path.replace('.devdigest/skills/', '').replace('.md', ''));
    expect(manifest.skills).toEqual(skillFilePaths);
  });
});

describe('assembleBundle — unresolved skill (AC-12)', () => {
  it('throws a named error and produces no bundle when a linked skill is disabled/unresolved', () => {
    let caught: unknown;
    try {
      assembleBundle(AGENT, {
        linkedSkills: [
          { name: 'API Security', body: '# a\n', enabled: true },
          { name: 'Draft Rubric', body: '# b\n', enabled: false },
        ],
        runnerDistPath: fixtureRunnerPath,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnresolvedSkillError);
    expect((caught as UnresolvedSkillError).skillName).toBe('Draft Rubric');
    expect((caught as Error).message).toContain('Draft Rubric');
  });
});

describe('assembleBundle — invalid manifest (AC-14)', () => {
  it('aborts (throws InvalidManifestError) rather than commit an invalid manifest', () => {
    const invalidAgent: BundleAgent = { ...AGENT, model: '' }; // AgentManifest.model = z.string().min(1)
    expect(() => assembleBundle(invalidAgent, { runnerDistPath: fixtureRunnerPath })).toThrow(
      InvalidManifestError,
    );
  });
});

describe('assembleBundle — slug collisions (AC-15/16)', () => {
  it('two agents with colliding names get distinct slugs and distinct manifest/workflow filenames', () => {
    const first = assembleBundle(AGENT, { runnerDistPath: fixtureRunnerPath });
    const second = assembleBundle(
      { ...AGENT, name: 'security reviewer' }, // slugifies identically to AGENT.name
      { existingSlugs: [first.slug], runnerDistPath: fixtureRunnerPath },
    );

    expect(first.slug).not.toBe(second.slug);
    expect(second.slug).toBe('security-reviewer-2');

    // AC-16 — the slug-keyed manifest and workflow never collide (the shared
    // .devdigest/runner.mjs and .devdigest/memory.jsonl paths are IDENTICAL
    // by design across installations to the same repo — deterministic,
    // content-identical files, not a per-agent namespace).
    const manifestPath = (b: typeof first) => b.files.find((f) => f.path.startsWith('.devdigest/agents/'))!.path;
    const workflowPath = (b: typeof first) => b.files.find((f) => f.path.startsWith('.github/workflows/'))!.path;
    expect(manifestPath(first)).not.toBe(manifestPath(second));
    expect(workflowPath(first)).not.toBe(workflowPath(second));
  });
});

describe('assembleBundle — no secret ever embedded (AC-26)', () => {
  it('no file in the bundle contains a literal secret value', () => {
    const bundle = assembleBundle(AGENT, {
      linkedSkills: [{ name: 'API Security', body: '# a\n', enabled: true }],
      runnerDistPath: fixtureRunnerPath,
    });
    for (const file of bundle.files) {
      expect(file.contents).not.toMatch(/OPENROUTER_API_KEY\s*[:=]\s*['"]?sk-/i);
      expect(file.contents).not.toMatch(/GITHUB_TOKEN\s*[:=]\s*['"]?gh[a-z]_/i);
    }
    const workflow = bundle.files.find((f) => f.path.startsWith('.github/workflows/'))!;
    expect(workflow.contents).toContain('${{ secrets.OPENROUTER_API_KEY }}');
    expect(workflow.contents).toContain('${{ github.token }}');
  });
});

describe('assembleBundle — the real committed T2 runner artifact', () => {
  it('reads runner/dist/runner.mjs from disk by default (AC-4; runtime prerequisite: T2)', () => {
    const bundle = assembleBundle(AGENT, {}); // no override — exercises DEFAULT_RUNNER_DIST_PATH
    const runner = bundle.files.find((f) => f.path === '.devdigest/runner.mjs');
    expect(runner).toBeDefined();
    expect(runner!.contents.length).toBeGreaterThan(0);
    expect(DEFAULT_RUNNER_DIST_PATH).toMatch(/runner\/dist\/runner\.mjs$/);
  });
});
