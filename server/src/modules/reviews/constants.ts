/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/**
 * Determinism seed forwarded to the LLM on every review (see
 * `StructuredRequest.seed`). A FIXED int (not a per-PR hash) maximises
 * reproducibility: re-running the same PR draws the same sampling. Pairs with
 * OpenRouter provider pinning so a byte-identical prompt stops flipping verdicts
 * across runs.
 */
export const REVIEW_SEED = 1729;

/**
 * False-negative guard. When a single-pass review returns 0 findings, take this
 * many ADDITIONAL (perturbed) samples and merge — so one lazy empty draw on a
 * cheap/non-deterministic model can't silently auto-approve a buggy PR. 0 = off.
 */
export const REVIEW_RESAMPLE_ON_EMPTY = 1;

/**
 * Cheap/distilled model tiers prone to lazy short completions. Using one as a
 * merge gate (`ciFailOn !== 'never'`) is the setup that produced the silent
 * auto-approve — we only WARN (log-only nudge), never block.
 */
export const FLASH_TIER_MODEL_RE = /(?:^|[-/])(flash|mini|nano|cheap|free)\b/i;
