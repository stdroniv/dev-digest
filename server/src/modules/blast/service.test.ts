/**
 * blast/service — hermetic unit tests for shapeBlastResponse.
 *
 * `shapeBlastResponse` is a pure function exported from service.ts; it needs no
 * DB or network. Tests drive it with hand-built BlastResult + IndexState fixtures
 * and assert the shaped BlastResponse.
 *
 * Covered:
 *  - Callers grouped under the correct changed symbol (via viaSymbol match).
 *  - Callers sorted rank-desc within a group.
 *  - Per-symbol cap of 20 callers.
 *  - Endpoints and crons attributed per symbol via factsByFile.
 *  - Flat impactedEndpoints + impactedCrons union (deduped).
 *  - totals computed correctly.
 *  - index block mirrors the mocked IndexState.
 *  - Degraded flag + reason propagated from BlastResult and IndexState.
 */

import { describe, it, expect } from 'vitest';
import { shapeBlastResponse } from './service.js';
import type { BlastResult, IndexState } from '../repo-intel/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_INDEX_STATE: IndexState = {
  repoId: 'repo-1',
  lastIndexedSha: 'abc123',
  indexerVersion: 1,
  updatedAt: new Date('2024-01-01'),
  status: 'full',
  filesIndexed: 10,
  filesSkipped: 0,
  durationMs: 100,
};

