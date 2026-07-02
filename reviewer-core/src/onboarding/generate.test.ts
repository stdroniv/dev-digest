/**
 * generateOnboardingSection — hermetic unit tests.
 *
 * Acceptance (plan T2):
 * (a) each `kind` returns content validating against its `@devdigest/shared` schema.
 * (b) the user message contains the untrusted fence wrapper (label "onboarding-grounding").
 * (c) `firstTasks` rejects <2/>4 via the schema (MockLLMProvider throws on schema mismatch).
 * (d) returned `tokensIn`/`tokensOut` propagate from the mock.
 */
import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../../../server/src/adapters/mocks.js';
import { generateOnboardingSection, type OnboardingGrounding } from './generate.js';

const GROUNDING: OnboardingGrounding = {
  repoName: 'acme/widgets',
  repoMapText: 'src/index.ts: export function main()',
  topFiles: ['src/index.ts', 'src/server.ts'],
  criticalChains: [['src/index.ts', 'src/server.ts']],
  importGraph: {
    nodes: [
      { id: 'src/index.ts', label: 'index.ts' },
      { id: 'src/server.ts', label: 'server.ts' },
    ],
    edges: [{ from: 'src/index.ts', to: 'src/server.ts' }],
  },
  readme: '# Widgets\nA widget service.',
  fileTree: ['src/index.ts', 'src/server.ts', 'package.json'],
  languageHints: ['.ts: 2 files'],
};

const FIXTURE_BY_KIND = {
  architecture: {
    prose: 'This service starts in src/index.ts and delegates to src/server.ts.',
    refs: ['src/index.ts', 'src/server.ts'],
    diagram: {
      nodes: [
        { id: 'src/index.ts', label: 'index.ts' },
        { id: 'src/server.ts', label: 'server.ts' },
      ],
      edges: [{ from: 'src/index.ts', to: 'src/server.ts' }],
    },
  },
  critical_paths: {
    rows: [{ path: 'src/index.ts', why: 'the entry point' }],
  },
  how_to_run: {
    steps: [{ command: 'pnpm install' }, { command: 'pnpm dev', comment: 'starts the dev server' }],
  },
  reading_path: {
    steps: [{ path: 'src/index.ts', reason: 'read the entry point first' }],
  },
  first_tasks: {
    tasks: [
      { title: 'Add a test', path: 'src/index.ts', complexity: 'low' as const },
      { title: 'Fix a bug', path: 'src/server.ts', complexity: 'medium' as const },
    ],
  },
} as const;

describe('generateOnboardingSection', () => {
  for (const kind of Object.keys(FIXTURE_BY_KIND) as (keyof typeof FIXTURE_BY_KIND)[]) {
    it(`returns schema-valid content for kind="${kind}"`, async () => {
      const llm = new MockLLMProvider('openai', { structured: FIXTURE_BY_KIND[kind] });
      const result = await generateOnboardingSection({
        llm,
        model: 'gpt-4.1',
        kind,
        grounding: GROUNDING,
      });
      expect(result.data).toEqual(FIXTURE_BY_KIND[kind]);
      expect(result.tokensIn).toBe(100);
      expect(result.tokensOut).toBe(50);
    });
  }

  it('wraps the grounding in the untrusted fence labelled "onboarding-grounding"', async () => {
    const llm = new MockLLMProvider('openai', { structured: FIXTURE_BY_KIND.architecture });
    await generateOnboardingSection({
      llm,
      model: 'gpt-4.1',
      kind: 'architecture',
      grounding: GROUNDING,
    });
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    expect(call).toBeDefined();
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMessage = req.messages.find((m) => m.role === 'user');
    expect(userMessage?.content).toContain('<untrusted source="onboarding-grounding">');
    expect(userMessage?.content).toContain(GROUNDING.repoName);
  });

  it('ends the system prompt with the injection guard', async () => {
    const llm = new MockLLMProvider('openai', { structured: FIXTURE_BY_KIND.how_to_run });
    await generateOnboardingSection({
      llm,
      model: 'gpt-4.1',
      kind: 'how_to_run',
      grounding: GROUNDING,
    });
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const req = call!.req as { messages: { role: string; content: string }[] };
    const systemMessage = req.messages.find((m) => m.role === 'system');
    expect(systemMessage?.content).toContain('SECURITY — read carefully');
  });

  it('rejects a first_tasks fixture with fewer than 2 tasks (schema violation)', async () => {
    const llm = new MockLLMProvider('openai', {
      structured: { tasks: [{ title: 'Only one', path: 'src/index.ts', complexity: 'low' }] },
    });
    await expect(
      generateOnboardingSection({ llm, model: 'gpt-4.1', kind: 'first_tasks', grounding: GROUNDING }),
    ).rejects.toThrow();
  });

  it('rejects a first_tasks fixture with more than 4 tasks (schema violation)', async () => {
    const llm = new MockLLMProvider('openai', {
      structured: {
        tasks: Array.from({ length: 5 }, (_, i) => ({
          title: `Task ${i}`,
          path: 'src/index.ts',
          complexity: 'low',
        })),
      },
    });
    await expect(
      generateOnboardingSection({ llm, model: 'gpt-4.1', kind: 'first_tasks', grounding: GROUNDING }),
    ).rejects.toThrow();
  });
});
