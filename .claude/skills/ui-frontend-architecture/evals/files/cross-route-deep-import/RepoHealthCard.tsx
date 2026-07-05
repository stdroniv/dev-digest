// Conceptual path: client/src/app/repos/[repoId]/_components/RepoHealthCard/RepoHealthCard.tsx
//
// Renders a summary card on the repo overview page showing the repo's recent
// review health, plus a small badge borrowed from the skills route to show
// which skill flagged the most findings this week.

import { useRepoHealth } from '@/lib/hooks/repos';
// Deep-imports another route's private, colocated component instead of going
// through shared code or composing at a higher level.
import { SkillBadge } from '@/app/skills/_components/SkillBadge/SkillBadge';

export function RepoHealthCard({ repoId }: { repoId: string }) {
  const { data } = useRepoHealth(repoId);

  if (!data) return null;

  return (
    <div>
      <h3>{data.repoName}</h3>
      <p>{data.openFindings} open findings</p>
      {data.topSkillId && <SkillBadge skillId={data.topSkillId} />}
    </div>
  );
}
