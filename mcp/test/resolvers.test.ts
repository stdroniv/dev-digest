import { describe, it, expect } from 'vitest';
import type { Agent } from '@devdigest/shared';
import { parsePrRef, parseRepoRef, resolveAgentByName } from '../src/resolvers.js';
import { McpToolError } from '../src/errors.js';
import type { ToolDeps } from '../src/deps.js';

describe('parsePrRef', () => {
  it('parses owner/repo#number', () => {
    expect(parsePrRef('acme/payments-api#482')).toEqual({
      owner: 'acme',
      name: 'payments-api',
      fullName: 'acme/payments-api',
      number: 482,
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parsePrRef('  acme/payments-api#1  ').number).toBe(1);
  });

  it.each(['acme/payments-api', 'acme#1', 'foo', 'acme/repo#', 'acme/repo#abc'])(
    'rejects malformed %s with an actionable message',
    (bad) => {
      try {
        parsePrRef(bad);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(McpToolError);
        expect((err as McpToolError).message).toContain('owner/repo#number');
      }
    },
  );
});

describe('parseRepoRef', () => {
  it('parses owner/repo', () => {
    expect(parseRepoRef('acme/payments-api')).toEqual({
      owner: 'acme',
      name: 'payments-api',
      fullName: 'acme/payments-api',
    });
  });

  it.each(['acme', 'a/b/c', 'acme/repo#1', 'acme/'])('rejects malformed %s', (bad) => {
    expect(() => parseRepoRef(bad)).toThrow(McpToolError);
  });
});

describe('resolveAgentByName', () => {
  function depsWithAgents(agents: Partial<Agent>[]): ToolDeps {
    return {
      services: { agents: { list: async () => agents as Agent[] } },
    } as unknown as ToolDeps;
  }

  it('matches case-insensitively', async () => {
    const deps = depsWithAgents([{ id: 'a1', name: 'Security Reviewer' }]);
    const agent = await resolveAgentByName(deps, 'ws', 'security reviewer');
    expect(agent.id).toBe('a1');
  });

  it('throws an actionable McpToolError when not found', async () => {
    const deps = depsWithAgents([{ id: 'a1', name: 'Security Reviewer' }]);
    await expect(resolveAgentByName(deps, 'ws', 'Nope')).rejects.toThrowError(
      /Agent 'Nope' not found\. Call devdigest_list_agents/,
    );
  });
});
