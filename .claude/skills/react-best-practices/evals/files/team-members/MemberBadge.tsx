import { memo } from 'react';

interface Member {
  id: string;
  name: string;
  avatarUrl: string;
}

interface MemberBadgeProps {
  member: Member;
  roles: string[];
}

function MemberBadgeImpl({ member, roles }: MemberBadgeProps) {
  return (
    <li className="flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs">
      <img src={member.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
      <span>{member.name}</span>
      <span className="text-neutral-400">({roles.join(', ')})</span>
    </li>
  );
}

export const MemberBadge = memo(MemberBadgeImpl);
