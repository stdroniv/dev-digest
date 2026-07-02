import type { z } from 'zod';
import type { LLMProvider, TourSectionKind, TourSectionContent } from '@devdigest/shared';
import {
  ArchitectureContent,
  CriticalPathsContent,
  HowToRunContent,
  ReadingPathContent,
  FirstTasksContent,
} from '@devdigest/shared';
import { buildSectionMessages, type OnboardingGrounding } from './prompts.js';

export type { OnboardingGrounding } from './prompts.js';

/**
 * generateOnboardingSection — pure per-section synthesiser for the Onboarding
 * Tour (SPEC-02). One LLM call produces ONE section's structured content; the
 * server fans this out over all five `TourSectionKind`s for a whole-tour
 * generation, or calls it once for a single-section regenerate (Rec 2 — one
 * section-level code path serves both).
 *
 * Pure: no DB/FS/HTTP — the only side effect is the injected `LLMProvider`.
 * This does NOT pass through the findings `grounding.ts` gate (diff-line
 * citation grounding is unrelated to this synthesis).
 */
export interface GenerateOnboardingSectionInput {
  llm: LLMProvider;
  model: string;
  kind: TourSectionKind;
  grounding: OnboardingGrounding;
}

export interface GenerateOnboardingSectionResult {
  data: TourSectionContent;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

const SECTION_SCHEMAS: Record<TourSectionKind, { schema: z.ZodTypeAny; schemaName: string }> = {
  architecture: { schema: ArchitectureContent, schemaName: 'ArchitectureContent' },
  critical_paths: { schema: CriticalPathsContent, schemaName: 'CriticalPathsContent' },
  how_to_run: { schema: HowToRunContent, schemaName: 'HowToRunContent' },
  reading_path: { schema: ReadingPathContent, schemaName: 'ReadingPathContent' },
  first_tasks: { schema: FirstTasksContent, schemaName: 'FirstTasksContent' },
};

export async function generateOnboardingSection(
  input: GenerateOnboardingSectionInput,
): Promise<GenerateOnboardingSectionResult> {
  const { schema, schemaName } = SECTION_SCHEMAS[input.kind];
  const messages = buildSectionMessages(input.kind, input.grounding);

  const res = await input.llm.completeStructured<TourSectionContent>({
    model: input.model,
    schema: schema as z.ZodType<TourSectionContent>,
    schemaName,
    messages,
    maxRetries: 2,
  });

  return {
    data: res.data,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  };
}
