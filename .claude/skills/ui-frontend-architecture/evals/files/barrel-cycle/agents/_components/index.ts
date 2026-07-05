// Conceptual path: client/src/app/agents/_components/index.ts
//
// A barrel re-exporting this route's colocated components. DevDigest's own
// convention avoids in-folder barrels for feature/route components (one file
// per component, named exports, imported directly) — this file introduces
// one anyway.

export { AgentCard } from './AgentCard/AgentCard';
export { AgentSkillPreview } from './AgentSkillPreview/AgentSkillPreview';
