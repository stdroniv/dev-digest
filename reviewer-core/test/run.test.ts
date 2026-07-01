import { describe, it, expect } from 'vitest';
import type { Finding, LLMProvider, StructuredResult } from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../server/src/adapters/mocks.js';
import { reviewPullRequest, dedupeFindings } from '../src/index.js';

/**
 * Engine-level test for reviewPullRequest (the core lifted out of the server's
 * runOneAgent). Uses the server's mock LLM + git so we exercise the real
 * assemble → completeStructured → reduce → grounding pipeline with no DB/SSE.
 */
describe('reviewPullRequest (engine)', () => {
  // One grounded finding (line 11 is in the MockGitClient diff) + one
  // hallucinated finding (line 999) the grounding gate must drop.
  const fixture = {
    verdict: 'request_changes',
    summary: 'secret key committed',
    score: 38,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'sk_live in diff',
        confidence: 0.98,
        kind: 'finding',
      },
      {
        id: 'f-hallucinated',
        severity: 'WARNING',
        category: 'bug',
        title: 'phantom finding on a line not in the diff',
        file: 'src/config.ts',
        start_line: 999,
        end_line: 999,
        rationale: 'not real',
        confidence: 0.3,
        kind: 'finding',
      },
    ],
  };

  it('single-pass: assembles, grounds, drops the hallucinated finding', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();

    const events: string[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
      task: 'Review PR #482',
      onEvent: (e) => events.push(e.msg),
    });

    expect(outcome.mode).toBe('single-pass');
    expect(outcome.grounding).toBe('1/2 passed');
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.start_line).toBe(11);
    // Verdict is derived from the surviving CRITICAL, not the model's self-report.
    expect(outcome.review.verdict).toBe('request_changes');
    expect(outcome.dropped).toHaveLength(1);
    // Score is derived from the SURVIVING findings, not the model's self-reported
    // 38: one CRITICAL remains after grounding ⇒ 100 − 35 = 65.
    expect(outcome.review.score).toBe(65);
    // Cost is aggregated from the LLM result (mock reports $0.001 per call;
    // single-pass = one call). The server persists this onto agent_runs.cost_usd.
    expect(outcome.costUsd).toBeCloseTo(0.001, 9);
    // progress is surfaced (server bridges this onto SSE; runner logs it)
    expect(events.some((m) => m.includes('Citation grounding'))).toBe(true);
  });

  it('score is deterministic from findings: a clean approve scores 100', async () => {
    // Model "approves" but reports a nonsense low score (the cheap-model bug).
    // The engine must ignore that and score the zero findings as a perfect 100.
    const clean = { verdict: 'approve', summary: 'looks good', score: 10, findings: [] };
    const llm = new MockLLMProvider('openai', { structured: clean });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'deepseek/deepseek-v4-flash',
      diff,
      llm,
      task: 'Review PR #5',
    });

    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.review.score).toBe(100);
  });

  it('verdict is deterministic from findings: a self-reported request_changes with no grounded findings → approve', async () => {
    // The screenshot bug: the model nitpicks in prose, self-reports verdict
    // 'request_changes' and a low score, but its only finding is hallucinated (line
    // 999, not in the diff) so grounding drops it. The engine must NOT surface the
    // model's verdict — with zero surviving findings the verdict is 'approve' and
    // the score 100, so the card can't read "100 / 0 findings / request changes".
    const lyingVerdict = {
      verdict: 'request_changes',
      summary: 'prose worries about edge cases but files nothing real',
      score: 40,
      findings: [
        {
          id: 'f-hallucinated',
          severity: 'WARNING',
          category: 'bug',
          title: 'phantom finding on a line not in the diff',
          file: 'src/config.ts',
          start_line: 999,
          end_line: 999,
          rationale: 'not real',
          confidence: 0.3,
          kind: 'finding',
        },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: lyingVerdict });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
      task: 'Review PR #6',
    });

    expect(outcome.review.findings).toHaveLength(0); // hallucinated finding dropped
    expect(outcome.review.verdict).toBe('approve'); // NOT the model's 'request_changes'
    expect(outcome.review.score).toBe(100);
  });

  it('checkCancelled throwing aborts before the LLM call', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();
    await expect(
      reviewPullRequest({
        systemPrompt: 's',
        model: 'gpt-4.1',
        diff,
        llm,
        checkCancelled: () => {
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
  });

  it('forwards sessionId to every LLM call (OpenRouter session grouping)', async () => {
    const seen: (string | undefined)[] = [];
    const recorder: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        seen.push(req.sessionId);
        return {
          data: fixture as unknown as T,
          model: req.model,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          raw: '',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    const diff = await new MockGitClient().diff();
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: recorder, sessionId: 'sess-abc' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === 'sess-abc')).toBe(true);
  });

  it('forwards seed to the LLM, and omits it when not set', async () => {
    const seen: (number | undefined)[] = [];
    const recorder: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        seen.push(req.seed);
        return { data: fixture as unknown as T, model: req.model, tokensIn: 0, tokensOut: 0, costUsd: 0, raw: '', attempts: 1 };
      },
      async listModels() { return []; },
      async complete() { throw new Error('not used'); },
      async embed() { return []; },
    };
    const diff = await new MockGitClient().diff();
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: recorder, seed: 1729 });
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: recorder });
    expect(seen).toEqual([1729, undefined]);
  });
});

