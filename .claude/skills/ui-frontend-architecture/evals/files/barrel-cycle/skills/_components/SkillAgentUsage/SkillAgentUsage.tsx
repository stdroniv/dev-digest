// Conceptual path:
// client/src/app/skills/_components/SkillAgentUsage/SkillAgentUsage.tsx
//
// Shows which agents currently use this skill. Reaches back across into the
// agents route's public barrel to grab AgentCard — completing a cycle with
// agents/_components/AgentSkillPreview.tsx, which imports from this route's
// barrel in the opposite direction. Neither file's own imports look
// circular in isolation; the cycle only exists once both barrels are
// followed.

import { AgentCard } from '@/app/agents/_components';

export function SkillAgentUsage({ skillId }: { skillId: string }) {
  return (
    <div>
      <AgentCard agentId={`skill-${skillId}-agent`} />
    </div>
  );
}
