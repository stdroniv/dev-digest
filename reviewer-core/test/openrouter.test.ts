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
