import type {
  Finding,
  Intent,
  LLMProvider,
  PromptAssembly,
  Review,
  RunEventKind,
  UnifiedDiff,
} from '@devdigest/shared';
import { Review as ReviewSchema } from '@devdigest/shared';
import { assemblePrompt } from '../prompt.js';
import { groundFindings, groundingSummary } from '../grounding.js';
import { reduceReviews, scoreFromFindings, sliceDiff, dedupeFindings } from './reduce.js';
import { verdictFromFindings } from '../output/to-review.js';

/**
 * reviewPullRequest — the review engine entry point.
 *
 * given (diff + resolved agent inputs + injected LLM) → grounded Review.
 *
 * This is the pure core lifted out of the server's `ReviewService.runOneAgent`:
 * assemble prompt → single-pass OR map-reduce per file → reduce → SHARED
 * citation-grounding gate. It performs NO I/O beyond the injected LLM provider
 * (no DB, GitHub, fs, memory retrieval, intent, or persistence) — those stay in
 * the caller (server persists + streams SSE; runner posts + writes an artifact).
 *
 * Skill bodies / memory / specs are RESOLVED strings here: the caller turns
 * AgentManifest skill slugs into bodies (DB in the studio, fs in the runner).
 */

/** Default map-reduce threshold (matches the server's FILE_MAP_THRESHOLD_LINES). */
export const DEFAULT_MAP_THRESHOLD_LINES = 400;
/** Default structured-output reprompt retries (matches REVIEW_MAX_RETRIES). */
export const DEFAULT_REVIEW_MAX_RETRIES = 2;

export type ReviewStrategy = 'auto' | 'single-pass' | 'map-reduce';
export type ReviewMode = 'single-pass' | 'map-reduce';

/** Progress event emitted during a review (server → SSE bus, runner → log). */
export interface ReviewEvent {
  kind: RunEventKind;
  msg: string;
  data?: unknown;
}

export interface ReviewInput {
  /** Agent system prompt (trusted). */
  systemPrompt: string;
  /** Model id understood by the injected provider (e.g. 'deepseek/deepseek-v4-flash'). */
  model: string;
  /** The PR's unified diff (already parsed; hunks carry new-side line numbers). */
  diff: UnifiedDiff;
  /** Injected LLM provider (OpenRouter in CI, OpenAI/Anthropic in the studio). */
  llm: LLMProvider;
  /** 'auto' (default) picks single-pass unless the diff is large + multi-file. */
  strategy?: ReviewStrategy;
  /** Resolved skill bodies (NOT slugs). */
  skills?: string[];
  /** Curated memory items. */
  memory?: string[];
  /** Project-context spec chunks (untrusted; delimiter-wrapped downstream). */
  specs?: string[];
  /**
   * Optional callers-of-changed-symbols digest (T1.3). Untrusted; rendered
   * before the diff section. Empty/undefined → section omitted.
   */
  callers?: string;
  /**
   * Optional repo skeleton / map (T3). Untrusted; rendered before the project
   * context section. Empty/undefined → section omitted.
   */
  repoMap?: string;
  /** PR author's description/body (untrusted; truncated + delimiter-wrapped in
      the prompt). Empty/undefined → section omitted. */
  prDescription?: string;
  /**
   * Pre-classified PR intent (the stored Intent row for this PR). When set,
   * formatted into a compact text block and injected into the prompt via the
   * `prIntent` slot in assemblePrompt (with a scope-discipline rule).
   * Omitted → no intent section in the prompt (identical to pre-intent behavior).
   */
  intent?: Intent;
  /** Task framing line, e.g. "Review PR #482 …". */
  task?: string;
  /** Override the structured-output retry budget. */
  maxRetries?: number;
  /** Override the map-reduce line threshold. */
  mapThresholdLines?: number;
  /**
   * OpenRouter session id — forwarded on every LLM call so all chunks of this
   * review group into one session in the OpenRouter dashboard.
   */
  sessionId?: string;
  /**
   * Determinism seed forwarded to the provider (see `StructuredRequest.seed`).
   * Omitted → no seed sent → byte-identical request to today. When the
   * false-negative guard re-samples, each extra draw uses `seed + i + 1` so the
   * samples actually differ.
   */
  seed?: number;
  /**
   * False-negative guard. If a SINGLE-PASS review yields 0 findings, take this
   * many ADDITIONAL samples and merge (worst-verdict + union of findings) so one
   * lazy empty draw can't auto-approve a buggy PR. 0/undefined → off (identical
   * to today). Ignored in map-reduce mode (which already issues one call/file).
   */
  resampleOnEmpty?: number;
  /**
   * Temperature for the re-sample(s). A small positive value adds the diversity
   * needed to escape a deterministic lazy empty — re-sending temperature 0 + the
   * same seed would just reproduce the empty. Default 0.4 when re-sampling.
   */
  resampleTemperature?: number;
  /** Progress sink. */
  onEvent?: (e: ReviewEvent) => void;
  /**
   * Cancellation checkpoint, called before each (expensive) chunk LLM call.
   * Supply a function that THROWS to abort mid-run (the caller owns the error
   * type, e.g. the server's RunCancelledError); the engine stays agnostic.
   */
  checkCancelled?: () => void;
}

