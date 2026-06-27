import { z } from 'zod';
import { Severity, FindingCategory, Provider, ReviewStrategy } from '@devdigest/shared';

/**
 * Zod input/output shapes for the 5 tools — thin projections of the vendored
 * contracts (`Severity`, `FindingCategory`, `Provider`, `ReviewStrategy` are
 * reused verbatim so the wire contract tracks the same enums that drive the API
 * + LLM output). Inputs are RAW SHAPES (the SDK's `registerTool` wraps + validates
 * them and converts to JSON Schema for `tools/list`); outputs are raw shapes too,
 * validated against `structuredContent` by the SDK.
 *
 * Every input field carries a `.describe(...)` so a new client can call the tool
 * correctly without reading docs.
 */

// ---- shared output sub-objects -------------------------------------------

/** A finding projection. `concise` populates the head fields; `detailed` also
 *  fills rationale/suggestion/confidence (optional so one schema serves both). */
export const FindingOut = z.object({
  id: z.string(),
  severity: Severity,
  category: FindingCategory,
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string().optional(),
  suggestion: z.string().nullable().optional(),
  confidence: z.number().optional(),
});
export type FindingOut = z.infer<typeof FindingOut>;

export const SeveritySummary = z.object({
  critical: z.number().int(),
  warning: z.number().int(),
  suggestion: z.number().int(),
  total: z.number().int(),
  blockers: z.number().int(),
});
export type SeveritySummary = z.infer<typeof SeveritySummary>;

export const RunStatus = z.enum(['done', 'failed', 'cancelled', 'running']);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunOut = z.object({
  run_id: z.string(),
  agent_name: z.string(),
  status: RunStatus,
  error: z.string().nullable(),
});
export type RunOut = z.infer<typeof RunOut>;

// ================================================================ list_agents

export const listAgentsInput = {
  enabled_only: z
    .boolean()
    .default(false)
    .describe('When true, return only agents that are currently enabled to run.'),
} satisfies z.ZodRawShape;
export const ListAgentsInput = z.object(listAgentsInput);
export type ListAgentsInput = z.infer<typeof ListAgentsInput>;

export const AgentOut = z.object({
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  strategy: ReviewStrategy,
  provider: Provider,
  model: z.string(),
});
export type AgentOut = z.infer<typeof AgentOut>;

export const listAgentsOutput = {
  agents: z.array(AgentOut),
  count: z.number().int(),
} satisfies z.ZodRawShape;

// ================================================================== review_pr

export const reviewPrInput = {
  pr: z.string().describe('Pull request reference `owner/repo#number` (e.g. acme/payments-api#482).'),
  agent: z
    .string()
    .optional()
    .describe(
      'Exact agent name (case-insensitive) from devdigest_list_agents. Omit and set all:true to run all enabled agents.',
    ),
  all: z.boolean().default(false).describe('Run every enabled agent on the PR.'),
  response_format: z
    .enum(['concise', 'detailed'])
    .default('concise')
    .describe(
      '`concise` = file:line + severity + title per finding; `detailed` adds rationale + suggestion.',
    ),
  timeout_seconds: z
    .number()
    .int()
    .min(10)
    .max(600)
    .default(120)
    .describe('Max seconds to block before returning a still-running result.'),
} satisfies z.ZodRawShape;
export const ReviewPrInput = z.object(reviewPrInput);
export type ReviewPrInput = z.infer<typeof ReviewPrInput>;

export const reviewPrOutput = {
  pr: z.string(),
  completed: z.boolean(),
  runs: z.array(RunOut),
  summary: SeveritySummary,
  findings: z.array(FindingOut),
  message: z.string().nullable(),
} satisfies z.ZodRawShape;

// =============================================================== get_findings

