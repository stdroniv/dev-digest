import type { ChatMessage, TourSectionKind } from '@devdigest/shared';
import { wrapUntrusted, INJECTION_GUARD } from '../prompt.js';

/**
 * Onboarding Tour (SPEC-02) — per-section system prompts + grounding rendering.
 *
 * Mirrors `brief/risks.ts` / `conventions/extract.ts`: repo-derived grounding is
 * UNTRUSTED data, delimiter-wrapped via `wrapUntrusted` and never treated as
 * instructions. Each section's system prompt ends with `INJECTION_GUARD`.
 */

/**
 * Repo grounding assembled by the SERVER (`server/src/modules/onboarding/
 * grounding.ts`) — plain strings/arrays only, since reviewer-core does no
 * DB/FS/HTTP of its own. For an indexed repo (AC-31) the index-derived fields
 * are populated; for a non-indexed repo (AC-32) `readme`/`fileTree`/
 * `languageHints` carry the fallback grounding instead.
 */
export interface OnboardingGrounding {
  repoName: string;
  repoMapText: string;
  topFiles: string[];
  criticalChains: string[][];
  importGraph: {
    nodes: { id: string; label: string }[];
    edges: { from: string; to: string }[];
  };
  readme?: string | null;
  fileTree?: string[];
  languageHints?: string[];
}

const SECTION_TITLES: Record<TourSectionKind, string> = {
  architecture: 'Architecture overview',
  critical_paths: 'Critical paths',
  how_to_run: 'How to run locally',
  reading_path: 'Guided reading path',
  first_tasks: 'First tasks',
};

const SECTION_SYSTEM: Record<TourSectionKind, string> = {
  architecture:
    'You write the "Architecture overview" section of a newcomer onboarding tour for a ' +
    'software repository.\n' +
    'Produce prose (2-4 short paragraphs) describing the service and its request flow, ' +
    'with inline references to real repo-relative paths — the `refs` array, where every ' +
    'path MUST be one that appears in the repository grounding below; never invent a path.\n' +
    'Also produce a small architecture diagram: `diagram.nodes` (id, label, optional ' +
    'kind/outlineColor) and `diagram.edges` (from, to, optional label). Every node `id` and ' +
    'every edge `from`/`to` MUST be one of the paths present in the "Import graph" grounding ' +
    'below — do not invent nodes or edges that are not present there.\n' +
    'This tour is ADVISORY newcomer guidance, not authoritative documentation — be accurate ' +
    'and cite only what the grounding shows.',
  critical_paths:
    'You write the "Critical paths" section of a newcomer onboarding tour: a ranked list of ' +
    'the most-important files in the repository.\n' +
    'Produce `rows`: each row cites a real repo-relative `path` (MUST be one of the paths ' +
    'present in the grounding below — never invent a path) plus a one-line `why` explaining ' +
    'why it matters.',
  how_to_run:
    'You write the "How to run locally" section of a newcomer onboarding tour: an ordered ' +
    'list of shell command steps to get the repository running locally (install, configure, ' +
    'start).\n' +
    'Produce `steps`: each step is one copyable shell `command`, with an optional short ' +
    '`comment`. Base every command on what the grounding (README, package manifests, repo ' +
    'map) actually shows — do not invent commands or secrets.',
  reading_path:
    'You write the "Guided reading path" section of a newcomer onboarding tour: an ordered ' +
    'list of real files to read, in the order a newcomer should read them.\n' +
    'Produce `steps`: each step cites a real repo-relative `path` (MUST be one of the paths ' +
    'present in the grounding below — never invent a path) plus a short `reason` explaining ' +
    'why it matters and why it comes at that point in the order.',
  first_tasks:
    'You write the "First tasks" section of a newcomer onboarding tour: 2 to 4 starter tasks ' +
    'a newcomer could pick up.\n' +
    'Produce `tasks`: 2 to 4 entries, each with a `title`, a real cited repo-relative `path` ' +
    '(MUST be one of the paths present in the grounding below — never invent a path), and a ' +
    '`complexity` of low, medium, or high.\n' +
    'Derive tasks from the repository content only (the grounding below) — NEVER reference, ' +
    'create, import, or round-trip a GitHub Issue; these are locally-authored suggestions, ' +
    'not linked to any issue tracker.',
};

export function sectionSystemPrompt(kind: TourSectionKind): string {
  return `${SECTION_SYSTEM[kind]}\n\n${INJECTION_GUARD}`;
}

/** Render the grounding as plain text (unwrapped — the caller fences it as untrusted). */
function renderGroundingText(grounding: OnboardingGrounding): string {
  const lines: string[] = [];
  lines.push(`Repository: ${grounding.repoName}`);
  if (grounding.repoMapText.trim()) {
    lines.push(`\nRepo map:\n${grounding.repoMapText}`);
  }
  if (grounding.topFiles.length > 0) {
    lines.push(`\nTop-ranked files:\n${grounding.topFiles.map((p) => `- ${p}`).join('\n')}`);
  }
  if (grounding.criticalChains.length > 0) {
    lines.push(
      `\nDependency chains (importer -> imported):\n${grounding.criticalChains
        .map((chain) => chain.join(' -> '))
        .join('\n')}`,
    );
  }
  const nodeIds = grounding.importGraph.nodes.map((n) => n.id).join(', ') || '(none)';
  const edgeList =
    grounding.importGraph.edges.map((e) => `${e.from}->${e.to}`).join(', ') || '(none)';
  lines.push(`\nImport graph:\nnodes: ${nodeIds}\nedges: ${edgeList}`);
  if (grounding.readme) {
    lines.push(`\nREADME:\n${grounding.readme}`);
  }
  if (grounding.fileTree && grounding.fileTree.length > 0) {
    lines.push(`\nFile tree:\n${grounding.fileTree.map((p) => `- ${p}`).join('\n')}`);
  }
  if (grounding.languageHints && grounding.languageHints.length > 0) {
    lines.push(`\nLanguage heuristics:\n${grounding.languageHints.join(', ')}`);
  }
  return lines.join('\n');
}

/** Build the chat messages for one section's generation call. */
export function buildSectionMessages(
  kind: TourSectionKind,
  grounding: OnboardingGrounding,
): ChatMessage[] {
  const task =
    `Write the "${SECTION_TITLES[kind]}" section of this repository's onboarding tour, ` +
    'grounded ONLY in the repository data below.';
  const groundingBlock = wrapUntrusted('onboarding-grounding', renderGroundingText(grounding));
  return [
    { role: 'system', content: sectionSystemPrompt(kind) },
    { role: 'user', content: `${task}\n\n${groundingBlock}` },
  ];
}