export interface ReviewOutcome {
  /** The reduced, GROUNDED review (findings that survived the citation gate). */
  review: Review;
  /** Human-readable grounding summary, e.g. "3/4 passed". */
  grounding: string;
  /** Findings dropped by grounding, with reasons (for logs / "never go silent"). */
  dropped: { finding: Finding; reason: string }[];
  /** Which path ran. */
  mode: ReviewMode;
  /** Prompt assembly (for the run trace). Single-pass: the one call; map-reduce: the whole-diff assembly. */
  assembly: PromptAssembly;
  /** Per-chunk labels (for the run trace's tool_calls). */
  chunks: { label: string }[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  /** Joined raw model outputs (for the run trace). */
  raw: string;
  /**
   * Total LLM samples behind the final review: 1 normally; >1 when the
   * false-negative guard re-sampled an empty single-pass result.
   */
  samples: number;
  /** True when the empty-result re-sample guard ran (for the trace / "why approved"). */
  resampled: boolean;
}

/** Format an Intent into the compact plain-text block injected via prIntent. */
function formatIntent(intent: Intent): string {
  const lines: string[] = [`Summary: ${intent.intent}`];
  if (intent.in_scope.length > 0) {
    lines.push(`In scope:\n${intent.in_scope.map((s) => `• ${s}`).join('\n')}`);
  }
  if (intent.out_of_scope.length > 0) {
    lines.push(`Out of scope:\n${intent.out_of_scope.map((s) => `• ${s}`).join('\n')}`);
  }
  return lines.join('\n\n');
}

function selectMode(strategy: ReviewStrategy, diff: UnifiedDiff, threshold: number): ReviewMode {
  if (strategy === 'single-pass') return 'single-pass';
  if (strategy === 'map-reduce') return diff.files.length > 1 ? 'map-reduce' : 'single-pass';
  // auto: map-reduce only when the diff is both large AND multi-file (else 1 call).
  const totalLines = diff.files.reduce((n, f) => n + f.additions + f.deletions, 0);
  return totalLines > threshold && diff.files.length > 1 ? 'map-reduce' : 'single-pass';
}

export async function reviewPullRequest(input: ReviewInput): Promise<ReviewOutcome> {
  const threshold = input.mapThresholdLines ?? DEFAULT_MAP_THRESHOLD_LINES;
  const maxRetries = input.maxRetries ?? DEFAULT_REVIEW_MAX_RETRIES;
  const mode = selectMode(input.strategy ?? 'auto', input.diff, threshold);
  const emit = (kind: RunEventKind, msg: string, data?: unknown) =>
    input.onEvent?.({ kind, msg, data });

  const promptParts = {
    system: input.systemPrompt,
    skills: input.skills,
    memory: input.memory,
    specs: input.specs,
    callers: input.callers,
    repoMap: input.repoMap,
    prDescription: input.prDescription,
    prIntent: input.intent ? formatIntent(input.intent) : undefined,
    task: input.task,
  };

  // Whole-diff assembly is the trace default; overwritten below for single-pass.
  let assembly: PromptAssembly = assemblePrompt({ ...promptParts, diff: input.diff.raw }).assembly;

  const chunks =
    mode === 'map-reduce'
      ? input.diff.files.map((f) => ({ label: f.path, diffText: sliceDiff(input.diff, f.path) }))
      : [{ label: 'all files', diffText: input.diff.raw }];

  emit(
    'info',
    mode === 'map-reduce'
      ? `Large diff → map-reduce over ${input.diff.files.length} files`
      : `Reviewing ${input.diff.files.length} changed file(s) in one pass`,
  );

  const partials: Review[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd: number | null = 0;
  const raws: string[] = [];

  for (const chunk of chunks) {
    // Cancellation checkpoint — stop before the next (expensive) LLM call.
    input.checkCancelled?.();
    // 'map:' prefix only for the map-reduce path (one call per file). In
    // single-pass there is exactly one chunk (the whole diff) — don't mislabel it.
    emit(
      'tool',
      mode === 'map-reduce' ? `map: reviewing ${chunk.label}` : `Reviewing ${chunk.label} in one pass`,
      { file: chunk.label },
    );
    const a = assemblePrompt({ ...promptParts, diff: chunk.diffText });
    if (mode === 'single-pass') assembly = a.assembly;
    const res = await input.llm.completeStructured<Review>({
      model: input.model,
      schema: ReviewSchema,
      schemaName: 'Review',
      messages: a.messages,
      maxRetries,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.seed != null ? { seed: input.seed } : {}),
    });
    tokensIn += res.tokensIn;
    tokensOut += res.tokensOut;
    costUsd = costUsd == null || res.costUsd == null ? null : costUsd + res.costUsd;
    raws.push(res.raw);
    partials.push(res.data);
    emit('result', `${chunk.label}: ${res.data.findings.length} candidate finding(s)`);
  }

  let merged = reduceReviews(partials);

  // False-negative guard (opt-in via `resampleOnEmpty`). A single-pass review
  // that returns ZERO findings is the exact shape of the "lazy approve" failure:
  // identical input can flip to an empty result on a cheap/non-deterministic
  // model, and grounding only DROPS findings — it can't recover a missed one. So
  // re-sample the whole diff a few more times (perturbed: higher temperature +
  // offset seed, else we'd just reproduce the empty) and merge worst-verdict +
  // union. Off by default and scoped to this branch → the normal path is
  // byte-identical to today.
  let samples = partials.length;
  let resampled = false;
  const resampleN = input.resampleOnEmpty ?? 0;
  if (mode === 'single-pass' && merged.findings.length === 0 && resampleN > 0) {
    emit('info', `0 findings → re-sampling ${resampleN}x (false-negative guard)`);
    const spMessages = assemblePrompt({ ...promptParts, diff: chunks[0]!.diffText }).messages;
    for (let i = 0; i < resampleN; i++) {
      input.checkCancelled?.();
      const res = await input.llm.completeStructured<Review>({
        model: input.model,
        schema: ReviewSchema,
        schemaName: 'Review',
        messages: spMessages,
        maxRetries,
        temperature: input.resampleTemperature ?? 0.4,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.seed != null ? { seed: input.seed + i + 1 } : {}),
      });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      costUsd = costUsd == null || res.costUsd == null ? null : costUsd + res.costUsd;
      raws.push(res.raw);
      partials.push(res.data);
      samples++;
      emit('result', `re-sample ${i + 1}: ${res.data.findings.length} candidate finding(s)`);
    }
    const remerged = reduceReviews(partials);
    merged = { ...remerged, findings: dedupeFindings(remerged.findings) };
    resampled = true;
  }

