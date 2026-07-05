'use client';

// Renders a small badge showing the connected GitHub token is present.
const githubToken = process.env.GITHUB_TOKEN;

export function RepoTokenBadge() {
  return (
    <span data-testid="token-badge">
      Connected token: {githubToken ? `${githubToken.slice(0, 6)}...` : 'none'}
    </span>
  );
}
