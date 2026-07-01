import { eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { resolveRootFolders } from './helpers.js';

/**
 * Per-workspace override of the Markdown-discovery root folder names (the
 * top-level directories scanned for `.md` docs), read from the `settings`
 * table row `key='root_folders'`. Falls back to `['specs', 'docs', 'insights']`
 * when unset or invalid. Mirrors `getFeatureModelOverride`/`resolveFeatureModel`
 * in `./feature-models.ts`.
 */
export async function getRootFolders(container: Container, workspaceId: string): Promise<string[]> {
  const rows = await container.db
    .select({ key: t.settings.key, value: t.settings.value })
    .from(t.settings)
    .where(eq(t.settings.workspaceId, workspaceId));
  return resolveRootFolders(rows);
}