  emit(
    'result',
    `Reduced to ${merged.findings.length} finding(s); verdict=${merged.verdict}, score=${merged.score}`,
  );

  // SHARED citation-grounding gate (the only post-step; not duplicated per strategy).
  const ground = groundFindings(merged.findings, input.diff);
  const grounding = groundingSummary(ground);
  for (const d of ground.dropped) {
    emit('info', `grounding dropped "${d.finding.title}": ${d.reason}`);
  }
  emit('result', `Citation grounding: ${grounding}`);

  // Score AND verdict are derived from the findings that SURVIVED grounding (not
  // the model's self-reported number/verdict, and not the pre-grounding set), via
  // the same deterministic rules the CI event uses — so the score, the verdict
  // badge, the findings list, and the GitHub event can never contradict each other
  // (no more "100 / 0 findings / request changes" cards).
  return {
    review: {
      ...merged,
      findings: ground.kept,
      score: scoreFromFindings(ground.kept),
      verdict: verdictFromFindings(ground.kept),
    },
    grounding,
    dropped: ground.dropped,
    mode,
    assembly,
    chunks: chunks.map((c) => ({ label: c.label })),
    tokensIn,
    tokensOut,
    costUsd,
    raw: raws.join('\n---\n'),
    samples,
    resampled,
  };
}
