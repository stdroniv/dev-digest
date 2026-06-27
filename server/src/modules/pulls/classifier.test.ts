import { describe, it, expect } from 'vitest';
import { classifyFile } from '../reviews/smart-diff.classify.js';

describe('classifyFile – boilerplate', () => {
  it('pnpm-lock.yaml → boilerplate', () => {
    expect(classifyFile('pnpm-lock.yaml')).toBe('boilerplate');
  });

  it('0001_migration.sql → boilerplate', () => {
    expect(classifyFile('0001_migration.sql')).toBe('boilerplate');
  });

  it('dist/bundle.js → boilerplate', () => {
    expect(classifyFile('dist/bundle.js')).toBe('boilerplate');
  });

  it('src/__snapshots__/service.test.ts.snap → boilerplate', () => {
    expect(classifyFile('src/__snapshots__/service.test.ts.snap')).toBe('boilerplate');
  });

  it('vendor/some-lib/index.js → boilerplate', () => {
    expect(classifyFile('vendor/some-lib/index.js')).toBe('boilerplate');
  });
});

describe('classifyFile – wiring', () => {
  it('src/index.ts → wiring', () => {
    expect(classifyFile('src/index.ts')).toBe('wiring');
  });

  it('package.json → wiring', () => {
    expect(classifyFile('package.json')).toBe('wiring');
  });

  it('tsconfig.json → wiring', () => {
    expect(classifyFile('tsconfig.json')).toBe('wiring');
  });

  it('vite.config.ts → wiring', () => {
    expect(classifyFile('vite.config.ts')).toBe('wiring');
  });

  it('.github/workflows/ci.yml → wiring', () => {
    expect(classifyFile('.github/workflows/ci.yml')).toBe('wiring');
  });
});

describe('classifyFile – core', () => {
  it('src/modules/reviews/service.ts → core', () => {
    expect(classifyFile('src/modules/reviews/service.ts')).toBe('core');
  });

  it('src/components/Button.tsx → core', () => {
    expect(classifyFile('src/components/Button.tsx')).toBe('core');
  });

  it('src/utils/helpers.ts → core', () => {
    expect(classifyFile('src/utils/helpers.ts')).toBe('core');
  });

  it('src/api/routes/users.ts → core', () => {
    expect(classifyFile('src/api/routes/users.ts')).toBe('core');
  });

  it('src/db/schema.ts → core', () => {
    expect(classifyFile('src/db/schema.ts')).toBe('core');
  });
});
