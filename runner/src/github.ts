/**
 * Minimal fetch-based GitHub REST client (plan Q5) — the runner does NOT
 * bundle octokit/the server's `OctokitGitHubClient`. Three operations only:
 * fetch a PR's diff, post a verdict-carrying review, post a plain comment.
 * Uses the CI-provided `GITHUB_TOKEN` exclusively; never touches the LLM
 * secret. Every call is least-privilege (`contents: read` +
 * `pull-requests: write`, matching the generated workflow's `permissions:`
 * block — AC-25).
 */

export interface RepoRef {
  owner: string;
  name: string;
}

export interface GitHubReviewPayload {
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments?: { path: string; line: number; body: string }[];
}

const DEFAULT_API_URL = 'https://api.github.com';

export class GitHubRestError extends Error {}

export class RunnerGitHubClient {
  private readonly baseUrl: string;

  constructor(
    private readonly token: string,
    apiUrl: string = process.env.GITHUB_API_URL ?? DEFAULT_API_URL,
  ) {
    this.baseUrl = apiUrl.replace(/\/$/, '');
  }

  private headers(accept: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'devdigest-ci-runner',
    };
  }

  /** Fetch a PR's unified diff as raw text (GitHub's diff media type). */
  async getPullRequestDiff(repo: RepoRef, prNumber: number): Promise<string> {
    const res = await fetch(`${this.baseUrl}/repos/${repo.owner}/${repo.name}/pulls/${prNumber}`, {
      headers: this.headers('application/vnd.github.v3.diff'),
    });
    if (!res.ok) {
      throw new GitHubRestError(
        `GitHub: failed to fetch PR #${prNumber} diff (${res.status} ${res.statusText})`,
      );
    }
    return res.text();
  }

  /** Post a GitHub review carrying a verdict (APPROVE/REQUEST_CHANGES/COMMENT). */
  async createReview(
    repo: RepoRef,
    prNumber: number,
    payload: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    const res = await fetch(
      `${this.baseUrl}/repos/${repo.owner}/${repo.name}/pulls/${prNumber}/reviews`,
      {
        method: 'POST',
        headers: { ...this.headers('application/vnd.github+json'), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: payload.body,
          event: payload.event,
          ...(payload.comments?.length ? { comments: payload.comments } : {}),
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GitHubRestError(
        `GitHub: failed to create review on PR #${prNumber} (${res.status} ${res.statusText}) ${text}`,
      );
    }
    const json = (await res.json()) as { id: number };
    return { id: String(json.id) };
  }

  /** Post a plain PR/issue comment (the "pr_comment" post-as option). */
  async createIssueComment(repo: RepoRef, prNumber: number, body: string): Promise<{ id: string }> {
    const res = await fetch(
      `${this.baseUrl}/repos/${repo.owner}/${repo.name}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        headers: { ...this.headers('application/vnd.github+json'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GitHubRestError(
        `GitHub: failed to create comment on PR #${prNumber} (${res.status} ${res.statusText}) ${text}`,
      );
    }
    const json = (await res.json()) as { id: number };
    return { id: String(json.id) };
  }
}
