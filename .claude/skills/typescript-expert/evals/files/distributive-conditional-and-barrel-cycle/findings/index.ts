/**
 * Barrel file for the `findings` module.
 */
export * from './finding.js';

// Re-exports a helper that actually lives in the `reviewers` module, so
// consumers of `findings` can do `import { summarizeForReviewer } from
// '.../findings'` without knowing it's really a reviewers concern.
export { summarizeForReviewer } from '../reviewers/index.js';
