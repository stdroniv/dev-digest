import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type MemoryRow = typeof t.memory.$inferSelect;

export interface InsertMemory {
  workspaceId: string;
  repoId: string | null;
  scope: 'repo' | 'global' | 'team';
  kind: 'decision' | 'convention' | 'preference' | 'fact' | 'learning';
  content: string;
  confidence: number | null;
  sources: unknown;
}

/**
 * T6 — minimal repository for the `memory` table (Knowledge/RAG, AC-25). No
 * reads are needed yet (nothing consumes `memory` downstream in this plan) —
 * just the single insert the "Learn" action performs.
 */
export class MemoryRepository {
  constructor(private db: Db) {}

  async insert(values: InsertMemory): Promise<MemoryRow> {
    const [row] = await this.db
      .insert(t.memory)
      .values({
        workspaceId: values.workspaceId,
        repoId: values.repoId,
        scope: values.scope,
        kind: values.kind,
        content: values.content,
        confidence: values.confidence,
        sources: values.sources,
        embedding: null, // no LLM call — see Non-functional "No added model cost"
      })
      .returning();
    return row!;
  }
}
