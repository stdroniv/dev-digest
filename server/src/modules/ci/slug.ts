/**
 * Slug derivation + uniqueness (AC-15) shared by the agent manifest/workflow
 * filenames (`.devdigest/agents/<slug>.yaml`,
 * `.github/workflows/devdigest-review-<slug>.yml`, AC-16) and each linked
 * skill's bundled file (`.devdigest/skills/<slug>.md`).
 */

const FALLBACK_SLUG = 'agent';

/** Lowercase, ASCII, hyphen-separated. Never returns an empty string — falls back to `FALLBACK_SLUG` (e.g. an all-emoji/all-punctuation name). */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics after NFKD decomposition
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : FALLBACK_SLUG;
}

/**
 * Hands out a unique slug per `name`, appending `-2`, `-3`, … on collision —
 * including two DIFFERENT names that slugify identically (AC-15).
 *
 * Input contract (documented for T6, which wires the DB): seed with slugs
 * already taken by OTHER agents/skills the new slug must not collide with —
 * for the agent slug, that's every other exported agent's derived slug in
 * the workspace; for a bundle's skill slugs, an allocator is normally seeded
 * empty (skill files live in their own `.devdigest/skills/` namespace, so
 * they only need to be unique against EACH OTHER within the same bundle).
 * Crucially, the seed set passed for the AGENT slug must EXCLUDE this same
 * agent's own previously-derived slug, so re-exporting the same agent keeps
 * producing the same slug and stays idempotent (AC-17) — only a genuinely
 * different agent's slug should ever force a disambiguating suffix.
 */
export class SlugAllocator {
  private readonly taken: Set<string>;

  constructor(existingSlugs: Iterable<string> = []) {
    this.taken = new Set(existingSlugs);
  }

  allocate(name: string): string {
    const base = slugify(name);
    if (!this.taken.has(base)) {
      this.taken.add(base);
      return base;
    }
    let n = 2;
    while (this.taken.has(`${base}-${n}`)) n++;
    const slug = `${base}-${n}`;
    this.taken.add(slug);
    return slug;
  }
}
