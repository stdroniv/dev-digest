import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Bundle the CI agent-runner into a single, dependency-free ESM file that
 * ships COMMITTED at `dist/runner.mjs` (AC-4/AC-29 — the generated workflow
 * runs `node .devdigest/runner.mjs` directly with no `npm install` step and
 * no marketplace action; every dependency, including the aliased
 * `@devdigest/reviewer-core` source and `@devdigest/shared` vendored
 * contracts, is inlined here).
 *
 * esbuild is a deliberate substitution for the `@vercel/ncc` named in
 * reviewer-core's header comment (plan Q1) — ncc is not wired anywhere in
 * this repo; esbuild is simpler, faster, already used by this repo's own
 * tooling (vitest/tsx), and is pre-approved as a build-script dependency
 * (see `pnpm.onlyBuiltDependencies` in package.json + `pnpm-workspace.yaml`).
 * Noting the divergence here so it reads as a deliberate choice, not drift.
 */
await build({
  entryPoints: [resolve(__dirname, 'src/runner.ts')],
  outfile: resolve(__dirname, 'dist/runner.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'info',
});

console.log('[devdigest] runner bundled -> dist/runner.mjs');
