import { describe, expect, it } from 'vitest';
import type { EvalExpectedFinding } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { createMockReviewerLLM } from './mock-reviewer.js';
import { computeCitationAccuracy, computePrecision, computeRecall, type ScorableFinding } from './scoring/index.js';

/**
 * T10 — hermetic run-path test (`verify:l06`). Drives the REAL run path
 * (`reviewPullRequest` from `@devdigest/reviewer-core`, unmodified) against
 * the T5 deterministic mock reviewer, then scores the result with the pure
 * T3 scorer — no keys, no network, no DB/testcontainers (this is a plain
 * `*.test.ts`, not `.it.test.ts`; DB-backed persistence of a run is covered
 * separately by `service.it.test.ts`, which needs Docker).
 *
 * Proves:
 *  - AC-11/AC-21: the run path + scoring make zero LLM calls beyond the
 *    injected mock, and the math matches known fixtures.
 *  - AC-12: identical inputs (same scenario) → identical metrics.
 *  - AC-13: a "degraded" scenario (an extra noisy finding) produces a
 *    VISIBLE precision drop vs the "baseline" scenario, deterministically,
 *    while recall is unaffected.
 */

const FIXTURE_DIFF = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -10,0 +10,3 @@',
  '+  const a = 1;',
  '+  const b = 2;',
  '+  const c = 3;',
  'diff --git a/src/bar.ts b/src/bar.ts',
  '--- a/src/bar.ts',
  '+++ b/src/bar.ts',
  '@@ -5,0 +5,2 @@',
  '+  doStuff();',
  '+  doMore();',
].join('\n');

// Matches the mock reviewer's baseline finding: first added line of the
// first changed file (src/foo.ts, line 10 — see FIXTURE_DIFF's first hunk).
const EXPECTED: EvalExpectedFinding[] = [{ file: 'src/foo.ts', start_line: 10, end_line: 10 }];

async function runScenario(scenario: 'baseline' | 'degraded') {
  const diff = parseUnifiedDiff(FIXTURE_DIFF);
  const llm = createMockReviewerLLM(diff, scenario);
  const outcome = await reviewPullRequest({
    systemPrompt: 'You are a code reviewer.',
    model: 'mock-model',
    diff,
    llm,
    strategy: 'single-pass',
    task: `Eval run-path fixture (${scenario})`,
  });
  const actual: ScorableFinding[] = outcome.review.findings.map((f) => ({
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
  }));
  return {
    findings: outcome.review.findings,
    recall: computeRecall(EXPECTED, actual),
    precision: computePrecision(EXPECTED, actual),
    citationAccuracy: computeCitationAccuracy(actual, diff.raw),
  };
}

describe('eval run-path (mock reviewer + pure scorer, verify:l06)', () => {
  it('baseline scenario: the true positive is found, grounded, and scores perfectly (AC-11)', async () => {
    const result = await runScenario('baseline');
    expect(result.findings).toHaveLength(1);
    expect(result.recall).toBe(1);
    expect(result.precision).toBe(1);
    expect(result.citationAccuracy).toBe(1);
  });

  it('same scenario run twice yields IDENTICAL metrics — reproducible (AC-12)', async () => {
    const first = await runScenario('baseline');
    const second = await runScenario('baseline');
    expect(second.findings).toEqual(first.findings);
    expect(second.recall).toBe(first.recall);
    expect(second.precision).toBe(first.precision);
    expect(second.citationAccuracy).toBe(first.citationAccuracy);
  });

  it('degraded scenario adds a noisy finding — precision drops VISIBLY vs baseline, recall unaffected (AC-13)', async () => {
    const baseline = await runScenario('baseline');
    const degraded = await runScenario('degraded');

    // The true positive is still found — recall is unaffected by the noise.
    expect(degraded.recall).toBe(1);
    expect(degraded.recall).toBe(baseline.recall);

    // One extra, unexpected finding dents precision: 1/2 instead of 1/1.
    expect(degraded.findings).toHaveLength(2);
    expect(degraded.precision).toBe(0.5);
    expect(degraded.precision).toBeLessThan(baseline.precision);
    expect(baseline.precision - degraded.precision).toBeCloseTo(0.5, 5);
  });
});
