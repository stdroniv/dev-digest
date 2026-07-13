import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors reviewer-core/vitest.config.ts — Vite's resolver doesn't read
      // tsconfig "paths" on its own, so bare-specifier aliases used by
      // src/*.ts (outside the bundled dist smoke test) need an explicit alias.
      '@devdigest/reviewer-core': path.resolve(__dirname, '../reviewer-core/src'),
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
