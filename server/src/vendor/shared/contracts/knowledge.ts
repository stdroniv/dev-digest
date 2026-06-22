import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
  // Derived, server-computed token count of `body` (tokenizer adapter). Not
  // persisted — surfaced so the editor can show how many tokens a skill adds to
  // an agent's prompt. Absent on payloads where it wasn't computed.
  tokens: z.number().int().optional(),
});
export type Skill = z.infer<typeof Skill>;

// One immutable body snapshot from `skill_versions` — every saved body change
// appends a version so eval runs stay reproducible against the exact text scored.
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

// Parsed preview returned by POST /skills/import before anything is persisted.
// The body is treated as untrusted data; executable archive entries are ignored.
export const SkillImportPreview = z.object({
  name: z.string(),
  body: z.string(),
  type: SkillType,
  source: SkillSource,
  tokens: z.number().int(),
  // Non-markdown / executable archive entries that were ignored (never run,
  // never stored) — surfaced so the import drawer can show what was skipped.
  ignored_files: z.array(z.string()),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

// ---- Skill statistics (Stats tab) ----
// Per-skill usage aggregates over a rolling window. Computed on read from the
// agent_skills ⋈ agents ⋈ reviews ⋈ findings join — nothing here is persisted.
export const SkillStatsAgent = z.object({
  id: z.string(),
  name: z.string(),
});
export type SkillStatsAgent = z.infer<typeof SkillStatsAgent>;

export const SkillStatsCategory = z.object({
  category: z.string(),
  count: z.number().int(),
});
export type SkillStatsCategory = z.infer<typeof SkillStatsCategory>;

export const SkillStats = z.object({
  skill_id: z.string(),
  // Rolling window the time-bounded metrics are computed over (days).
  window_days: z.number().int(),
  // Agents linked to this skill via agent_skills (not time-bounded).
  used_by: z.object({
    count: z.number().int(),
    agents: z.array(SkillStatsAgent),
  }),
  // Share of in-window reviews (agent_id not null) produced by an agent that
  // uses this skill. 0 when there were no reviews in the window.
  pull_frequency_pct: z.number(),
  // Of in-window findings from this skill's agents, share accepted out of those
  // decided (accepted + dismissed). 0 when none were decided.
  accept_rate_pct: z.number(),
  // Count of in-window findings from this skill's agents.
  findings_30d: z.number().int(),
  // Those findings grouped by category, descending by count.
  findings_by_category: z.array(SkillStatsCategory),
});
export type SkillStats = z.infer<typeof SkillStats>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions (Conventions Extractor) ----
// A repo coding convention the user lifts into a reusable skill. Two shapes:
//  - ConventionDraft: the RAW LLM output (no id/status — the model never invents
//    those). Each draft must cite the exact file + line range + snippet proving
//    the rule; code-side verification drops any whose evidence doesn't exist.
//  - ConventionCandidate: the persisted / UI DTO (adds id, repo, status, lines).
export const ConventionEvidence = z.object({
  file: z.string(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  snippet: z.string(),
});
export type ConventionEvidence = z.infer<typeof ConventionEvidence>;

export const ConventionDraft = z.object({
  category: z.string(),
  rule: z.string(),
  evidence: ConventionEvidence,
  confidence: z.number().min(0).max(1),
});
export type ConventionDraft = z.infer<typeof ConventionDraft>;

// Wrapper the extractor model returns (a named array makes the json_schema /
// tool-call shape stable across providers).
export const ConventionExtraction = z.object({
  conventions: z.array(ConventionDraft),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;

export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

export const ConventionCandidate = z.object({
  id: z.string(),
  repo_id: z.string().nullable(),
  run_id: z.string().nullable(),
  category: z.string().nullable(),
  rule: z.string(),
  evidence_path: z.string().nullable(),
  evidence_snippet: z.string().nullable(),
  evidence_start_line: z.number().int().nullable(),
  evidence_end_line: z.number().int().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  status: ConventionStatus,
  created_at: z.string(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
