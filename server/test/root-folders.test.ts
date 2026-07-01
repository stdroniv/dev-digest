/**
 * root_folders setting — hermetic unit tests.
 *
 * `resolveRootFolders` is the pure fold+parse+default logic used by
 * `getRootFolders` (the DB-backed read is covered by
 * `settings-models.it.test.ts`). No DB, no network, no Docker.
 */
import { describe, it, expect } from 'vitest';
import { resolveRootFolders, DEFAULT_ROOT_FOLDERS } from '../src/modules/settings/helpers.js';

describe('resolveRootFolders', () => {
  it("returns the default ['specs','docs','insights'] when unset", () => {
    expect(resolveRootFolders([])).toEqual(['specs', 'docs', 'insights']);
    expect(resolveRootFolders([{ key: 'theme', value: 'dark' }])).toEqual(DEFAULT_ROOT_FOLDERS);
  });

  it('returns the parsed override when a valid custom list is set', () => {
    const rows = [{ key: 'root_folders', value: ['docs', 'adr', 'playbooks'] }];
    expect(resolveRootFolders(rows)).toEqual(['docs', 'adr', 'playbooks']);
  });

  it('falls back to the default when the stored value is invalid', () => {
    expect(resolveRootFolders([{ key: 'root_folders', value: 'not-an-array' }])).toEqual(
      DEFAULT_ROOT_FOLDERS,
    );
    expect(resolveRootFolders([{ key: 'root_folders', value: ['docs', ''] }])).toEqual(
      DEFAULT_ROOT_FOLDERS,
    );
  });
});
