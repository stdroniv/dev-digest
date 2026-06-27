/**
 * BriefService model-resolution — hermetic unit tests.
 *
 * The three-tier resolution in BriefService.compute is:
 *   1. workspace override  (getFeatureModelOverride — DB call)
 *   2. opts.reachableModel (caller-supplied, from the first successful agent)
 *   3. defaultFeatureModel (registry default — pure, no I/O)
 *
 * Tiers 1 and 2 require DB access or a full review pipeline; they are covered
 * by the integration tests in brief-populate.it.test.ts:
 *   - Tier 2 (reachableModel used when no override): the OpenRouter-only test
 *   - Tier 1 (override wins): still a coverage gap — needs a DB-backed test
 *
 * This file covers Tier 3 hermetically: defaultFeatureModel is a pure lookup
 * into the FEATURE_MODELS registry — no DB, no network, no Docker.
 */
import { describe, it, expect } from 'vitest';
import { defaultFeatureModel } from '../src/modules/settings/feature-models.js';
import { FeatureModelChoice } from '@devdigest/shared';

describe('defaultFeatureModel — risk_brief registry default', () => {
  it("returns { provider: 'openai', model: 'gpt-4.1' } for 'risk_brief'", () => {
    // Tier 3 of BriefService's resolution chain: the hardcoded registry default
    // used when the workspace has no override AND no reachableModel was supplied.
    // Changing this silently would break non-OpenAI workspaces that rely on tier 2
    // (reachableModel) but would use tier 3 as the last resort — catching the change
    // here keeps the contract explicit without requiring Docker.
    const choice = defaultFeatureModel('risk_brief');
    expect(choice.provider).toBe('openai');
    expect(choice.model).toBe('gpt-4.1');
  });

  it('returns a FeatureModelChoice-valid shape for every registered feature id', () => {
    // If a future re-vendor changes a default to an invalid/empty string the `??`
    // chain would silently degrade — this ensures the registry is well-formed.
    const featureIds = [
      'onboarding',
      'review_intent',
      'risk_brief',
      'conformance',
      'conventions',
    ] as const;

    for (const id of featureIds) {
      const choice = defaultFeatureModel(id);
      const parsed = FeatureModelChoice.safeParse(choice);
      expect(
        parsed.success,
        `FEATURE_MODELS registry entry for '${id}' must satisfy FeatureModelChoice schema — got ${JSON.stringify(choice)}`,
      ).toBe(true);
    }
  });

  it("returns { provider: 'openai', model: 'gpt-4.1' } for 'review_intent'", () => {
    // Intent and risk-brief share the same registry default; both features are
    // affected by the three-tier fallback pattern. Asserting both here makes
    // any unintended drift between the two defaults immediately visible.
    const choice = defaultFeatureModel('review_intent');
    expect(choice.provider).toBe('openai');
    expect(choice.model).toBe('gpt-4.1');
  });
});
