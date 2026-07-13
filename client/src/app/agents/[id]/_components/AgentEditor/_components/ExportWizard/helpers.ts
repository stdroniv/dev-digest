/** Mirrors the server's `REPO_REF_RE` (`server/src/modules/ci/helpers.ts`) so
 *  the client rejects the same inputs the server would 422 on — keep in sync. */
const REPO_REF_RE = /^([^/]+)\/([^/]+)$/;

export function isValidRepoRef(repo: string): boolean {
  return REPO_REF_RE.test(repo.trim());
}

/** Trigger a browser download of a Blob (AC-10's "Copy files as a zip").
 *  jsdom (the test env) has no `URL.createObjectURL` — guard so tests that
 *  click the zip button don't throw. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
