"use client";

import React from "react";
import { sha256Hex } from "../github-urls";

/**
 * Compute the SHA-256 hex of each file path, for building GitHub PR "Files changed"
 * diff anchors (`#diff-<sha256(path)>` — see {@link githubPrFileUrl}). The digest is
 * async (Web Crypto), so callers render a valid bare `/files` URL immediately and upgrade
 * to the precise anchor once this resolves.
 *
 * Returns `{ [file]: sha }`, or `{}` until the hashes resolve (or when `crypto.subtle` is
 * unavailable, e.g. jsdom / insecure context) so callers fall back to the bare URL.
 */
export function usePathShas(files: string[]): Record<string, string> {
  // Stable, order-independent dep so the effect only re-runs when the SET of paths changes.
  const key = React.useMemo(() => Array.from(new Set(files)).sort().join("\n"), [files]);
  const [shas, setShas] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (typeof crypto === "undefined" || !crypto.subtle) return;
    const unique = key ? key.split("\n") : [];
    if (unique.length === 0) {
      setShas({});
      return;
    }
    let cancelled = false;
    Promise.all(unique.map(async (f) => [f, await sha256Hex(f)] as const))
      .then((pairs) => {
        if (!cancelled) setShas(Object.fromEntries(pairs.filter(([, sha]) => sha)));
      })
      .catch(() => {
        /* leave empty → callers fall back to the bare /files URL */
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return shas;
}
