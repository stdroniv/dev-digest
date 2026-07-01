import type { AgentDocumentLink, SkillDocumentLink } from '@devdigest/shared';

/**
 * Pure union/dedup/order logic for the run-time "effective document set" (T9,
 * SPEC-01 AC-17/18/19). No I/O — the caller (`run-executor.ts`) resolves the
 * agent's + enabled skills' linked documents and reads their content; this
 * function only decides WHICH paths are in scope, in WHAT order, and tags each
 * with its origin for the run trace (`DocumentRead.origin`).
 */

/** One enabled skill's linked documents, keyed for origin-tagging. Disabled
 *  skills must be filtered out by the CALLER before building this list — this
 *  function has no `enabled` concept of its own (AC-17). */
export interface EnabledSkillDocuments {
  skillId: string;
  skillName: string;
  docs: SkillDocumentLink[];
}

export type EffectiveDocumentOrigin =
  | { type: 'agent' }
  | { type: 'skill'; skill_id: string; skill_name: string };

export interface EffectiveDocument {
  path: string;
  origin: EffectiveDocumentOrigin;
}

/**
 * Compute the effective, ordered, deduped set of documents for a run:
 * - AC-17 (union): the agent's own docs plus every enabled skill's docs.
 * - AC-18 (dedup by path): a path appearing more than once (agent level,
 *   multiple skills, or both) appears exactly once in the output.
 * - AC-19 (order): agent's own docs first (in persisted `order`), then each
 *   skill's docs in the given skill order, then that skill's own doc order.
 *   When dedup collapses a path present at BOTH agent and skill level, it
 *   keeps its AGENT-level position (agent attachment always wins position).
 */
export function computeEffectiveDocuments(
  agentDocs: AgentDocumentLink[],
  enabledSkillDocs: EnabledSkillDocuments[],
): EffectiveDocument[] {
  const seen = new Set<string>();
  const result: EffectiveDocument[] = [];

  const sortedAgentDocs = [...agentDocs].sort((a, b) => a.order - b.order);
  for (const doc of sortedAgentDocs) {
    if (seen.has(doc.path)) continue;
    seen.add(doc.path);
    result.push({ path: doc.path, origin: { type: 'agent' } });
  }

  for (const skill of enabledSkillDocs) {
    const sortedSkillDocs = [...skill.docs].sort((a, b) => a.order - b.order);
    for (const doc of sortedSkillDocs) {
      if (seen.has(doc.path)) continue;
      seen.add(doc.path);
      result.push({
        path: doc.path,
        origin: { type: 'skill', skill_id: skill.skillId, skill_name: skill.skillName },
      });
    }
  }

  return result;
}