describe('reviewPullRequest — false-negative re-sample guard', () => {
  // A clean approve with ZERO findings (the lazy-empty failure shape) followed by
  // a sample that DOES surface the grounded finding (line 11 is in the mock diff).
  const empty = { verdict: 'approve', summary: 'looks good', score: 10, findings: [] };
  const withFinding = {
    verdict: 'request_changes',
    summary: 'secret key committed',
    score: 38,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'sk_live in diff',
        confidence: 0.98,
        kind: 'finding',
      },
    ],
  };
  const structuredCalls = (llm: MockLLMProvider) =>
    llm.calls.filter((c) => c.method === 'completeStructured').length;

  it('regression: an empty first sample is rescued by a re-sample that finds the bug', async () => {
    const llm = new MockLLMProvider('openai', { structuredSequence: [empty, withFinding] });
    const diff = await new MockGitClient().diff();
    const events: string[] = [];

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'deepseek/deepseek-v4-flash',
      diff,
      llm,
      resampleOnEmpty: 1,
      onEvent: (e) => events.push(e.msg),
    });

    expect(structuredCalls(llm)).toBe(2);
    expect(outcome.resampled).toBe(true);
    expect(outcome.samples).toBe(2);
    expect(outcome.review.findings).toHaveLength(1);
    // Verdict is derived from the surviving CRITICAL (default 'critical' gate), not
    // copied from the model — here it happens to match the model's request_changes.
    expect(outcome.review.verdict).toBe('request_changes');
    expect(outcome.review.score).toBe(65); // one surviving CRITICAL ⇒ 100 − 35
    expect(events.some((m) => m.includes('re-sampling'))).toBe(true);
  });

  it('off by default: omitting resampleOnEmpty keeps the single lazy approve (back-compat)', async () => {
    const llm = new MockLLMProvider('openai', { structuredSequence: [empty, withFinding] });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm });

    expect(structuredCalls(llm)).toBe(1);
    expect(outcome.resampled).toBe(false);
    expect(outcome.samples).toBe(1);
    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.review.score).toBe(100);
  });

  it('does NOT re-sample when the first sample already has findings', async () => {
    const llm = new MockLLMProvider('openai', { structuredSequence: [withFinding, withFinding] });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm, resampleOnEmpty: 1 });

    expect(structuredCalls(llm)).toBe(1);
    expect(outcome.resampled).toBe(false);
    expect(outcome.review.findings).toHaveLength(1);
  });

  it('re-sample that is still empty stays a clean approve (guard ran, found nothing)', async () => {
    const llm = new MockLLMProvider('openai', { structuredSequence: [empty, empty] });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm, resampleOnEmpty: 1 });

    expect(structuredCalls(llm)).toBe(2);
    expect(outcome.resampled).toBe(true);
    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.review.score).toBe(100);
  });

  it('perturbs the re-sample: higher temperature + offset seed so it actually differs', async () => {
    let n = 0;
    const seen: { temperature?: number; seed?: number }[] = [];
    const recorder: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        seen.push({ temperature: req.temperature, seed: req.seed });
        const data = (n++ === 0 ? empty : withFinding) as unknown as T;
        return { data, model: req.model, tokensIn: 0, tokensOut: 0, costUsd: 0, raw: '', attempts: 1 };
      },
      async listModels() { return []; },
      async complete() { throw new Error('not used'); },
      async embed() { return []; },
    };
    const diff = await new MockGitClient().diff();

    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: recorder, seed: 1729, resampleOnEmpty: 1 });

    expect(seen).toHaveLength(2);
    expect(seen[0]!.seed).toBe(1729); // first pass: caller's seed, default temperature
    expect(seen[1]!.seed).toBe(1730); // re-sample: offset seed …
    expect(seen[1]!.temperature).toBeCloseTo(0.4, 9); // … and a perturbed temperature
  });
});

describe('dedupeFindings', () => {
  const make = (over: Partial<Finding>): Finding => ({
    id: 'x',
    severity: 'WARNING',
    category: 'bug',
    title: 'Same defect',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 10,
    rationale: 'r',
    confidence: 0.5,
    kind: 'finding',
    ...over,
  });

  it('collapses same file:line:title and keeps the higher-severity copy', () => {
    const out = dedupeFindings([
      make({ id: 'a', severity: 'WARNING', confidence: 0.9 }),
      make({ id: 'b', severity: 'CRITICAL', confidence: 0.5 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('CRITICAL');
  });

  it('keeps distinct findings (different line) and is a no-op on a single finding', () => {
    const a = make({ id: 'a', start_line: 10, end_line: 10 });
    const b = make({ id: 'b', start_line: 20, end_line: 20 });
    expect(dedupeFindings([a, b])).toHaveLength(2);
    expect(dedupeFindings([a])).toEqual([a]);
  });
});
