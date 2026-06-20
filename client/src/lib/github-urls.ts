/* github-urls.ts — build github.com deep-links from data we already hold.
   PR detail has repo full_name (owner/repo), PR number, head sha, and finding
   file/line — enough to open the PR or a file blob at a line range in a new tab. */

const HOST = "https://github.com";

/** Encode a repo-relative path for a URL while keeping "/" separators. */
function encPath(file: string): string {
  return file
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

/** https://github.com/{owner}/{repo}/pull/{number} */
export function githubPrUrl(repoFullName: string, number: number): string {
  return `${HOST}/${repoFullName}/pull/${number}`;
}

/**
 * https://github.com/{owner}/{repo}/blob/{sha}/{file}#L{start}[-L{end}]
 * `sha` pins the link to the PR's head so line numbers stay accurate.
 */
export function githubBlobUrl(
  repoFullName: string,
  sha: string,
  file: string,
  startLine?: number,
  endLine?: number,
): string {
  let url = `${HOST}/${repoFullName}/blob/${sha}/${encPath(file)}`;
  if (startLine != null) {
    url += `#L${startLine}`;
    if (endLine != null && endLine !== startLine) url += `-L${endLine}`;
  }
  return url;
}

/**
 * https://github.com/{owner}/{repo}/pull/{number}/files[#diff-{pathSha}R{start}[-R{end}]]
 *
 * Links a finding's file:line to the PR's "Files changed" diff. Prefer this over
 * {@link githubBlobUrl}: the Files view is owned by the BASE repo, so it resolves even
 * for fork PRs (whose head sha lives on the fork, not the base repo). The `#diff-…`
 * anchor is GitHub's diff hash — the SHA-256 hex of the repo-relative path — and `R{line}`
 * targets the added/right side of the diff. When `pathSha` is omitted (e.g. the hash hasn't
 * been computed yet) the bare `/files` URL is returned, which is always valid.
 */
export function githubPrFileUrl(
  repoFullName: string,
  number: number,
  file: string,
  startLine?: number,
  endLine?: number,
  pathSha?: string,
): string {
  let url = `${HOST}/${repoFullName}/pull/${number}/files`;
  if (pathSha) {
    url += `#diff-${pathSha}`;
    if (startLine != null) {
      url += `R${startLine}`;
      if (endLine != null && endLine !== startLine) url += `-R${endLine}`;
    }
  }
  return url;
}

/**
 * SHA-256 hex of a string via the Web Crypto API. Used to build the `#diff-<hash>` anchor
 * for {@link githubPrFileUrl}. Returns "" when `crypto.subtle` is unavailable (insecure
 * context / jsdom) so callers fall back to the bare `/files` URL instead of throwing.
 */
export async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
