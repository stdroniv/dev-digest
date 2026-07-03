import type { OnboardingGrounding } from '@devdigest/reviewer-core';
import { generateOnboardingSection } from '@devdigest/reviewer-core';
import type {
  OnboardingTour,
  TourProvenance,
  TourSection,
  TourSectionKind,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { assembleGrounding, type OnboardingRepoRef } from './grounding.js';
import type { OnboardingRepositoryPort } from './repository.js';
import { ONBOARDING_FEATURE_MODEL_ID, TOUR_SECTION_KINDS } from './constants.js';

/**
 * Onboarding Tour job bodies (SPEC-02 T5). These run OUTSIDE the request/
 * response cycle — `container.jobs` invokes them on its p-queue after
 * `OnboardingService.startWhole`/`regenerateSection` enqueue immediately (202).
 *
 * Both job kinds share ONE section-level generation pipeline (`runSectionPipeline`
 * — Rec 2): a whole-tour run fans it out over all five `TourSectionKind`s; a
 * single-section regen calls it once. Content-preservation (AC-34) lives in
 * `runSectionPipeline`'s catch branch — a failed section NEVER nulls prior
 * content/cost/generatedAt.
 */

export interface GenerateJobPayload {
  repoId: string;
}

export interface RegenerateSectionJobPayload {
  repoId: string;
  sectionKind: TourSectionKind;
}

/** A never-generated section — the "prior" for a first-ever run of a kind. */
export function emptySection(kind: TourSectionKind): TourSection {
  return { kind, status: 'generating', content: null, cost: null, error: null, generatedAt: null };
}

/**
 * Run ONE section's generation. Never throws: on failure it returns a
 * `failed` TourSection built by SPREADING `prior` first — so a failed regen
 * of an already-populated section keeps its prior content/cost/generatedAt
 * (AC-34), and only `status`/`error` change. For a first-ever section,
 * `prior` is `emptySection(kind)`, so a failure there legitimately has
 * `content:null` (nothing to preserve).
 */
export async function runSectionPipeline(
  container: Container,
  grounding: OnboardingGrounding,
  model: string,
  provider: 'openai' | 'anthropic' | 'openrouter',
  kind: TourSectionKind,
  prior: TourSection,
): Promise<TourSection> {
  try {
    const llm = await container.llm(provider);
    const result = await generateOnboardingSection({ llm, model, kind, grounding });

    // Prefer provider-reported usage; fall back to LOCAL estimation (SPEC-01
    // tokenizer, no extra model call) only when the provider reported nothing.
    let tokensIn = result.tokensIn;
    let tokensOut = result.tokensOut;
    if (tokensIn === 0 && tokensOut === 0) {
      tokensIn = container.tokenizer.count(JSON.stringify(grounding));
      tokensOut = container.tokenizer.count(JSON.stringify(result.data));
    }

    return {
      kind,
      status: 'ready',
      content: result.data,
      cost: { tokensIn, tokensOut },
      error: null,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ...prior,
      kind,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Whole-tour generation (AC-7/23). Seeds all five sections as `generating`
 * (preserving any prior content so an in-flight regen never blanks a
 * previously-ready section mid-run), runs the section pipeline for each kind,
 * and patches each result in as it completes.
 *
 * On >=1 failed section (AC-33): throws a single synthesized summary Error —
 * the JobRunner persists that as the job row's `status:'failed'`/`error`;
 * `OnboardingService` derives `failedSectionKinds` at read time from the
 * persisted sections' own `status:'failed'` flags (Rec — no extra job-row
 * column needed).
 */
export async function runWholeTourJob(
  container: Container,
  repository: OnboardingRepositoryPort,
  repo: OnboardingRepoRef & { workspaceId: string },
): Promise<void> {
  const { grounding, provenance: groundingProvenance } = await assembleGrounding(container, repo);
  const { provider, model } = await resolveFeatureModel(
    container,
    repo.workspaceId,
    ONBOARDING_FEATURE_MODEL_ID,
  );

  const priorTour = await repository.get(repo.id);
  const priorByKind = new Map((priorTour?.sections ?? []).map((s) => [s.kind, s] as const));

  const seedSections: TourSection[] = TOUR_SECTION_KINDS.map((kind) => {
    const prior = priorByKind.get(kind) ?? emptySection(kind);
    return { ...prior, status: 'generating' as const, error: null };
  });
  const provenance: TourProvenance = {
    fileCount: groundingProvenance.fileCount,
    indexed: groundingProvenance.indexed,
    indexerVersion: groundingProvenance.indexerVersion,
    lastIndexedSha: groundingProvenance.lastIndexedSha,
    model,
    githubUrl: `https://github.com/${repo.owner}/${repo.name}`,
  };
  const seedTour: OnboardingTour = {
    repoId: repo.id,
    sections: seedSections,
    provenance,
    generatedAt: new Date().toISOString(),
  };
  await repository.upsertWhole(repo.id, seedTour);

  const failedKinds: TourSectionKind[] = [];
  let firstError: string | null = null;

  for (const kind of TOUR_SECTION_KINDS) {
    const prior = priorByKind.get(kind) ?? emptySection(kind);
    const section = await runSectionPipeline(container, grounding, model, provider, kind, prior);
    if (section.status === 'failed') {
      failedKinds.push(kind);
      firstError ??= section.error;
    }
    await repository.patchSection(repo.id, kind, section);
  }

  if (failedKinds.length > 0) {
    throw new Error(
      `Generation failed for ${failedKinds.length} of ${TOUR_SECTION_KINDS.length} sections ` +
        `(${failedKinds.join(', ')}): ${firstError}`,
    );
  }
}

/**
 * Single-section regenerate (AC-24/34). Marks the target section `generating`
 * immediately (so a poll mid-run sees the spinner state), runs the section
 * pipeline once, and patches the result back in — touching only that `kind`.
 */
export async function runSectionRegenerateJob(
  container: Container,
  repository: OnboardingRepositoryPort,
  repo: OnboardingRepoRef & { workspaceId: string },
  kind: TourSectionKind,
): Promise<void> {
  const priorTour = await repository.get(repo.id);
  const prior = priorTour?.sections.find((s) => s.kind === kind) ?? emptySection(kind);

  await repository.patchSection(repo.id, kind, { ...prior, status: 'generating', error: null });

  const { grounding } = await assembleGrounding(container, repo);
  const { provider, model } = await resolveFeatureModel(
    container,
    repo.workspaceId,
    ONBOARDING_FEATURE_MODEL_ID,
  );

  const section = await runSectionPipeline(container, grounding, model, provider, kind, prior);
  await repository.patchSection(repo.id, kind, section);

  if (section.status === 'failed') {
    throw new Error(section.error ?? `Regeneration failed for section "${kind}"`);
  }
}
