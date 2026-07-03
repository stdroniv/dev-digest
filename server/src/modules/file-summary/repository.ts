import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type FileSummaryRow = typeof t.prFileSummary.$inferSelect;

/**
 * Read the cached per-file summary for `(prId, path)`. Returns `undefined`
 * when no row exists yet (never throws — repositories surface absence, not
 * errors).
 */
export async function getFileSummary(
  db: Db,
  prId: string,
  path: string,
): Promise<FileSummaryRow | undefined> {
  const [row] = await db
    .select()
    .from(t.prFileSummary)
    .where(and(eq(t.prFileSummary.prId, prId), eq(t.prFileSummary.path, path)));
  return row;
}

/** Input for `upsertFileSummary` — everything the service computed for a generation. */
export interface UpsertFileSummaryInput {
  summary: string;
  patchHash: string;
  model: string | null;
}

/**
 * Insert-or-replace the cached summary for `(prId, path)` — the composite
 * primary key. `onConflictDoUpdate` overwrites every column, giving
 * last-write-wins semantics for concurrent regeneration.
 */
export async function upsertFileSummary(
  db: Db,
  prId: string,
  path: string,
  data: UpsertFileSummaryInput,
): Promise<void> {
  const values = {
    prId,
    path,
    summary: data.summary,
    patchHash: data.patchHash,
    model: data.model,
    generatedAt: new Date(),
  };
  await db
    .insert(t.prFileSummary)
    .values(values)
    .onConflictDoUpdate({
      target: [t.prFileSummary.prId, t.prFileSummary.path],
      set: values,
    });
}
