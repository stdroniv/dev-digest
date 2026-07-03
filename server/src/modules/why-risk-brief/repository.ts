import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { WhyRiskBrief } from '@devdigest/shared';

/**
 * A stored Why+Risk Brief row with `brief` parsed/validated against the shared
 * `WhyRiskBrief` contract (rather than the raw `jsonb` shape). Exported for the
 * service layer (T7) to consume.
 */
export type WhyRiskBriefRow = Omit<typeof t.whyRiskBrief.$inferSelect, 'brief'> & {
  brief: WhyRiskBrief;
};

/**
 * Read the cached Why+Risk Brief for a PR. Returns `undefined` when no row
 * exists yet, OR when the stored `brief` jsonb fails to `safeParse` against the
 * shared contract (never throws — repositories surface absence, not errors).
 */
export async function getWhyRiskBrief(db: Db, prId: string): Promise<WhyRiskBriefRow | undefined> {
  const [row] = await db.select().from(t.whyRiskBrief).where(eq(t.whyRiskBrief.prId, prId));
  if (!row) return undefined;
  const parsed = WhyRiskBrief.safeParse(row.brief);
  if (!parsed.success) return undefined;
  return { ...row, brief: parsed.data };
}

/** Input for `upsertWhyRiskBrief` — everything the service computed for a generation. */
export interface UpsertWhyRiskBriefInput {
  brief: WhyRiskBrief;
  docsTruncated: boolean;
  degradedInputs: unknown | null;
  inputsFingerprint: string;
  model: string | null;
  costUsd: number | string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

/**
 * Insert-or-replace the cached brief for a PR. One row per PR (`prId` PK) —
 * `onConflictDoUpdate` overwrites every column, giving last-write-wins
 * semantics for concurrent regeneration (AC-11 / concurrent-regen edge case).
 */
export async function upsertWhyRiskBrief(
  db: Db,
  prId: string,
  data: UpsertWhyRiskBriefInput,
): Promise<void> {
  const values = {
    prId,
    brief: data.brief,
    docsTruncated: data.docsTruncated,
    degradedInputs: data.degradedInputs,
    inputsFingerprint: data.inputsFingerprint,
    model: data.model,
    costUsd: data.costUsd === null ? null : String(data.costUsd),
    tokensIn: data.tokensIn,
    tokensOut: data.tokensOut,
    generatedAt: new Date(),
  };
  await db
    .insert(t.whyRiskBrief)
    .values(values)
    .onConflictDoUpdate({
      target: t.whyRiskBrief.prId,
      set: values,
    });
}
