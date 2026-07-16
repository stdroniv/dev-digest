/** Compact relative time for an installation row's last-run column (e.g.
 *  "4m", "1h", "3d"), combined with the `ciTab.lastRunAgo` i18n key for the
 *  "{value} ago" copy. Mirrors the PR-list's local `relativeTime` helper
 *  (`repos/[repoId]/pulls/helpers.ts`) — kept as its own copy per this
 *  codebase's feature-isolation convention rather than a cross-feature
 *  import. Returns `null` for a never-run installation (`last_run_at` null). */
export function relativeTimeCompact(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
