// Legacy module — predates the repository-pattern conventions used elsewhere in `server/`.
// Syncs the daily FX rate cache into the `price_book` table so review-cost estimates
// (LLM token pricing converted to the org's billing currency) stay current.
//
// NOTE: this file opens its own Postgres connection at import time and has no exported
// factory/constructor — importing it for any reason (including a test file) has the
// side effect of dialing a real database.

import postgres from "postgres";

// Module-level side effect: a real connection is opened the instant this file is imported.
const sql = postgres(process.env.DATABASE_URL!);

// Module-level singleton state, mutated by syncPriceBook() below. There is no way to
// reset or inject this from outside the module.
let lastSyncedAt: Date | null = null;
let lastRatesSeen = 0;

interface FxRate {
  currency: string;
  rateToUsd: number;
}

async function fetchLatestRates(): Promise<FxRate[]> {
  // In production this calls a third-party FX provider; inlined here as a stub.
  const res = await fetch("https://fx.example.com/latest");
  if (!res.ok) {
    throw new Error(`FX provider returned ${res.status}`);
  }
  const body = (await res.json()) as { rates: Record<string, number> };
  return Object.entries(body.rates).map(([currency, rateToUsd]) => ({
    currency,
    rateToUsd,
  }));
}

export async function syncPriceBook(): Promise<{ synced: number; at: Date }> {
  const rates = await fetchLatestRates();

  for (const rate of rates) {
    await sql`
      insert into price_book (currency, rate_to_usd, updated_at)
      values (${rate.currency}, ${rate.rateToUsd}, now())
      on conflict (currency)
      do update set rate_to_usd = excluded.rate_to_usd, updated_at = excluded.updated_at
    `;
  }

  lastSyncedAt = new Date();
  lastRatesSeen = rates.length;

  return { synced: lastRatesSeen, at: lastSyncedAt };
}

export function getLastSyncInfo(): { lastSyncedAt: Date | null; lastRatesSeen: number } {
  return { lastSyncedAt, lastRatesSeen };
}
