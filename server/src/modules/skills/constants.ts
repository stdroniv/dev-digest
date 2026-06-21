/** Constants for the skills module. */

/** A freshly-created skill is a DRAFT until its first save: no body snapshot is
 * recorded and the version sits at 0, so the user's first authored save becomes
 * v1 (the auto-scaffold body never burns a version). */
export const DRAFT_SKILL_VERSION = 0;

/** First committed body version — recorded on a skill's first save. */
export const INITIAL_SKILL_VERSION = 1;
