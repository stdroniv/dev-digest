import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '../api.js';

export interface ReviewCommentRecord {
  id: string;
  findingId: string;
  body: string;
  helpfulVotes: number;
  createdAt: string;
}

// Fetches every review comment for a workspace so the PR panel can render
// the discussion thread underneath each finding.
export function useReviewComments(workspaceId: string) {
  return useQuery({
    queryKey: ['reviewComments', workspaceId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/getReviewComments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json();
      return data as ReviewCommentRecord[];
    },
    enabled: !!workspaceId,
  });
}
