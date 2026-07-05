import { useEffect, useState } from 'react';

export interface Finding {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
}

export interface UseFindingsResult {
  findings: Finding[];
  isLoading: boolean;
  error: string | null;
}

export function useFindings(workspaceId: string, prId: string): UseFindingsResult {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetch(`/api/workspaces/${workspaceId}/prs/${prId}/findings`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setFindings(data.findings);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('failed');
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, prId]);

  return { findings, isLoading, error };
}
