/**
 * Smart Diff — pure classifier and assembler.
 *
 * No DB, no network, no side effects. Takes plain data in, returns a
 * SmartDiff contract value out. The repository orchestration layer
 * (SmartDiffService) feeds the inputs.
 */

import type { SmartDiff, SmartDiffRole, ProposedSplit, FindingAnnotation } from '@devdigest/shared';
import {
  BOILERPLATE_PATTERNS,
  WIRING_PATTERNS,
  SPLIT_TOO_BIG_LINES,
  SPLIT_MIN_FILES,
} from './smart-diff.constants.js';

/**
 * Classify a single file path into a SmartDiffRole.
 *
 * Evaluation order: boilerplate → wiring → core (fallback).
 * Lock files always map to 'boilerplate'.
 */
export function classifyFile(path: string): SmartDiffRole {
  for (const pattern of BOILERPLATE_PATTERNS) {
    if (pattern.test(path)) return 'boilerplate';
  }
  for (const pattern of WIRING_PATTERNS) {
    if (pattern.test(path)) return 'wiring';
  }
  return 'core';
}

/** Input shape expected by the assembler. */
export interface FileInput {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * Assemble a SmartDiff from a list of PR files and a pre-built
 * annotationsByPath map.
 *
 * Groups are always emitted in the fixed order: core → wiring →
 * boilerplate. Empty groups are dropped.
 *
 * finding_annotations per file are sorted by line ascending.
 *
 * split_suggestion.too_big is true when the total changed lines exceed
 * SPLIT_TOO_BIG_LINES AND there are at least SPLIT_MIN_FILES files.
 * When too_big, proposed_splits contains one entry per non-empty role.
 */
export function assembleSmartDiff(
  files: FileInput[],
  annotationsByPath: Map<string, FindingAnnotation[]>,
): SmartDiff {
  // Bucket files by role.
  const buckets: Record<SmartDiffRole, FileInput[]> = {
    core: [],
    wiring: [],
    boilerplate: [],
  };
  for (const f of files) {
    // Non-null assertion: classifyFile always returns a key present in buckets.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    buckets[classifyFile(f.path)]!.push(f);
  }

  // Fixed group order — drop empty groups.
  const ROLE_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];
  const groups = ROLE_ORDER.filter((role) => (buckets[role]?.length ?? 0) > 0).map((role) => ({
    role,
    // Non-null: role is always a key of the complete Record above.
    files: (buckets[role] ?? []).map((f) => {
      const finding_annotations = [...(annotationsByPath.get(f.path) ?? [])].sort(
        (a, b) => a.line - b.line,
      );
      return {
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        finding_annotations,
        pseudocode_summary: null,
      };
    }),
  }));

  // Split suggestion.
  const total_lines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const too_big = total_lines > SPLIT_TOO_BIG_LINES && files.length >= SPLIT_MIN_FILES;

  let proposed_splits: ProposedSplit[] = [];
  if (too_big) {
    proposed_splits = groups.map((g) => ({
      name: g.role,
      files: g.files.map((f) => f.path),
    }));
  }

  return {
    groups,
    split_suggestion: {
      too_big,
      total_lines,
      proposed_splits,
    },
  };
}