export const getFindingsInput = {
  pr: z.string().describe('Pull request reference `owner/repo#number`.'),
  agent: z
    .string()
    .optional()
    .describe(
      "Restrict to one agent's findings (by name). Findings have no agent column — attribution flows through the review's agent.",
    ),
  severity: Severity.optional().describe('Restrict to findings of this severity.'),
  category: FindingCategory.optional().describe('Restrict to findings of this category.'),
  file: z.string().optional().describe('Restrict to findings whose `file` equals this path.'),
  include_dismissed: z
    .boolean()
    .default(false)
    .describe('Include findings the user dismissed.'),
  all_runs: z
    .boolean()
    .default(false)
    .describe(
      "Include historical reviews; default keeps only the newest review per agent so re-runs don't duplicate findings.",
    ),
  response_format: z
    .enum(['concise', 'detailed'])
    .default('concise')
    .describe('`concise` = head fields only; `detailed` adds rationale + suggested fix.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Max findings to return in this page.'),
  cursor: z.string().optional().describe('Opaque pagination cursor from a prior response.'),
} satisfies z.ZodRawShape;
export const GetFindingsInput = z.object(getFindingsInput);
export type GetFindingsInput = z.infer<typeof GetFindingsInput>;

export const getFindingsOutput = {
  pr: z.string(),
  findings: z.array(FindingOut),
  total_matched: z.number().int(),
  returned: z.number().int(),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
  truncated_note: z.string().nullable(),
} satisfies z.ZodRawShape;

// ============================================================ get_conventions

export const getConventionsInput = {
  repo: z.string().describe('Repository reference `owner/repo` (e.g. acme/payments-api).'),
  category: z.string().optional().describe('Restrict to one convention category.'),
  response_format: z
    .enum(['summary', 'detailed'])
    .default('summary')
    .describe(
      '`summary` = rule + category + evidence path/lines + confidence; `detailed` adds the evidence snippet.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Max conventions to return in this page.'),
  cursor: z.string().optional().describe('Opaque pagination cursor from a prior response.'),
} satisfies z.ZodRawShape;
export const GetConventionsInput = z.object(getConventionsInput);
export type GetConventionsInput = z.infer<typeof GetConventionsInput>;

export const ConventionOut = z.object({
  rule: z.string(),
  category: z.string().nullable(),
  evidence_path: z.string().nullable(),
  evidence_start_line: z.number().int().nullable(),
  evidence_end_line: z.number().int().nullable(),
  confidence: z.number().nullable(),
  evidence_snippet: z.string().optional(),
});
export type ConventionOut = z.infer<typeof ConventionOut>;

export const getConventionsOutput = {
  repo: z.string(),
  conventions: z.array(ConventionOut),
  total: z.number().int(),
  returned: z.number().int(),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
} satisfies z.ZodRawShape;

// ========================================================== get_blast_radius

export const getBlastRadiusInput = {
  pr: z.string().describe('Pull request reference `owner/repo#number`.'),
  symbol: z
    .string()
    .optional()
    .describe('Restrict to one changed symbol (function/class) by name; omit to analyze all.'),
  direction: z
    .enum(['callers', 'callees', 'both'])
    .default('both')
    .describe('Traverse who calls the symbol, what it calls, or both.'),
  max_depth: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(2)
    .describe('Graph traversal depth.'),
} satisfies z.ZodRawShape;
export const GetBlastRadiusInput = z.object(getBlastRadiusInput);
export type GetBlastRadiusInput = z.infer<typeof GetBlastRadiusInput>;

export const ImpactedOut = z.object({
  file: z.string(),
  symbol: z.string(),
  relation: z.enum(['caller', 'callee']),
  depth: z.number().int(),
});
export type ImpactedOut = z.infer<typeof ImpactedOut>;

export const getBlastRadiusOutput = {
  status: z.enum(['ok', 'not_implemented']),
  message: z.string(),
  pr: z.string().nullable(),
  symbol: z.string().nullable(),
  impacted: z.array(ImpactedOut),
} satisfies z.ZodRawShape;
