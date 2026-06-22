/* unique-name.ts — pick a name that doesn't collide with an existing set.
   Skill names are unique per workspace (case-insensitive) on the server, so the
   auto-generated default ("new-skill", "repo-conventions") is suffixed " 2", " 3"…
   until it's free, keeping the common create flow from hitting a 409. */

/**
 * Return `base` if it's free (case-insensitively) among `existing`, otherwise the
 * first free `"{base} {n}"` for n = 2, 3, … .
 */
export function uniqueName(existing: readonly string[], base: string): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
