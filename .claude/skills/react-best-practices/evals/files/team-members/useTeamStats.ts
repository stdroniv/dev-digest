import { useMemo } from 'react';

interface Member {
  id: string;
  name: string;
  avatarUrl: string;
  status: 'active' | 'invited' | 'suspended';
}

export function useTeamStats(members: Member[]) {
  const activeCount = useMemo(
    () => members.filter((m) => m.status === 'active').length,
    [members],
  );

  const activePercentage = useMemo(() => {
    if (members.length === 0) return 0;
    return Math.round((activeCount / members.length) * 100);
  }, [members, activeCount]);

  return { activeCount, activePercentage };
}
