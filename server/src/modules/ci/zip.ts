import { strToU8, zipSync } from 'fflate';
import type { CiFile } from '@devdigest/shared';

/**
 * Zip the SAME file set `bundle.ts` produces (AC-10) — the degraded
 * "Copy files as a zip" install path calls this against `assembleBundle(...).files`
 * directly, so preview/zip/install never diverge (Rec1/AC-11).
 */
export function zipFiles(files: CiFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.path] = strToU8(file.contents);
  }
  return zipSync(entries, { level: 6 });
}
