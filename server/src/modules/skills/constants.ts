/** Constants for the skills module. */

/**
 * First committed body version. Creation persists a skill at v1 with an immutable
 * v1 snapshot (the client defers the POST until the user's first Save, so the
 * scaffold body never reaches the server). Each subsequent body edit bumps from here.
 */
export const INITIAL_SKILL_VERSION = 1;
