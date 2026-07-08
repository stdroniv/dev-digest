/**
 * Pure, zero-LLM eval scorer (AC-11/AC-12/AC-20/AC-21). Every export here is a
 * pure function of its arguments — no DB, no filesystem, no network, no LLM
 * calls — so scoring is fast, deterministic, and reproducible.
 */
export { normalizePath } from './normalize.js';
export { rangesOverlap, matchFinding, type ScorableFinding } from './match.js';
export { computeRecall, computePrecision, computeCitationAccuracy } from './metrics.js';
export { aggregate, type PerCaseScore, type AggregateResult } from './aggregate.js';
