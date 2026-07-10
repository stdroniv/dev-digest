import { useQuery } from '@tanstack/react-query';
import { fetchWorkspaceMembers } from '../../lib/api/workspace';
import { MemberBadge } from './MemberBadge';
import { TeamCountBadge } from './TeamCountBadge';
import { useTeamStats } from './useTeamStats';

interface TeamMembersPanelProps {
  workspaceId: string;
}

export function TeamMembersPanel({ workspaceId }: TeamMembersPanelProps) {
  const { data: members } = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => fetchWorkspaceMembers(workspaceId),
  });

  const stats = useTeamStats(members ?? []);

  return (
    <section className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Team</h2>
        <TeamCountBadge count={stats.activeCount} />
      </div>
      <ul className="flex flex-wrap gap-2">
        {(members ?? []).map((member) => (
          <MemberBadge key={member.id} member={member} roles={['viewer', 'reviewer']} />
        ))}
      </ul>
    </section>
  );
}
