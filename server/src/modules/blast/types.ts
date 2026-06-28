/**
 * blast — UI-ready response contract.
 *
 * These are plain TS interfaces (no Zod, no DB). They are the single source of
 * truth the route handlers return; the client mirrors them by hand.
 *
 * `IndexStatus` and `DegradedReason` are re-used from repo-intel/types so we
 * don't duplicate the string-union definitions.
 */

import type { IndexStatus, DegradedReason } from '../repo-intel/types.js';

/** One caller reference within a symbol group. */
export interface BlastCallerEntry {
  file: string;
  symbol: string;
  line: number;
  rank: number;
}

/**
 * A changed symbol together with its cross-file callers, and the HTTP
 * endpoints / cron jobs reachable from those callers' files.
 */
export interface BlastSymbolGroup {
  file: string;
  name: string;
  kind: string;
  /** Callers sorted rank-desc, capped at 20. */
  callers: BlastCallerEntry[];
  endpoints: string[];
  crons: string[];
}

/** Full shaped blast-radius response (GET /pulls/:id/blast). */
export interface BlastResponse {
  symbols: BlastSymbolGroup[];
  totals: {
    symbols: number;
    callers: number;
    endpoints: number;
    crons: number;
  };
  /** Flat union of all impacted HTTP endpoints across every changed symbol. */
  impactedEndpoints: string[];
  /** Flat union of all impacted cron jobs across every changed symbol. */
  impactedCrons: string[];
  index: {
    status: IndexStatus;
    degraded: boolean;
    reason?: DegradedReason;
    /** null when the repo has never been indexed or the sha is unknown. */
    lastIndexedSha: string | null;
  };
  /** True when the underlying facade ran in degraded / ripgrep mode. */
  degraded: boolean;
  reason?: DegradedReason;
}

/** Response from GET /pulls/:id/blast/summary. */
export interface BlastSummaryResponse {
  summary: string | null;
  cached: boolean;
  skipped?: 'no_key' | 'no_data';
}
