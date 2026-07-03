/* affordances.ts — cited-file / command / share-link actions shared across the
   Onboarding Tour section cards (SPEC-02 AC-16/17/18).

   All inputs here (repo-relative paths, shell commands) are UNTRUSTED
   model-derived output (§Untrusted inputs) — they are only ever (a) copied to
   the clipboard as plain text or (b) used to build a GitHub URL opened with
   `noopener,noreferrer`. Nothing is ever executed. */
"use client";

import { notify } from "@/lib/toast";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable/denied (e.g. insecure context) — nothing else
    // we can do locally; the caller's toast simply won't fire.
    return false;
  }
}

/** AC-16: open a cited repo-relative path on the repo's GitHub in a new tab
   when a GitHub URL is known for the repo. AC-17: otherwise fall back to
   copying the path to the clipboard. Never fetches/executes anything. */
export function openOrCopyCited(path: string, githubUrl: string | null | undefined): void {
  if (githubUrl) {
    const url = `${githubUrl}/blob/HEAD/${path}`;
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  void copyText(path).then((ok) => ok && notify.success("Path copied"));
}

/** Copy a "How to run" command to the clipboard. Copy-only — a suggested
   shell command is NEVER auto-executed. */
export function copyCommand(text: string): void {
  void copyText(text).then((ok) => ok && notify.success("Command copied"));
}

/** AC-18: copy a stable local deep-link to this repo's tour. No network call —
   the link is built purely from `window.location.origin` + the repo id. */
export function copyShareLink(repoId: string): void {
  const url = `${window.location.origin}/repos/${repoId}/tour`;
  void copyText(url).then((ok) => ok && notify.success("Link copied"));
}
