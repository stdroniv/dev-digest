import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildDeps, structured } from './helpers/harness.js';
import { seed } from '@devdigest/api/db/seed.js';
import type {
  RepoIntel,
  BlastResult,
  IndexState,
} from '@devdigest/api/modules/repo-intel/types.js';
import { makeGetBlastRadiusTool } from '../src/tools/get-blast-radius.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

interface BlastOut {
  pr: string;
  symbol: string | null;
  symbols: {
    file: string;
    name: string;
    kind: string;
    callers: { file: string; symbol: string; line: number; rank: number }[];
    endpoints: string[];
    crons: string[];
  }[];
  totals: { symbols: number; callers: number; endpoints: number; crons: number };
  impacted_endpoints: string[];
  impacted_crons: string[];
  index: { status: string; degraded: boolean; reason: string | null; last_indexed_sha: string | null };
  degraded: boolean;
  reason: string | null;
  resolution: { limited: boolean; reason: string | null };
}

// ---------------------------------------------------------------------------
// Mock RepoIntel facade — deterministic fixtures, no real indexer/clone.
// ---------------------------------------------------------------------------

const MOCK_INDEX_STATE: IndexState = {
  repoId: 'any',
  lastIndexedSha: 'def789abc',
  indexerVersion: 1,
  updatedAt: new Date('2024-01-01'),
  status: 'full',
  filesIndexed: 5,
  filesSkipped: 0,
  durationMs: 50,
};

const MOCK_BLAST_RESULT: BlastResult = {
  changedSymbols: [
    { file: 'src/payments.ts', name: 'processPayment', kind: 'function' },
    { file: 'src/email.ts', name: 'sendReceipt', kind: 'function' },
  ],
  callers: [
    { file: 'src/api/checkout.ts', symbol: 'handleCheckout', viaSymbol: 'processPayment', line: 42, rank: 9 },
    { file: 'src/api/refunds.ts', symbol: 'handleRefund', viaSymbol: 'processPayment', line: 18, rank: 7 },
    { file: 'src/jobs/nightly.ts', symbol: 'runNightly', viaSymbol: 'sendReceipt', line: 3, rank: 4 },
  ],
  impactedEndpoints: ['POST /api/checkout', 'POST /api/refunds'],
  factsByFile: {
    'src/api/checkout.ts': { endpoints: ['POST /api/checkout'], crons: [] },
    'src/api/refunds.ts': { endpoints: ['POST /api/refunds'], crons: [] },
    'src/jobs/nightly.ts': { endpoints: [], crons: ['0 2 * * *'] },
  },
  resolution: { limited: false },
};

function buildMockRepoIntel(): RepoIntel {
  return {
    async getBlastRadius(): Promise<BlastResult> {
      return MOCK_BLAST_RESULT;
    },
    async getIndexState(): Promise<IndexState> {
      return MOCK_INDEX_STATE;
    },
    async indexRepo() {
      return { status: 'full' as const, filesIndexed: 0, filesSkipped: 0, durationMs: 0 };
    },
    async refreshIndex() {
      return { status: 'full' as const, filesIndexed: 0, filesSkipped: 0, durationMs: 0 };
    },
    async getRepoMap() {
      return { text: '', tokens: 0, cached: false };
    },
    async getFileRank() {
      return [];
    },
    async getSymbolsInFiles() {
      return [];
    },
    async getCallerSignatures() {
      return [];
    },
    async getUnresolvedReferences() {
      return [];
    },
    async getConventionSamples() {
      return [];
    },
    async getTopFilesByRank() {
      return [];
    },
    async getCriticalPaths() {
      return [];
    },
  };
}

d('devdigest_get_blast_radius (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const tool = () =>
    makeGetBlastRadiusTool(buildDeps(pg.handle.db, { repoIntel: buildMockRepoIntel() }));

  it('returns the grouped blast radius for a valid PR (isError:false)', async () => {
    const res = await tool().handler({ pr: 'acme/payments-api#482' });
    expect(res.isError).toBeUndefined();

    const out = structured<BlastOut>(res);
    expect(out.pr).toBe('acme/payments-api#482');
    expect(out.symbol).toBeNull();

    // Grouped by changed symbol.
    expect(out.symbols.map((s) => s.name).sort()).toEqual(['processPayment', 'sendReceipt']);
    const payments = out.symbols.find((s) => s.name === 'processPayment')!;
    expect(payments.callers).toHaveLength(2);
    // Callers are rank-desc.
    expect(payments.callers[0]!.rank).toBeGreaterThanOrEqual(payments.callers[1]!.rank);
    // Endpoints attributed via caller files.
    expect(payments.endpoints).toContain('POST /api/checkout');
    expect(payments.endpoints).toContain('POST /api/refunds');

    // Totals + flat unions + index block.
    expect(out.totals.symbols).toBe(2);
    expect(out.totals.callers).toBe(3);
    expect(out.impacted_endpoints).toContain('POST /api/checkout');
    expect(out.index.status).toBe('full');
    expect(out.index.last_indexed_sha).toBe('def789abc');
    expect(out.degraded).toBe(false);
    expect(out.resolution.limited).toBe(false);
  });

  it('narrows to a single changed symbol via `symbol` and recomputes totals', async () => {
    const res = await tool().handler({ pr: 'acme/payments-api#482', symbol: 'sendReceipt' });
    expect(res.isError).toBeUndefined();

    const out = structured<BlastOut>(res);
    expect(out.symbol).toBe('sendReceipt');
    expect(out.symbols).toHaveLength(1);
    expect(out.symbols[0]!.name).toBe('sendReceipt');
    expect(out.totals).toEqual({ symbols: 1, callers: 1, endpoints: 0, crons: 1 });
    expect(out.impacted_crons).toEqual(['0 2 * * *']);
    expect(out.impacted_endpoints).toEqual([]);
  });

  it('validates the PR exists first (isError for a missing PR)', async () => {
    const res = await tool().handler({ pr: 'acme/payments-api#999999' });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0]!.text).toMatch(/not found/i);
  });
});
