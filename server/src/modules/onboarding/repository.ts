import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { OnboardingTour, type TourSection, type TourSectionKind } from '@devdigest/shared';

/**
 * Structural port `job-handler.ts` codes against (instead of the concrete
 * `OnboardingRepository` class) so hermetic unit tests can inject an
 * in-memory fake — no DB, no testcontainers — for the content-preservation
 * (AC-33/34) assertions. `OnboardingRepository` implements this exactly.
 */
export interface OnboardingRepositoryPort {
  get(repoId: string): Promise<OnboardingTour | null>;
  upsertWhole(repoId: string, tour: OnboardingTour): Promise<void>;
  patchSection(repoId: string, kind: TourSectionKind, section: TourSection): Promise<OnboardingTour>;
}

/**
 * OnboardingRepository — Drizzle read/write of the `onboarding` table's `json`
 * blob (SPEC-02). Reuses the existing `onboarding` table (`repoId` PK, `json`,
 * `generatedAt`) — NO migration. `patchSection` is a read-modify-write of the
 * single row so a section regen never touches the other four sections' bytes
 * (AC-24).
 *
 * This repository does NOT invent field values: `upsertWhole`/`patchSection`
 * persist exactly the `OnboardingTour`/`TourSection` the caller passes. The
 * SERVICE (`service.ts`) owns deciding what those values are — including
 * carrying forward a failed section's prior content/cost/generatedAt (AC-34).
 */
export class OnboardingRepository implements OnboardingRepositoryPort {
  constructor(private db: Db) {}

  /** Read the persisted tour for a repo, Zod-validated. `null` when absent or invalid. */
  async get(repoId: string): Promise<OnboardingTour | null> {
    const [row] = await this.db
      .select({ json: t.onboarding.json })
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    if (!row) return null;
    const parsed = OnboardingTour.safeParse(row.json);
    return parsed.success ? parsed.data : null;
  }

  /** Write the full tour blob (whole-tour generate/regenerate) — upsert by `repoId`. */
  async upsertWhole(repoId: string, tour: OnboardingTour): Promise<void> {
    const generatedAt = new Date(tour.generatedAt);
    await this.db
      .insert(t.onboarding)
      .values({ repoId, json: tour, generatedAt })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { json: tour, generatedAt },
      });
  }

  /**
   * Replace exactly ONE section (by `kind`) in the persisted tour and write
   * the whole blob back. Writes `section` verbatim — does not compute/merge
   * anything else. Throws if no tour is persisted yet for this repo (the
   * service must seed a full tour on first-ever generation before any
   * single-section regen can target it).
   */
  async patchSection(
    repoId: string,
    kind: TourSectionKind,
    section: TourSection,
  ): Promise<OnboardingTour> {
    const existing = await this.get(repoId);
    if (!existing) {
      throw new Error(`patchSection: no onboarding tour persisted for repo ${repoId}`);
    }
    const sections = existing.sections.map((s) => (s.kind === kind ? section : s));
    const updated: OnboardingTour = { ...existing, sections };
    await this.upsertWhole(repoId, updated);
    return updated;
  }
}
