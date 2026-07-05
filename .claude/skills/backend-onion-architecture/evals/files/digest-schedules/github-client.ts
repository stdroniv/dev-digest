/**
 * W2 — thin adapter around the GitHub REST API. This is the only place that
 * should know about `fetch`, base URLs, or the `GITHUB_TOKEN` secret; callers
 * get back plain data, never a Response.
 */
export interface RepoActivitySummary {
  openPrCount: number;
  mergedLast24h: number;
}

export class GithubClient {
  constructor(private token: string, private baseUrl = 'https://api.github.com') {}

  async getRepoActivity(owner: string, repo: string): Promise<RepoActivitySummary> {
    const res = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/pulls?state=all`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status} for ${owner}/${repo}`);
    }
    const pulls = (await res.json()) as Array<{ state: string; merged_at: string | null }>;
    const cutoff = Date.now() - 24 * 60 * 60_000;
    return {
      openPrCount: pulls.filter((p) => p.state === 'open').length,
      mergedLast24h: pulls.filter((p) => p.merged_at && new Date(p.merged_at).getTime() >= cutoff)
        .length,
    };
  }
}
