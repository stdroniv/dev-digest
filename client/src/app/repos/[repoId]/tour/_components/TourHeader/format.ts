/** "last refreshed" display string — ALWAYS derived from the real
   `generatedAt` timestamp (§Non-functional), never fabricated. */
export function formatRefreshedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
