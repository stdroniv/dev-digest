/**
 * Barrel file for the `reviewers` module.
 */
export * from './reviewer.js';

// Re-exports a helper that actually lives in the `findings` module — and
// does so through findings/index.ts, the SIBLING BARREL, not through the
// concrete findings/finding.ts leaf file. Combined with findings/index.ts
// re-exporting `summarizeForReviewer` from THIS barrel, that's a genuine
// file-level back-edge in both directions: reviewers/index.ts ->
// findings/index.ts -> reviewers/index.ts. Importing EITHER barrel pulls in
// the other module's entire barrel transitively — even code that only
// needs `Finding` ends up depth-first evaluating `reviewers/index.ts`
// (and vice versa). This is a true two-barrel cycle, not just a one-way
// dependency through a leaf file, and it slows incremental type-checking
// and can produce "Block-scoped variable used before its declaration" /
// unresolvable circular type errors once a type in one file references a
// type re-exported through the other's barrel.
export { Finding } from '../findings/index.js';
