import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Severity, FindingCategory, Provider, ReviewStrategy } from '@devdigest/shared';
import * as S from '../src/schemas.js';

/**
 * Hermetic: every tool's input/output is a valid Zod shape that converts to JSON
 * Schema (what the SDK's tools/list payload needs), and the enums it exposes are
 * the SAME ones the vendored contracts define (so the wire contract can't drift).
 */

const inputShapes: Record<string, z.ZodRawShape> = {
  list_agents: S.listAgentsInput,
  review_pr: S.reviewPrInput,
  get_findings: S.getFindingsInput,
  get_conventions: S.getConventionsInput,
  get_blast_radius: S.getBlastRadiusInput,
};

const outputShapes: Record<string, z.ZodRawShape> = {
  list_agents: S.listAgentsOutput,
  review_pr: S.reviewPrOutput,
  get_findings: S.getFindingsOutput,
  get_conventions: S.getConventionsOutput,
  get_blast_radius: S.getBlastRadiusOutput,
};

describe('tool schemas → JSON Schema', () => {
  for (const [name, shape] of Object.entries(inputShapes)) {
    it(`${name} input shape produces a non-empty JSON Schema with described fields`, () => {
      const json = zodToJsonSchema(z.object(shape)) as {
        type?: string;
        properties?: Record<string, { description?: string }>;
      };
      expect(json.type).toBe('object');
      expect(json.properties).toBeDefined();
      const props = Object.values(json.properties!);
      expect(props.length).toBeGreaterThan(0);
      // Every input field carries a description (onboard a new client).
      for (const p of props) expect(typeof p.description).toBe('string');
    });
  }

  for (const [name, shape] of Object.entries(outputShapes)) {
    it(`${name} output shape produces a non-empty JSON Schema`, () => {
      const json = zodToJsonSchema(z.object(shape)) as {
        type?: string;
        properties?: Record<string, unknown>;
      };
      expect(json.type).toBe('object');
      expect(Object.keys(json.properties ?? {}).length).toBeGreaterThan(0);
    });
  }
});

describe('enums reuse the vendored contracts', () => {
  it('Severity matches the shared contract', () => {
    expect(Severity.options).toEqual(['CRITICAL', 'WARNING', 'SUGGESTION']);
    // get_findings.severity accepts only the shared severities.
    expect(z.object(S.getFindingsInput).safeParse({ pr: 'a/b#1', severity: 'CRITICAL' }).success).toBe(true);
    expect(z.object(S.getFindingsInput).safeParse({ pr: 'a/b#1', severity: 'HIGH' }).success).toBe(false);
  });

  it('FindingCategory / Provider / ReviewStrategy are the shared enums', () => {
    expect(FindingCategory.options).toEqual(['bug', 'security', 'perf', 'style', 'test']);
    expect(Provider.options).toEqual(['openai', 'anthropic', 'openrouter']);
    expect(ReviewStrategy.options).toEqual(['single-pass', 'map-reduce', 'auto']);
    expect(S.AgentOut.shape.provider).toBe(Provider);
    expect(S.AgentOut.shape.strategy).toBe(ReviewStrategy);
    expect(S.FindingOut.shape.severity).toBe(Severity);
    expect(S.FindingOut.shape.category).toBe(FindingCategory);
  });
});

describe('input defaults', () => {
  it('review_pr applies defaults', () => {
    const parsed = S.ReviewPrInput.parse({ pr: 'acme/payments-api#482' });
    expect(parsed).toMatchObject({
      pr: 'acme/payments-api#482',
      all: false,
      response_format: 'concise',
      timeout_seconds: 120,
    });
  });

  it('review_pr enforces timeout bounds (10..600)', () => {
    expect(S.ReviewPrInput.safeParse({ pr: 'a/b#1', timeout_seconds: 5 }).success).toBe(false);
    expect(S.ReviewPrInput.safeParse({ pr: 'a/b#1', timeout_seconds: 601 }).success).toBe(false);
    expect(S.ReviewPrInput.safeParse({ pr: 'a/b#1', timeout_seconds: 600 }).success).toBe(true);
  });

  it('get_findings / get_conventions apply pagination defaults', () => {
    expect(S.GetFindingsInput.parse({ pr: 'a/b#1' })).toMatchObject({
      limit: 20,
      response_format: 'concise',
      include_dismissed: false,
      all_runs: false,
    });
    expect(S.GetConventionsInput.parse({ repo: 'a/b' })).toMatchObject({
      limit: 20,
      response_format: 'summary',
    });
  });

  it('get_blast_radius applies defaults', () => {
    expect(S.GetBlastRadiusInput.parse({ pr: 'a/b#1' })).toMatchObject({
      direction: 'both',
      max_depth: 2,
    });
  });
});
