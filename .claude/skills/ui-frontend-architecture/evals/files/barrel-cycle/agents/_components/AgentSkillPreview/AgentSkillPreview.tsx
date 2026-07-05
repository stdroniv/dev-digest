// Conceptual path:
// client/src/app/agents/_components/AgentSkillPreview/AgentSkillPreview.tsx
//
// Shows a small preview of the skill an agent is currently using. Reaches
// across into the skills route's public barrel to grab SkillCard.

import { SkillCard } from '@/app/skills/_components';

export function AgentSkillPreview({ skillId }: { skillId: string }) {
  return (
    <div>
      <SkillCard skillId={skillId} compact />
    </div>
  );
}
