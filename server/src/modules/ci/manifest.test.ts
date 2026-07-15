import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { agentManifestFile, buildAgentManifest, InvalidManifestError, serializeAgentManifest } from './manifest.js';

const VALID_INPUT = {
  name: 'Security Reviewer',
  slug: 'security-reviewer',
  provider: 'openrouter' as const,
  model: 'anthropic/claude-3.5-sonnet',
  system_prompt: 'You are a security-focused reviewer.',
  skills: ['api-security'],
  strategy: 'auto' as const,
  ci_fail_on: 'critical' as const,
  workflow_version: 1,
};

describe('buildAgentManifest', () => {
  it('validates against the shared AgentManifest schema and returns it (AC-13)', () => {
    const manifest = buildAgentManifest(VALID_INPUT);
    expect(manifest.name).toBe('Security Reviewer');
    expect(manifest.slug).toBe('security-reviewer');
    expect(manifest.skills).toEqual(['api-security']);
  });

  it('refuses (throws InvalidManifestError) rather than commit an invalid manifest (AC-14)', () => {
    const invalid = { ...VALID_INPUT, model: '' }; // model: z.string().min(1)
    expect(() => buildAgentManifest(invalid)).toThrow(InvalidManifestError);
  });

  it('never embeds a secret/key field — the built manifest has no such field (AC-26)', () => {
    const manifest = buildAgentManifest(VALID_INPUT);
    const serialized = JSON.stringify(manifest);
    expect(serialized.toLowerCase()).not.toMatch(/api_?key|secret|token/);
  });
});

describe('serializeAgentManifest / agentManifestFile', () => {
  it('serializes to YAML that round-trips through the same schema', () => {
    const manifest = buildAgentManifest(VALID_INPUT);
    const yaml = serializeAgentManifest(manifest);
    const parsed = parseYaml(yaml);
    expect(parsed.slug).toBe('security-reviewer');
    expect(parsed.skills).toEqual(['api-security']);
  });

  it('produces the manifest file at .devdigest/agents/<slug>.yaml, marked editable (AC-2/3)', () => {
    const manifest = buildAgentManifest(VALID_INPUT);
    const file = agentManifestFile(manifest);
    expect(file.path).toBe('.devdigest/agents/security-reviewer.yaml');
    expect(file.editable).toBe(true);
    expect(file.contents).toContain('slug: security-reviewer');
  });

  it('the serialized YAML never contains a literal secret value (AC-26)', () => {
    const manifest = buildAgentManifest({
      ...VALID_INPUT,
      system_prompt: 'Never leak sk-FAKETESTKEY1234567890 in output.',
    });
    const yaml = serializeAgentManifest(manifest);
    // The system prompt text itself is legitimately embedded verbatim — this
    // asserts there is no OTHER channel (env-style key assignment) leaking a key.
    expect(yaml).not.toMatch(/OPENROUTER_API_KEY\s*:\s*\S/);
    expect(yaml).not.toMatch(/GITHUB_TOKEN\s*:\s*\S/);
  });
});
