import { describe, it, expect } from 'vitest';
import { aggregate, type PerCaseScore } from './aggregate.js';

describe('aggregate', () => {
  it('a zero-case set scores defined maximal metrics, never NaN (AC-20)', () => {
    const result = aggregate([]);
    expect(result).toEqual({
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      traces_passed: 0,
      traces_total: 0,
    });
  });

  it('averages recall/precision/citation_accuracy across cases and counts passes', () => {
    const records: PerCaseScore[] = [
      { recall: 1, precision: 1, citation_accuracy: 1, pass: true },
      { recall: 0, precision: 0.5, citation_accuracy: 1, pass: false },
    ];
    const result = aggregate(records);
    expect(result.recall).toBe(0.5);
    expect(result.precision).toBe(0.75);
    expect(result.citation_accuracy).toBe(1);
    expect(result.traces_passed).toBe(1);
    expect(result.traces_total).toBe(2);
  });

  it('is reproducible: identical inputs always yield the identical aggregate (AC-12)', () => {
    const records: PerCaseScore[] = [
      { recall: 1, precision: 1, citation_accuracy: 1, pass: true },
    ];
    expect(aggregate(records)).toEqual(aggregate(records));
  });

  it('a degraded prompt run (a noisier baseline) produces a visibly lower aggregate precision than the prior run (AC-13)', () => {
    const baseline: PerCaseScore[] = [
      { recall: 1, precision: 1, citation_accuracy: 1, pass: true },
      { recall: 1, precision: 1, citation_accuracy: 1, pass: true },
    ];
    const degraded: PerCaseScore[] = [
      { recall: 1, precision: 0.5, citation_accuracy: 1, pass: false },
      { recall: 1, precision: 0.5, citation_accuracy: 1, pass: false },
    ];
    const before = aggregate(baseline);
    const after = aggregate(degraded);
    expect(after.precision).toBeLessThan(before.precision);
  });
});
