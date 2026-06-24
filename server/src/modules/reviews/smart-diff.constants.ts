/**
 * Smart Diff classification constants.
 *
 * Pattern arrays are evaluated in order: BOILERPLATE first, then WIRING,
 * else the file is classified as 'core'.  All patterns are matched against
 * the full file path as returned by GitHub (forward-slash delimited, no
 * leading slash).
 */

/**
 * Patterns that identify boilerplate / generated / vendored files.
 * Lock files, build output, minified assets, snapshots, vendored deps.
 */
export const BOILERPLATE_PATTERNS: RegExp[] = [
  // Lock files
  /(?:^|\/)pnpm-lock\.yaml$/,
  /(?:^|\/)package-lock\.json$/,
  /(?:^|\/)yarn\.lock$/,
  /(?:^|\/)bun\.lockb$/,
  /(?:^|\/)Cargo\.lock$/,
  /(?:^|\/)poetry\.lock$/,
  /(?:^|\/)composer\.lock$/,
  /(?:^|\/)go\.sum$/,
  // Build / generated output directories
  /(?:^|\/)dist\//,
  /(?:^|\/)build\//,
  /(?:^|\/)out\//,
  /(?:^|\/)\.next\//,
  /(?:^|\/)coverage\//,
  // Minified / source-map files
  /\.min\.js$/,
  /\.map$/,
  // Snapshots
  /(?:^|\/)__snapshots__\//,
  /\.snap$/,
  // Vendored dependencies
  /(?:^|\/)vendor\//,
  /(?:^|\/)node_modules\//,
  // Generated files (e.g. foo.generated.ts)
  /\.generated\./,
];

/**
 * Patterns that identify wiring files: configs, manifests, env files,
 * CI definitions, and barrel/index entry points.
 */
export const WIRING_PATTERNS: RegExp[] = [
  // Package manifest
  /(?:^|\/)package\.json$/,
  // TypeScript configs
  /(?:^|\/)tsconfig.*\.json$/,
  // Generic config files (vite.config.ts, jest.config.mjs, etc.)
  /\.config\.(ts|js|mjs|cjs)$/,
  // Linter / formatter configs
  /\.eslintrc/,
  /\.prettierrc/,
  // YAML / YML (CI, workflows, docker-compose, etc.)
  /\.ya?ml$/,
  // Env files
  /(?:^|\/)\.env/,
  // Docker
  /(?:^|\/)Dockerfile$/,
  /(?:^|\/)docker-compose/,
  // GitHub Actions / workflows
  /(?:^|\/)\.github\//,
  // Barrel / entry-point index files
  /(?:^|\/)index\.tsx?$/,
  /(?:^|\/)index\.js$/,
];

/** A diff is considered "too big" when it exceeds this many total changed lines. */
export const SPLIT_TOO_BIG_LINES = 500;

/**
 * The minimum number of files in the diff before a split suggestion is
 * emitted (even if the line count exceeds SPLIT_TOO_BIG_LINES).
 */
export const SPLIT_MIN_FILES = 2;
