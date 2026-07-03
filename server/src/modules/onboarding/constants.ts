import type { FeatureModelId, TourSectionKind } from '@devdigest/shared';

/** JobRunner kind for a whole-tour generation (fans out over all 5 sections). */
export const GENERATE_JOB_KIND = 'onboarding.generate';
/** JobRunner kind for a single-section regenerate. */
export const REGENERATE_SECTION_JOB_KIND = 'onboarding.regenerate-section';

/** The five sections every tour has, in display order (AC-7). */
export const TOUR_SECTION_KINDS: TourSectionKind[] = [
  'architecture',
  'critical_paths',
  'how_to_run',
  'reading_path',
  'first_tasks',
];

/** The `settings/feature-models.ts` slot this module resolves its provider+model against. */
export const ONBOARDING_FEATURE_MODEL_ID: FeatureModelId = 'onboarding';
