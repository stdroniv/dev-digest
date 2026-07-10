import { cache } from 'react';

export type Finding = {
  id: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  createdAt: Date;
};

export type FindingComment = { id: string; body: string };
export type FindingAuthor = { name: string; avatarUrl: string };

// Correctly memoized so generateMetadata and the page component share one fetch.
export const getFinding = cache(async (findingId: string): Promise<Finding> => {
  const res = await fetch(`https://api.internal.devdigest.dev/findings/${findingId}`);
  return res.json();
});

export async function getFindingComments(findingId: string): Promise<FindingComment[]> {
  const res = await fetch(`https://api.internal.devdigest.dev/findings/${findingId}/comments`);
  return res.json();
}

export async function getFindingAuthor(findingId: string): Promise<FindingAuthor> {
  const res = await fetch(`https://api.internal.devdigest.dev/findings/${findingId}/author`);
  return res.json();
}
