import { describe, it, expect } from 'vitest';
import type { WhyRiskBrief } from '@devdigest/shared';
import { groundBriefRefs } from './grounding.js';

function baseBrief(overrides: Partial<WhyRiskBrief> = {}): WhyRiskBrief {
  return {
    what: 'Adds retry logic to the payment webhook handler.',
    why: 'Reduces dropped webhook events under transient network failures.',
    risk_level: 'medium',
    risks: [],
    review_focus: [],
    ...overrides,
  };
}

describe('groundBriefRefs', () => {
  it('drops an ungrounded file ref (AC-8)', () => {
    const brief = baseBrief({
      risks: [
        {
          description: 'Retry loop could double-charge on partial failure.',
          refs: [
            { kind: 'file', value: 'src/payments/webhook.ts' },
            { kind: 'file', value: 'src/not/a/real/file.ts' },
          ],
        },
      ],
    });

    const grounded = groundBriefRefs(brief, {
      changedFiles: new Set(['src/payments/webhook.ts']),
      impactedEndpoints: new Set(),
    });

    expect(grounded.risks).toHaveLength(1);
    expect(grounded.risks[0]?.refs).toEqual([
      { kind: 'file', value: 'src/payments/webhook.ts' },
    ]);
  });

  it('keeps a risk retaining only its grounded ref (AC-9)', () => {
    const brief = baseBrief({
      risks: [
        {
          description: 'Endpoint now retries writes.',
          refs: [
            { kind: 'endpoint', value: 'POST /webhooks/payment' },
            { kind: 'endpoint', value: 'POST /webhooks/unrelated' },
          ],
        },
      ],
    });

    const grounded = groundBriefRefs(brief, {
      changedFiles: new Set(),
      impactedEndpoints: new Set(['POST /webhooks/payment']),
    });

    expect(grounded.risks).toHaveLength(1);
    expect(grounded.risks[0]?.description).toBe('Endpoint now retries writes.');
    expect(grounded.risks[0]?.refs).toEqual([
      { kind: 'endpoint', value: 'POST /webhooks/payment' },
    ]);
  });

  it('drops a 0-grounded risk AND a 0-grounded focus item (AC-10)', () => {
    const brief = baseBrief({
      risks: [
        {
          description: 'This risk cites only files outside the PR.',
          refs: [{ kind: 'file', value: 'src/ghost.ts' }],
        },
        {
          description: 'This risk survives.',
          refs: [{ kind: 'file', value: 'src/payments/webhook.ts' }],
        },
      ],
      review_focus: [{ path: 'src/ghost.ts' }, { path: 'src/payments/webhook.ts' }],
    });

    const grounded = groundBriefRefs(brief, {
      changedFiles: new Set(['src/payments/webhook.ts']),
      impactedEndpoints: new Set(),
    });

    expect(grounded.risks).toHaveLength(1);
    expect(grounded.risks[0]?.description).toBe('This risk survives.');
    expect(grounded.review_focus).toEqual([{ path: 'src/payments/webhook.ts' }]);
  });

  it('grounds an endpoint ref only when it is in impactedEndpoints (AC-7)', () => {
    const brief = baseBrief({
      risks: [
        {
          description: 'Two endpoint refs, one real one fabricated.',
          refs: [
            { kind: 'endpoint', value: 'GET /pulls/:id' },
            { kind: 'endpoint', value: 'DELETE /pulls/:id' },
          ],
        },
      ],
    });

    const grounded = groundBriefRefs(brief, {
      changedFiles: new Set(),
      impactedEndpoints: new Set(['GET /pulls/:id']),
    });

    expect(grounded.risks[0]?.refs).toEqual([{ kind: 'endpoint', value: 'GET /pulls/:id' }]);
  });

  it('preserves order — removal only, never reorder (AC-6)', () => {
    const brief = baseBrief({
      risks: [
        { description: 'first', refs: [{ kind: 'file', value: 'a.ts' }] },
        { description: 'second', refs: [{ kind: 'file', value: 'b.ts' }] },
        { description: 'third', refs: [{ kind: 'file', value: 'c.ts' }] },
      ],
      review_focus: [{ path: 'c.ts' }, { path: 'a.ts' }, { path: 'b.ts' }],
    });

    const grounded = groundBriefRefs(brief, {
      changedFiles: new Set(['a.ts', 'b.ts', 'c.ts']),
      impactedEndpoints: new Set(),
    });

    expect(grounded.risks.map((r) => r.description)).toEqual(['first', 'second', 'third']);
    expect(grounded.review_focus.map((f) => f.path)).toEqual(['c.ts', 'a.ts', 'b.ts']);
  });

  it('drops review_focus items whose path is not a real changed file (AC-4)', () => {
    const brief = baseBrief({
      review_focus: [{ path: 'src/real.ts' }, { path: 'src/fabricated.ts' }],
    });

    const grounded = groundBriefRefs(brief, {
      changedFiles: new Set(['src/real.ts']),
      impactedEndpoints: new Set(),
    });

    expect(grounded.review_focus).toEqual([{ path: 'src/real.ts' }]);
  });

  it('produces an empty-but-generated brief when everything is ungrounded', () => {
    const brief = baseBrief({
      risks: [{ description: 'all fake', refs: [{ kind: 'file', value: 'ghost.ts' }] }],
      review_focus: [{ path: 'ghost.ts' }],
    });

    const grounded = groundBriefRefs(brief, {
      changedFiles: new Set(),
      impactedEndpoints: new Set(),
    });

    expect(grounded.risks).toEqual([]);
    expect(grounded.review_focus).toEqual([]);
    expect(grounded.what).toBe(brief.what);
    expect(grounded.why).toBe(brief.why);
    expect(grounded.risk_level).toBe(brief.risk_level);
  });
});
