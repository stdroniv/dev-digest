import { z } from 'zod';
import type { Settings } from '@devdigest/shared';

/** A persisted settings key/value row (non-secret prefs). */
export interface SettingsRow {
  key: string;
  value: unknown;
}

/** Collapse key/value setting rows into a flat `Settings` object. */
export function rowsToSettings(rows: SettingsRow[]): Settings {
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = r.value;
  return out as Settings;
}

/**
 * Default Markdown-discovery root folder names, used when a workspace hasn't
 * overridden the `root_folders` setting.
 */
export const DEFAULT_ROOT_FOLDERS = ['specs', 'docs', 'insights'];

const RootFoldersValue = z.array(z.string().min(1));

/**
 * Pure fold+parse+default logic for the `root_folders` setting: collapse the
 * rows, `safeParse` the `root_folders` key as a non-empty string array, and
 * fall back to `DEFAULT_ROOT_FOLDERS` when unset or invalid. Split out from
 * `getRootFolders` (which does the DB read) so this logic is hermetically
 * testable without a database.
 */
export function resolveRootFolders(rows: SettingsRow[]): string[] {
  const raw = (rowsToSettings(rows) as { root_folders?: unknown }).root_folders;
  const parsed = RootFoldersValue.safeParse(raw);
  return parsed.success ? parsed.data : [...DEFAULT_ROOT_FOLDERS];
}
