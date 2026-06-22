/** Constants for the skills module. */

/**
 * First committed body version. Creation persists a skill at v1 with an immutable
 * v1 snapshot (the client defers the POST until the user's first Save, so the
 * scaffold body never reaches the server). Each subsequent body edit bumps from here.
 */
export const INITIAL_SKILL_VERSION = 1;

/**
 * Rolling window (in days) for the time-bounded Stats-tab metrics — pull
 * frequency, accept rate, and the findings count/breakdown. The "Findings (30D)"
 * card name reflects this default.
 */
export const SKILL_STATS_WINDOW_DAYS = 30;
