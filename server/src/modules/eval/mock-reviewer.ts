import type { Finding, LLMProvider, Review, UnifiedDiff } from '@devdigest/shared';
import { MockLLMProvider } from '../../adapters/mocks.js';

/**
 * T5 — deterministic mock reviewer/LLM stub (AC-11/AC-12/AC-21).
 *
 * Given a case's frozen diff + a canned scenario, returns a FIXED set of
 * findings with zero network/LLM calls. Modeled on reviewer-core's stubbed
 * `LLMProvider` pattern and `server/src/adapters/mocks.ts`'s `MockLLMProvider`:
 * it satisfies the real `LLMProvider` contract, so the REAL run path
 * (`reviewPullRequest`, unmodified — AC-11 "the pipeline consumes the
 * existing reviewer, it does not modify it") is genuinely exercised end to
 * end (prompt assembly → structured completion → citation grounding); only
 * the LLM call itself is stubbed.
 *
 * Injected only by tests / `verify:l06` — NEVER registered in the production
 * DI container (`platform/container.ts`).
 */

export type MockReviewerScenario = 'baseline' | 'degraded';

type DiffFile = UnifiedDiff['files'][number];

function firstAddedLine(file: DiffFile): number | undefined {
  for (const hunk of file.hunks) {
    if (hunk.newLineNumbers.length > 0) return hunk.newLineNumbers[0];
  }
  return undefined;
}

function lastAddedLine(file: DiffFile): number | undefined {
  for (let i = file.hunks.length - 1; i >= 0; i--) {
    const hunk = file.hunks[i]!;
    if (hunk.newLineNumbers.length > 0) return hunk.newLineNumbers[hunk.newLineNumbers.length - 1];
  }
  return undefined;
}

function makeFinding(file: string, line: number, id: string, title: string): Finding {
  return {
    id,
    severity: 'WARNING',
    category: 'bug',
    title,
    file,
    start_line: line,
    end_line: line,
    rationale: `Mock reviewer finding at ${file}:${line}.`,
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
  };
}

/**
 * Deterministic findings for a given diff + scenario.
 *
 * 'baseline' — one finding at the first added line of the first changed
 * file (the "true positive" a well-behaved eval case's `must_find`
 * expectation is authored to match).
 *
 * 'degraded' — the SAME true positive PLUS one extra, noisy finding at
 * another added line — simulating a prompt regression that adds a spurious
 * noisy instruction. This dents PRECISION (the extra finding is noise per
 * the match rule) while RECALL stays unchanged — exactly the AC-13 shape
 * ("a deliberately degraded prompt shall produce a visible drop in
 * precision").
 */
export function buildMockFindings(diff: UnifiedDiff, scenario: MockReviewerScenario): Finding[] {
  const findings: Finding[] = [];
  const primaryFile = diff.files[0];
  if (primaryFile) {
    const line = firstAddedLine(primaryFile);
    if (line !== undefined) {
      findings.push(makeFinding(primaryFile.path, line, 'mock-finding-1', 'Mock finding'));
    }
  }
  if (scenario === 'degraded') {
    const noisyFile = diff.files[1] ?? diff.files[0];
    if (noisyFile) {
      const line = lastAddedLine(noisyFile);
      if (line !== undefined) {
        findings.push(makeFinding(noisyFile.path, line, 'mock-finding-noisy', 'Mock noisy finding'));
      }
    }
  }
  return findings;
}

/**
 * An `LLMProvider` whose `completeStructured` (schema `'Review'`) always
 * resolves to the SAME deterministic `Review` for a given `(diff, scenario)`
 * pair — no network, no keys. Plug this in as `container.llm(...)`'s
 * replacement (via the eval service's `llmOverride`) to run the real
 * `reviewPullRequest` path offline.
 */
export function createMockReviewerLLM(
  diff: UnifiedDiff,
  scenario: MockReviewerScenario = 'baseline',
): LLMProvider {
  const findings = buildMockFindings(diff, scenario);
  const review: Review = {
    verdict: findings.length > 0 ? 'comment' : 'approve',
    summary: `Mock (${scenario}) review — ${findings.length} finding(s).`,
    score: findings.length > 0 ? 70 : 95,
    findings,
  };
  return new MockLLMProvider('openai', { structuredBySchema: { Review: review } });
}
