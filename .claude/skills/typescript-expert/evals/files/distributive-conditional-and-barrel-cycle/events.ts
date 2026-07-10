/**
 * Event bus types for the review pipeline (finding added / resolved / review
 * completed). Used to build a single dispatcher that receives any event.
 */

export type ReviewEvent =
  | { kind: 'finding-added'; findingId: string }
  | { kind: 'finding-resolved'; findingId: string; resolvedBy: string }
  | { kind: 'review-completed'; summary: string };

/**
 * Intended meaning: "a handler function that accepts any ReviewEvent".
 * Because this conditional type is written over a bare generic T, TS
 * distributes it across the ReviewEvent union when T = ReviewEvent, so
 * EventHandler<ReviewEvent> does NOT resolve to
 *   (event: ReviewEvent) => void
 * it resolves to the union of three separate handler types:
 *   ((e: {kind:'finding-added'; findingId: string}) => void)
 *   | ((e: {kind:'finding-resolved'; ...}) => void)
 *   | ((e: {kind:'review-completed'; ...}) => void)
 * A value typed as that union only needs to satisfy ONE arm, so a handler
 * that only handles 'finding-added' still type-checks as "the" dispatcher.
 */
export type EventHandler<T> = T extends ReviewEvent ? (event: T) => void : never;

/**
 * This "dispatcher" is meant to accept every ReviewEvent variant, but
 * because of the distribution above, the assignment below type-checks
 * cleanly (verified with `tsc --strict`, zero errors) even though its
 * parameter type only matches the 'finding-added' variant. That's possible
 * because EventHandler<ReviewEvent> is really a UNION of three separate
 * single-variant handler types, and a value only has to satisfy ONE arm of
 * a union to be assignable to it — so a handler for just 'finding-added'
 * silently satisfies "the" ReviewEvent dispatcher, with no compiler
 * complaint about the other two variants never being handled.
 */
export const dispatch: EventHandler<ReviewEvent> = (
  event: { kind: 'finding-added'; findingId: string },
) => {
  console.log(`handled finding: ${event.findingId}`);
};

/**
 * Non-distributive form of the same idea (correct): wrapping T in a tuple
 * suppresses distribution, so this one resolves to a single function type
 * that genuinely accepts the whole ReviewEvent union.
 */
export type NonDistributiveHandler<T> = [T] extends [ReviewEvent] ? (event: T) => void : never;

export const safeDispatch: NonDistributiveHandler<ReviewEvent> = (event) => {
  console.log(`event: ${event.kind}`);
};
