import { describe, it, expect } from 'vitest';
import { Review } from '@devdigest/shared';
import type { ChatMessage } from '@devdigest/shared';
import { OpenRouterProvider } from '../src/index.js';

/**
 * Request-shape tests for the determinism knobs (Layer A): when a `seed` is
 * passed we must send it AND, on OpenRouter only, pin upstream routing so the
 * same model id stops drifting across hosts/quantizations. When no seed is
 * passed the request body must be byte-identical to today (neither field set).
 * Fully hermetic — we stub the OpenAI client's create() so there is no network.
 */
describe('OpenRouterProvider — seed + provider pinning request shape', () => {
  const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];
  const ok = JSON.stringify({ verdict: 'approve', summary: 'ok', score: 100, findings: [] });

  // Replace the SDK call with a recorder that captures the request body and
  // returns a minimal valid Review completion.
  function recorder(provider: OpenRouterProvider) {
    const captured: Record<string, unknown>[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client.chat.completions.create = async (arg: Record<string, unknown>) => {
      captured.push(arg);
      return { choices: [{ message: { content: ok } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    };
    return captured;
  }

  it('openrouter + seed → sends seed AND pins the provider', async () => {
    const provider = new OpenRouterProvider('k', { id: 'openrouter' });
    const captured = recorder(provider);
    await provider.completeStructured({ model: 'm', schema: Review, schemaName: 'Review', messages, seed: 1729 });
    expect(captured[0]!.seed).toBe(1729);
    expect(captured[0]!.provider).toEqual({ allow_fallbacks: false, require_parameters: true });
  });

  it('openrouter without seed → neither field set (byte-identical to today)', async () => {
    const provider = new OpenRouterProvider('k', { id: 'openrouter' });
    const captured = recorder(provider);
    await provider.completeStructured({ model: 'm', schema: Review, schemaName: 'Review', messages });
    expect('seed' in captured[0]!).toBe(false);
    expect('provider' in captured[0]!).toBe(false);
  });

  it('openai + seed → sends seed but NO provider field (openrouter-only)', async () => {
    const provider = new OpenRouterProvider('k', { id: 'openai' });
    const captured = recorder(provider);
    await provider.completeStructured({ model: 'm', schema: Review, schemaName: 'Review', messages, seed: 1729 });
    expect(captured[0]!.seed).toBe(1729);
    expect('provider' in captured[0]!).toBe(false);
  });
});

/**
 * complete() — the free-text path used by the blast-radius summary. Before this
 * existed, `complete` threw 'only implements completeStructured', so the summary
 * broke whenever OpenRouter was the resolved provider.
 */
describe('OpenRouterProvider — complete (free-text)', () => {
  const messages: ChatMessage[] = [{ role: 'user', content: 'summarise' }];

  function recorder(provider: OpenRouterProvider, res: Record<string, unknown>) {
    const captured: Record<string, unknown>[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client.chat.completions.create = async (arg: Record<string, unknown>) => {
      captured.push(arg);
      return res;
    };
    return captured;
  }

  it('returns choice text + token counts and prefers the OpenRouter usage cost', async () => {
    const provider = new OpenRouterProvider('k', { id: 'openrouter' });
    const captured = recorder(provider, {
      choices: [{ message: { content: 'One short paragraph.' } }],
      usage: { prompt_tokens: 12, completion_tokens: 34, cost: 0.0009 },
    });
    const res = await provider.complete({ model: 'm', messages, maxTokens: 300, temperature: 0.3 });
    expect(res.text).toBe('One short paragraph.');
    expect(res.tokensIn).toBe(12);
    expect(res.tokensOut).toBe(34);
    expect(res.costUsd).toBe(0.0009);
    expect(captured[0]!.max_tokens).toBe(300);
    expect(captured[0]!.usage).toEqual({ include: true });
  });

  it('throws (not silently empty) when OpenRouter returns no choices', async () => {
    const provider = new OpenRouterProvider('k', { id: 'openrouter' });
    recorder(provider, { choices: [], error: { message: 'rate limited' } });
    await expect(provider.complete({ model: 'm', messages })).rejects.toThrow(/no choices: rate limited/);
  });
});
