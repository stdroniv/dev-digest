/**
 * Smart Diff — hermetic unit tests for the classifier and assembler.
 *
 * No DB, no network. All inputs are plain values.
 */

import { describe, it, expect } from 'vitest';
import { classifyFile, assembleSmartDiff } from '../src/modules/reviews/smart-diff.classify.js';
import {
  BOILERPLATE_PATTERNS,
  WIRING_PATTERNS,
  SPLIT_TOO_BIG_LINES,
  SPLIT_MIN_FILES,
} from '../src/modules/reviews/smart-diff.constants.js';
import { SmartDiff } from '../src/vendor/shared/contracts/brief.js';

// ---------------------------------------------------------------------------
// classifyFile
// ---------------------------------------------------------------------------

describe('classifyFile — boilerplate', () => {
  it.each([
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'bun.lockb',
    'Cargo.lock',
    'poetry.lock',
    'composer.lock',
    'go.sum',
    'dist/index.js',
    'dist/x.js',
    'build/app.js',
    'out/server.js',
    '.next/static/chunks/main.js',
    'coverage/lcov.info',
    'a.min.js',
    'lib/vendor.min.js',
    'src/app.js.map',
    'styles.css.map',
    '__snapshots__/MyComponent.test.tsx.snap',
    'src/__snapshots__/util.snap',
    'MyComponent.test.tsx.snap',
    'src/vendor/shared/contracts/brief.ts',
    'node_modules/lodash/index.js',
    'src/api.generated.ts',
    'codegen/types.generated.d.ts',
  ])('%s → boilerplate', (path) => {
    expect(classifyFile(path)).toBe('boilerplate');
  });
});

describe('classifyFile — wiring', () => {
  it.each([
    'package.json',
    'apps/web/package.json',
    'tsconfig.json',
    'tsconfig.build.json',
    'vite.config.ts',
    'jest.config.js',
    'rollup.config.mjs',
    'esbuild.config.cjs',
    '.eslintrc',
    '.eslintrc.json',
    '.prettierrc',
    '.prettierrc.yaml',
    '.github/workflows/ci.yml',
    'docker-compose.yml',
    'docker-compose.override.yaml',
    'Dockerfile',
    '.env',
    '.env.local',
    '.env.production',
    'src/index.ts',
    'src/index.tsx',
    'src/index.js',
    'apps/web/src/index.ts',
  ])('%s → wiring', (path) => {
    expect(classifyFile(path)).toBe('wiring');
  });
});

describe('classifyFile — core', () => {
  it.each([
    'src/service.ts',
    'src/modules/reviews/intent.service.ts',
    'lib/utils.ts',
    'components/Button.tsx',
    'server/api.ts',
  ])('%s → core', (path) => {
    expect(classifyFile(path)).toBe('core');
  });
});

// ---------------------------------------------------------------------------
// Constants sanity checks
// ---------------------------------------------------------------------------

it('BOILERPLATE_PATTERNS is a non-empty array of RegExp', () => {
  expect(Array.isArray(BOILERPLATE_PATTERNS)).toBe(true);
  expect(BOILERPLATE_PATTERNS.length).toBeGreaterThan(0);
  for (const p of BOILERPLATE_PATTERNS) {
    expect(p).toBeInstanceOf(RegExp);
  }
});

it('WIRING_PATTERNS is a non-empty array of RegExp', () => {
  expect(Array.isArray(WIRING_PATTERNS)).toBe(true);
  expect(WIRING_PATTERNS.length).toBeGreaterThan(0);
  for (const p of WIRING_PATTERNS) {
    expect(p).toBeInstanceOf(RegExp);
  }
});

it('SPLIT_TOO_BIG_LINES is 500', () => {
  expect(SPLIT_TOO_BIG_LINES).toBe(500);
});

it('SPLIT_MIN_FILES is 2', () => {
  expect(SPLIT_MIN_FILES).toBe(2);
});