function makeBlastResult(overrides?: Partial<BlastResult>): BlastResult {
  return {
    changedSymbols: [
      { file: 'src/svc.ts', name: 'doWork', kind: 'function' },
      { file: 'src/utils.ts', name: 'parseConfig', kind: 'function' },
    ],
    callers: [
      { file: 'src/api.ts', symbol: 'handler', viaSymbol: 'doWork', line: 20, rank: 9 },
      { file: 'src/worker.ts', symbol: 'run', viaSymbol: 'doWork', line: 5, rank: 5 },
      { file: 'src/boot.ts', symbol: 'init', viaSymbol: 'parseConfig', line: 12, rank: 7 },
    ],
    impactedEndpoints: ['GET /api/data', 'POST /api/submit'],
    factsByFile: {
      'src/api.ts': { endpoints: ['GET /api/data'], crons: [] },
      'src/worker.ts': { endpoints: [], crons: ['*/5 * * * * workerJob'] },
      'src/boot.ts': { endpoints: ['POST /api/submit'], crons: [] },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

describe('shapeBlastResponse — grouping', () => {
  it('groups callers under the correct changed symbol via viaSymbol', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);

    const doWork = result.symbols.find((s) => s.name === 'doWork');
    const parseConfig = result.symbols.find((s) => s.name === 'parseConfig');

    expect(doWork).toBeDefined();
    expect(parseConfig).toBeDefined();
    expect(doWork!.callers).toHaveLength(2);
    expect(parseConfig!.callers).toHaveLength(1);

    const callerFiles = doWork!.callers.map((c) => c.file);
    expect(callerFiles).toContain('src/api.ts');
    expect(callerFiles).toContain('src/worker.ts');
    expect(parseConfig!.callers[0]!.file).toBe('src/boot.ts');
  });

  it('preserves symbol file and kind in each group', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    const doWork = result.symbols.find((s) => s.name === 'doWork')!;
    expect(doWork.file).toBe('src/svc.ts');
    expect(doWork.kind).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Rank-desc sort
// ---------------------------------------------------------------------------

describe('shapeBlastResponse — rank-desc sort', () => {
  it('sorts callers within a group by rank descending', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    const doWork = result.symbols.find((s) => s.name === 'doWork')!;
    // Ranks: api.ts=9, worker.ts=5 → api.ts should come first.
    expect(doWork.callers[0]!.rank).toBeGreaterThanOrEqual(doWork.callers[1]!.rank);
    expect(doWork.callers[0]!.file).toBe('src/api.ts');
    expect(doWork.callers[1]!.file).toBe('src/worker.ts');
  });
});

// ---------------------------------------------------------------------------
// Per-symbol cap of 20
// ---------------------------------------------------------------------------

describe('shapeBlastResponse — per-symbol cap', () => {
  it('caps callers per symbol at 20 even when more are present', () => {
    // Build a BlastResult with 25 callers for one symbol.
    const manyCallers = Array.from({ length: 25 }, (_, i) => ({
      file: `src/caller${i}.ts`,
      symbol: `fn${i}`,
      viaSymbol: 'doWork',
      line: i + 1,
      rank: i,
    }));
    const blast = makeBlastResult({ callers: manyCallers });
    const result = shapeBlastResponse(blast, BASE_INDEX_STATE);
    const doWork = result.symbols.find((s) => s.name === 'doWork')!;
    expect(doWork.callers).toHaveLength(20);
  });

  it('returns all callers when count is exactly 20', () => {
    const exactCallers = Array.from({ length: 20 }, (_, i) => ({
      file: `src/c${i}.ts`,
      symbol: `f${i}`,
      viaSymbol: 'doWork',
      line: i + 1,
      rank: i,
    }));
    const blast = makeBlastResult({ callers: exactCallers });
    const result = shapeBlastResponse(blast, BASE_INDEX_STATE);
    expect(result.symbols.find((s) => s.name === 'doWork')!.callers).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// Endpoint / cron attribution
// ---------------------------------------------------------------------------

describe('shapeBlastResponse — endpoint and cron attribution', () => {
  it('attributes endpoints from factsByFile of caller files to the correct symbol', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    const doWork = result.symbols.find((s) => s.name === 'doWork')!;
    // doWork callers: api.ts (GET /api/data) + worker.ts (cron only)
    expect(doWork.endpoints).toContain('GET /api/data');
    expect(doWork.crons).toContain('*/5 * * * * workerJob');
  });

  it('attributes endpoints to parseConfig via its caller boot.ts', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    const parseConfig = result.symbols.find((s) => s.name === 'parseConfig')!;
    expect(parseConfig.endpoints).toContain('POST /api/submit');
    expect(parseConfig.crons).toHaveLength(0);
  });

  it('deduplicates endpoints/crons within a symbol group', () => {
    // Two callers in the same file → endpoint should appear only once.
    const blast = makeBlastResult({
      callers: [
        { file: 'src/api.ts', symbol: 'h1', viaSymbol: 'doWork', line: 10, rank: 8 },
        { file: 'src/api.ts', symbol: 'h2', viaSymbol: 'doWork', line: 20, rank: 7 },
      ],
      factsByFile: {
        'src/api.ts': { endpoints: ['GET /api/data'], crons: [] },
      },
    });
    const result = shapeBlastResponse(blast, BASE_INDEX_STATE);
    const doWork = result.symbols.find((s) => s.name === 'doWork')!;
    const endpointCount = doWork.endpoints.filter((e) => e === 'GET /api/data').length;
    expect(endpointCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Flat unions
// ---------------------------------------------------------------------------

describe('shapeBlastResponse — flat unions', () => {
  it('builds a flat impactedEndpoints union from BlastResult.impactedEndpoints', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    expect(result.impactedEndpoints).toContain('GET /api/data');
    expect(result.impactedEndpoints).toContain('POST /api/submit');
  });

  it('builds a flat impactedCrons union from factsByFile[*].crons', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    expect(result.impactedCrons).toContain('*/5 * * * * workerJob');
  });

  it('impactedCrons is empty when factsByFile is absent (degraded path)', () => {
    const blast = makeBlastResult({ factsByFile: undefined });
    const result = shapeBlastResponse(blast, BASE_INDEX_STATE);
    expect(result.impactedCrons).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

describe('shapeBlastResponse — totals', () => {
  it('computes totals.symbols from changedSymbols count', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    expect(result.totals.symbols).toBe(2);
  });

  it('computes totals.callers from the total flat callers array', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    expect(result.totals.callers).toBe(3);
  });

  it('computes totals.endpoints from impactedEndpoints length', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    expect(result.totals.endpoints).toBe(2);
  });

  it('computes totals.crons from impactedCrons length', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    expect(result.totals.crons).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Index block
// ---------------------------------------------------------------------------

describe('shapeBlastResponse — index block', () => {
  it('mirrors IndexState.status in the index block', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    expect(result.index.status).toBe('full');
  });

  it('sets index.degraded from IndexState.degraded (default false)', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    expect(result.index.degraded).toBe(false);
  });

  it('propagates index.degraded = true when IndexState.degraded is set', () => {
    const state: IndexState = { ...BASE_INDEX_STATE, status: 'degraded', degraded: true, degradedReason: 'flag_off' };
    const result = shapeBlastResponse(makeBlastResult(), state);
    expect(result.index.degraded).toBe(true);
    expect(result.index.reason).toBe('flag_off');
  });

  it('sets index.lastIndexedSha from IndexState', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    expect(result.index.lastIndexedSha).toBe('abc123');
  });

  it('converts empty lastIndexedSha to null', () => {
    const state: IndexState = { ...BASE_INDEX_STATE, lastIndexedSha: '' };
    const result = shapeBlastResponse(makeBlastResult(), state);
    expect(result.index.lastIndexedSha).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Declaration-file exclusion (same-file caller guard)
// ---------------------------------------------------------------------------

describe('shapeBlastResponse — same-file caller exclusion', () => {
  it('excludes a caller whose file equals the changed symbol declaration file', () => {
    // doWork is declared in src/svc.ts. A caller row with file === 'src/svc.ts'
    // must be dropped even if viaSymbol matches (facade regression guard).
    const blast = makeBlastResult({
      callers: [
        // Same-file caller — should be excluded.
        { file: 'src/svc.ts', symbol: 'internal', viaSymbol: 'doWork', line: 3, rank: 10 },
        // Cross-file caller — should be included.
        { file: 'src/api.ts', symbol: 'handler', viaSymbol: 'doWork', line: 20, rank: 9 },
      ],
    });
    const result = shapeBlastResponse(blast, BASE_INDEX_STATE);
    const doWork = result.symbols.find((s) => s.name === 'doWork')!;

    const callerFiles = doWork.callers.map((c) => c.file);
    expect(callerFiles).not.toContain('src/svc.ts');
    expect(callerFiles).toContain('src/api.ts');
    expect(doWork.callers).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Degraded flag propagation
// ---------------------------------------------------------------------------

describe('shapeBlastResponse — degraded propagation', () => {
  it('propagates result.degraded = true from BlastResult', () => {
    const blast = makeBlastResult({ degraded: true, reason: 'no_data' });
    const result = shapeBlastResponse(blast, BASE_INDEX_STATE);
    expect(result.degraded).toBe(true);
    expect(result.reason).toBe('no_data');
  });

  it('defaults result.degraded to false when absent', () => {
    const result = shapeBlastResponse(makeBlastResult(), BASE_INDEX_STATE);
    expect(result.degraded).toBe(false);
  });
});
