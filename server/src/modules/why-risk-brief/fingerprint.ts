import { createHash } from 'node:crypto';
import type { Intent, SmartDiff } from '@devdigest/shared';
import type { BlastResponse } from '../blast/types.js';

/**
 * fingerprintInputs — deterministic hash of the Why+Risk Brief's DETERMINISTIC
 * inputs (intent + blast + smart-diff), used to detect staleness on read (Q3):
 * `WhyRiskBriefService.get` recomputes these three (all model-free) and
 * compares the hash against the stored `inputsFingerprint`, WITHOUT ever
 * calling the LLM.
 *
 * Pure/deterministic: `canonicalize` sorts object keys recursively so the same
 * logical input always hashes the same regardless of property insertion order
 * (Postgres/JS object key order is not guaranteed to be stable across reads).
 */

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key]);
    }
    return sorted;
  }
  return value;
}

export function fingerprintInputs(
  intent: Intent,
  blast: BlastResponse | null,
  smartDiff: SmartDiff | null,
): string {
  const canonical = canonicalize({ intent, blast, smartDiff });
  const json = JSON.stringify(canonical);
  return createHash('sha256').update(json).digest('hex');
}
