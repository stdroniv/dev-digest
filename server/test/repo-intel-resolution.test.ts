/**
 * Hermetic unit tests for `computeResolution`.
 *
 * No DB, no Docker — pure function tests.
 */

import { describe, it, expect } from 'vitest';
import { computeResolution } from '../src/modules/repo-intel/service.js';

describe('computeResolution', () => {
  it('flags (100, 10) as limited (10 % resolved < 30 % threshold)', () => {
    const result = computeResolution(100, 10);
    expect(result.limited).toBe(true);
    expect(result.reason).toBe('sparse_cross_file');
  });

  it('does NOT flag (100, 90) — 90 % resolved is healthy', () => {
    expect(computeResolution(100, 90).limited).toBe(false);
  });

  it('does NOT flag (10, 0) — below the 50-reference floor', () => {
    expect(computeResolution(10, 0).limited).toBe(false);
  });

  it('does NOT flag (49, 0) — one below the floor', () => {
    expect(computeResolution(49, 0).limited).toBe(false);
  });

  it('flags (50, 14) — exactly at floor, 14/50 = 28 % < 30 %', () => {
    const result = computeResolution(50, 14);
    expect(result.limited).toBe(true);
  });

  it('does NOT flag (50, 15) — 15/50 = 30 % meets the threshold exactly', () => {
    expect(computeResolution(50, 15).limited).toBe(false);
  });

  it('returns limited:false when both are 0 (below floor)', () => {
    expect(computeResolution(0, 0).limited).toBe(false);
  });
});
