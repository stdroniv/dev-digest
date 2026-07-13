import { describe, it, expect } from 'vitest';
import { toEstimateRow } from './estimate.js';

describe('toEstimateRow (AC-11/12/13)', () => {
  it('AC-11: an agent with ≥1 completed run shows the mean latency/cost passed in', () => {
    const row = toEstimateRow({
      agent_id: 'a1',
      agent_name: 'Security Reviewer',
      runs: 5,
      avg_latency_ms: 12_340,
      avg_cost_usd: 0.042,
    });
    expect(row).toEqual({
      agent_id: 'a1',
      agent_name: 'Security Reviewer',
      avg_latency_ms: 12_340,
      avg_cost_usd: 0.042,
      runs: 5,
    });
  });

  it('AC-12: zero completed runs ⇒ null estimate (client shows "no history")', () => {
    const row = toEstimateRow({
      agent_id: 'a2',
      agent_name: 'Brand New Agent',
      runs: 0,
      avg_latency_ms: null,
      avg_cost_usd: null,
    });
    expect(row).toEqual({
      agent_id: 'a2',
      agent_name: 'Brand New Agent',
      avg_latency_ms: null,
      avg_cost_usd: null,
      runs: 0,
    });
  });

  it('AC-12: runs<=0 forces nulls even if raw agg fields were non-null (defensive)', () => {
    const row = toEstimateRow({
      agent_id: 'a3',
      agent_name: 'Weird Agg',
      runs: 0,
      avg_latency_ms: 999,
      avg_cost_usd: 1,
    });
    expect(row.avg_latency_ms).toBeNull();
    expect(row.avg_cost_usd).toBeNull();
  });

  it('AC-13: summing several rows (excluding null-history ones) yields the honest total — pure arithmetic check', () => {
    const rows = [
      toEstimateRow({ agent_id: 'a1', agent_name: 'A', runs: 2, avg_latency_ms: 10_000, avg_cost_usd: 0.1 }),
      toEstimateRow({ agent_id: 'a2', agent_name: 'B', runs: 0, avg_latency_ms: null, avg_cost_usd: null }),
      toEstimateRow({ agent_id: 'a3', agent_name: 'C', runs: 3, avg_latency_ms: 20_000, avg_cost_usd: 0.2 }),
    ];
    const withHistory = rows.filter((r) => r.avg_latency_ms != null);
    const totalMs = withHistory.reduce((sum, r) => sum + (r.avg_latency_ms ?? 0), 0);
    const totalCost = withHistory.reduce((sum, r) => sum + (r.avg_cost_usd ?? 0), 0);
    expect(totalMs).toBe(30_000); // sum, never Math.max (Rec A)
    expect(totalCost).toBeCloseTo(0.3, 9);
    expect(withHistory).toHaveLength(2); // the no-history agent is excluded
  });
});
