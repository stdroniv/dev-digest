/* lib/agent-visuals.ts — deterministic client-side agent icon/color map
   (SPEC-05 Q8). Agents have no icon/color column (server/src/db/schema/agents.ts)
   — the Multi-Agent Review design colours each agent's column/tab, so this is
   purely a display concern, computed here and never persisted. */
import type { IconName } from "@devdigest/ui";

interface AgentVisual {
  color: string;
  icon: IconName;
}

/** The design palette (plan "Design → real primitive map" / T13). Order is the
 *  deterministic hash fallback's index space — do not reorder existing
 *  entries (would flip every agent that falls through to the hash fallback). */
const PALETTE: readonly AgentVisual[] = [
  { color: "#ef4444", icon: "Shield" }, // security
  { color: "#f59e0b", icon: "Zap" }, // performance
  { color: "#3b82f6", icon: "Lightbulb" }, // mentor
  { color: "#8b5cf6", icon: "Users" }, // customer-facing
  { color: "#10b981", icon: "Boxes" }, // architecture
];

// `noUncheckedIndexedAccess` types every `PALETTE[i]` as possibly `undefined`
// even though every index used below is provably in range (a fixed non-empty
// literal array, indexed by `rule.index` from the co-located KEYWORD_RULES or
// by `hash % PALETTE.length`). One named, well-scoped fallback avoids
// sprinkling non-null assertions at each call site.
const FALLBACK: AgentVisual = PALETTE[0]!;

/** Keyword → palette index, checked in this order against the lowercased
 *  agent name (first match wins). Mirrors the plan's named examples. */
const KEYWORD_RULES: ReadonlyArray<{ keyword: string; index: number }> = [
  { keyword: "security", index: 0 },
  { keyword: "performance", index: 1 },
  { keyword: "mentor", index: 2 },
  { keyword: "customer", index: 3 },
  { keyword: "architecture", index: 4 },
];

/** Small, stable string hash (djb2) — same id always yields the same index,
 *  with no dependency on insertion order/Map iteration/Date, so the mapping
 *  is stable across renders, reloads, and sessions. */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * Deterministic visual (icon + color) for an agent, keyword-matched against
 * common review-agent personas first, falling back to a stable hash-of-id
 * index into the same palette so every agent — including custom ones — gets
 * a consistent, valid look.
 */
export function agentVisual(agent: { id: string; name: string }): AgentVisual {
  const name = agent.name.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (name.includes(rule.keyword)) return PALETTE[rule.index] ?? FALLBACK;
  }
  return PALETTE[hashString(agent.id) % PALETTE.length] ?? FALLBACK;
}
