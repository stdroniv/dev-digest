import { describe, it, expect } from 'vitest';
import type { Intent, SmartDiff } from '@devdigest/shared';
import type { BlastResponse } from '../blast/types.js';
import { fingerprintInputs } from './fingerprint.js';

const INTENT: Intent = {
  intent: 'Add rate limiting',
  in_scope: ['middleware'],
  out_of_scope: ['auth'],
};

const BLAST: BlastResponse = {
  symbols: [
    {
      file: 'src/api/checkout.ts',
      name: 'handleCheckout',
      kind: 'function',
      callers: [],
      endpoints: ['POST /api/checkout'],
      crons: [],
    },
  ],
  totals: { symbols: 1, callers: 0, endpoints: 1, crons: 0 },
  impactedEndpoints: ['POST /api/checkout'],
  impactedCrons: [],
  index: { status: 'full', degraded: false, lastIndexedSha: 'abc123' },
  degraded: false,
  resolution: { limited: false },
};

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: 'core',
      files: [
        {
          path: 'src/api/checkout.ts',
          additions: 5,
          deletions: 1,
          finding_annotations: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 6, proposed_splits: [] },
};

describe('fingerprintInputs', () => {
  it('produces an identical hash for identical inputs', () => {
    const a = fingerprintInputs(INTENT, BLAST, SMART_DIFF);
    const b = fingerprintInputs(
      { ...INTENT, in_scope: [...INTENT.in_scope], out_of_scope: [...INTENT.out_of_scope] },
      { ...BLAST },
      { ...SMART_DIFF },
    );
    expect(a).toBe(b);
  });

  it('is insensitive to object key insertion order', () => {
    const a = fingerprintInputs(INTENT, BLAST, SMART_DIFF);
    // Rebuild BLAST with keys inserted in a different order.
    const reordered: BlastResponse = {
      degraded: BLAST.degraded,
      resolution: BLAST.resolution,
      impactedCrons: BLAST.impactedCrons,
      impactedEndpoints: BLAST.impactedEndpoints,
      index: BLAST.index,
      totals: BLAST.totals,
      symbols: BLAST.symbols,
    };
    const b = fingerprintInputs(INTENT, reordered, SMART_DIFF);
    expect(a).toBe(b);
  });

  it('produces a different hash when intent changes', () => {
    const a = fingerprintInputs(INTENT, BLAST, SMART_DIFF);
    const b = fingerprintInputs({ ...INTENT, intent: 'Something else entirely' }, BLAST, SMART_DIFF);
    expect(a).not.toBe(b);
  });

  it('produces a different hash when blast changes', () => {
    const a = fingerprintInputs(INTENT, BLAST, SMART_DIFF);
    const b = fingerprintInputs(INTENT, { ...BLAST, impactedEndpoints: [] }, SMART_DIFF);
    expect(a).not.toBe(b);
  });

  it('produces a different hash when smart diff changes', () => {
    const a = fingerprintInputs(INTENT, BLAST, SMART_DIFF);
    const b = fingerprintInputs(INTENT, BLAST, {
      ...SMART_DIFF,
      split_suggestion: { too_big: true, total_lines: 999, proposed_splits: [] },
    });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when blast or smart diff is null vs present', () => {
    const withBoth = fingerprintInputs(INTENT, BLAST, SMART_DIFF);
    const noBlast = fingerprintInputs(INTENT, null, SMART_DIFF);
    const noSmartDiff = fingerprintInputs(INTENT, BLAST, null);
    const neither = fingerprintInputs(INTENT, null, null);
    const hashes = new Set([withBoth, noBlast, noSmartDiff, neither]);
    expect(hashes.size).toBe(4);
  });
});