// ---------------------------------------------------------------------------
// assembleSmartDiff — group ordering
// ---------------------------------------------------------------------------

describe('assembleSmartDiff', () => {
  it('orders groups core → wiring → boilerplate, drops empty groups', () => {
    const files = [
      { path: 'pnpm-lock.yaml', additions: 10, deletions: 5 },
      { path: 'src/service.ts', additions: 20, deletions: 3 },
      { path: 'tsconfig.json', additions: 2, deletions: 0 },
    ];
    const result = assembleSmartDiff(files, new Map());
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
  });

  it('drops empty groups (boilerplate-only input)', () => {
    const files = [{ path: 'pnpm-lock.yaml', additions: 5, deletions: 0 }];
    const result = assembleSmartDiff(files, new Map());
    expect(result.groups.map((g) => g.role)).toEqual(['boilerplate']);
  });

  it('maps finding_annotations (sorted by line ascending) from annotationsByPath', () => {
    const files = [{ path: 'src/service.ts', additions: 10, deletions: 2 }];
    const annotationsByPath = new Map([
      [
        'src/service.ts',
        [
          { line: 30, severity: 'warning' as const, finding_id: 'f1' },
          { line: 10, end_line: 15, severity: 'critical' as const, finding_id: 'f2' },
          { line: 20, severity: 'suggestion' as const, finding_id: 'f3' },
        ],
      ],
    ]);
    const result = assembleSmartDiff(files, annotationsByPath);
    const coreFile = result.groups[0]!.files[0]!;
    expect(coreFile.finding_annotations.map((a) => a.line)).toEqual([10, 20, 30]);
    expect(coreFile.finding_annotations[0]).toMatchObject({ line: 10, end_line: 15, severity: 'critical', finding_id: 'f2' });
    expect(coreFile.finding_annotations[1]).toMatchObject({ line: 20, severity: 'suggestion', finding_id: 'f3' });
    expect(coreFile.finding_annotations[2]).toMatchObject({ line: 30, severity: 'warning', finding_id: 'f1' });
  });

  it('finding_annotations is empty for a file with no findings', () => {
    const files = [{ path: 'src/service.ts', additions: 5, deletions: 1 }];
    const result = assembleSmartDiff(files, new Map());
    expect(result.groups[0]!.files[0]!.finding_annotations).toEqual([]);
  });

  it('pseudocode_summary is null for every file', () => {
    const files = [{ path: 'src/util.ts', additions: 1, deletions: 0 }];
    const result = assembleSmartDiff(files, new Map());
    expect(result.groups[0]!.files[0]!.pseudocode_summary).toBeNull();
  });

  // ---- split_suggestion ---------------------------------------------------

  it('too_big is false when total_lines <= SPLIT_TOO_BIG_LINES', () => {
    // Each file: additions + deletions = 250; 2 files = 500 (not strictly >)
    const files = [
      { path: 'src/a.ts', additions: 200, deletions: 50 },
      { path: 'src/b.ts', additions: 200, deletions: 50 },
    ];
    const result = assembleSmartDiff(files, new Map());
    expect(result.split_suggestion.too_big).toBe(false);
    expect(result.split_suggestion.proposed_splits).toEqual([]);
  });

  it('too_big is true when total_lines > SPLIT_TOO_BIG_LINES AND files.length >= SPLIT_MIN_FILES', () => {
    // 501 lines total, 2 files
    const files = [
      { path: 'src/a.ts', additions: 300, deletions: 100 },
      { path: 'src/b.ts', additions: 100, deletions: 1 },
    ];
    const result = assembleSmartDiff(files, new Map());
    expect(result.split_suggestion.too_big).toBe(true);
    expect(result.split_suggestion.total_lines).toBe(501);
    expect(result.split_suggestion.proposed_splits.length).toBeGreaterThan(0);
  });

  it('too_big is false when lines > threshold but only 1 file (< SPLIT_MIN_FILES)', () => {
    const files = [{ path: 'src/a.ts', additions: 600, deletions: 0 }];
    const result = assembleSmartDiff(files, new Map());
    expect(result.split_suggestion.too_big).toBe(false);
  });

  it('proposed_splits contains one entry per non-empty role when too_big', () => {
    const files = [
      { path: 'src/a.ts', additions: 300, deletions: 0 },       // core
      { path: 'pnpm-lock.yaml', additions: 200, deletions: 2 }, // boilerplate
    ];
    const result = assembleSmartDiff(files, new Map());
    expect(result.split_suggestion.too_big).toBe(true);
    const splitNames = result.split_suggestion.proposed_splits.map((s) => s.name);
    expect(splitNames).toContain('core');
    expect(splitNames).toContain('boilerplate');
    expect(splitNames).not.toContain('wiring'); // wiring group is empty
  });

  it('result satisfies SmartDiff.parse', () => {
    const files = [
      { path: 'src/service.ts', additions: 10, deletions: 2 },
      { path: 'pnpm-lock.yaml', additions: 5, deletions: 0 },
      { path: 'tsconfig.json', additions: 1, deletions: 0 },
    ];
    const annotationsByPath = new Map([
      [
        'src/service.ts',
        [
          { line: 5, severity: 'warning' as const, finding_id: 'fa' },
          { line: 12, severity: 'critical' as const, finding_id: 'fb' },
        ],
      ],
    ]);
    const result = assembleSmartDiff(files, annotationsByPath);
    expect(() => SmartDiff.parse(result)).not.toThrow();
  });

  // ---- end_line passthrough -------------------------------------------------

  it('passes end_line unchanged for a single-line finding (end_line === line)', () => {
    const files = [{ path: 'src/service.ts', additions: 5, deletions: 1 }];
    const annotationsByPath = new Map([
      [
        'src/service.ts',
        [{ line: 7, end_line: 7, severity: 'critical' as const, finding_id: 'f-single' }],
      ],
    ]);
    const result = assembleSmartDiff(files, annotationsByPath);
    const a = result.groups[0]!.files[0]!.finding_annotations[0]!;
    expect(a.line).toBe(7);
    expect(a.end_line).toBe(7);
  });

  it('passes end_line: null unchanged', () => {
    const files = [{ path: 'src/service.ts', additions: 3, deletions: 0 }];
    const annotationsByPath = new Map([
      [
        'src/service.ts',
        [{ line: 5, end_line: null, severity: 'suggestion' as const, finding_id: 'f-null' }],
      ],
    ]);
    const result = assembleSmartDiff(files, annotationsByPath);
    expect(result.groups[0]!.files[0]!.finding_annotations[0]!.end_line).toBeNull();
  });

  it('preserves end_line as undefined when the field is omitted', () => {
    const files = [{ path: 'src/service.ts', additions: 3, deletions: 0 }];
    const annotationsByPath = new Map([
      [
        'src/service.ts',
        [{ line: 5, severity: 'suggestion' as const, finding_id: 'f-undef' }],
      ],
    ]);
    const result = assembleSmartDiff(files, annotationsByPath);
    expect(result.groups[0]!.files[0]!.finding_annotations[0]!.end_line).toBeUndefined();
  });

  it('result satisfies SmartDiff.parse with null, explicit equal, and missing end_line values', () => {
    const files = [{ path: 'src/svc.ts', additions: 5, deletions: 1 }];
    const annotationsByPath = new Map([
      [
        'src/svc.ts',
        [
          { line: 3, end_line: 3, severity: 'critical' as const, finding_id: 'fa' },
          { line: 5, end_line: null, severity: 'warning' as const, finding_id: 'fb' },
          { line: 8, severity: 'suggestion' as const, finding_id: 'fc' },
        ],
      ],
    ]);
    const result = assembleSmartDiff(files, annotationsByPath);
    expect(() => SmartDiff.parse(result)).not.toThrow();
  });
});
