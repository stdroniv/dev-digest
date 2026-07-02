import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  GetTourResponse,
  OnboardingTour,
  TourAvailability,
  TourJob,
  TourJobKind,
  TourSectionKind,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { ValidationError } from '../../platform/errors.js';
import { OnboardingRepository } from './repository.js';
import type { OnboardingRepoRef } from './grounding.js';
import { GENERATE_JOB_KIND, REGENERATE_SECTION_JOB_KIND } from './constants.js';
import {
  runWholeTourJob,
  runSectionRegenerateJob,
  type GenerateJobPayload,
  type RegenerateSectionJobPayload,
} from './job-handler.js';

type JobRow = typeof t.jobs.$inferSelect;

/**
 * PURE decision helpers — extracted so the AC-30/33/34/35 business rules are
 * hermetically unit-testable without a real DB/JobRunner (`service.test.ts`).
 */

/**
 * `unavailable` when the repo isn't cloned yet (AC-35); `ready` requires >=1
 * section with non-null content — a first-ever run persists a row with every
 * section `generating`/`failed` and `content:null`, which must render as
 * `empty` + the failed job's reason (AC-33 first-ever/empty edge case), NEVER
 * as a `ready` tour of five failed/empty cards.
 */
export function computeAvailability(
  tour: OnboardingTour | null,
  cloned: boolean,
): TourAvailability {
  if (!cloned) return 'unavailable';
  if (!tour || !tour.sections.some((s) => s.content != null)) return 'empty';
  return 'ready';
}

/** AC-30: stale when the tour's stored index identity differs from the current one. */
export function computeStale(
  tour: OnboardingTour,
  state: { indexerVersion: number | null; lastIndexedSha: string | null },
): boolean {
  return (
    tour.provenance.indexerVersion !== state.indexerVersion ||
    tour.provenance.lastIndexedSha !== state.lastIndexedSha
  );
}

/**
 * `failedSectionKinds` is not a stored job-row column — it's derived: for a
 * failed section-kind job it's just `[sectionKind]`; for a failed whole-tour
 * job it's read back off the persisted tour's own per-section
 * `status:'failed'` flags (which `runWholeTourJob` already wrote via
 * `patchSection` before it threw) (AC-33).
 */
export function deriveFailedSectionKinds(
  status: JobRow['status'],
  jobKind: TourJobKind,
  sectionKind: TourSectionKind | null,
  tour: OnboardingTour | null,
): TourSectionKind[] {
  if (status !== 'failed') return [];
  if (jobKind === 'section') return sectionKind ? [sectionKind] : [];
  return tour ? tour.sections.filter((s) => s.status === 'failed').map((s) => s.kind) : [];
}

/**
 * OnboardingService — orchestrates the Onboarding Tour (SPEC-02): job
 * enqueue/registration, availability + staleness, and the latest-job lookup
 * the client polls.
 *
 * Job handlers are registered in the CONSTRUCTOR (not lazily per request) and
 * this class is exposed as a lazy container singleton getter
 * (`container.onboarding`, `platform/container.ts`) — mirrors
 * `repos/service.ts` + `repo-intel/service.ts`'s constructor-registration
 * pattern, so `routes.ts` touching the singleton once at module-plugin
 * registration is enough to register both job kinds exactly once, at
 * bootstrap, before any request is served.
 */
export class OnboardingService {
  private repo: OnboardingRepository;

  constructor(private container: Container) {
    this.repo = new OnboardingRepository(container.db);

    this.container.jobs.register(GENERATE_JOB_KIND, async (payload) => {
      await this.runWholeJob(payload as GenerateJobPayload);
    });
    this.container.jobs.register(REGENERATE_SECTION_JOB_KIND, async (payload) => {
      await this.runSectionJob(payload as RegenerateSectionJobPayload);
    });
  }

  /**
   * `GET /repos/:id/tour` — availability + persisted tour + staleness + the
   * latest job (active or most-recent terminal, so a failed job's `error`
   * stays displayable after it finishes).
   */
  async getTour(repo: OnboardingRepoRef): Promise<GetTourResponse> {
    const tour = await this.repo.get(repo.id);
    const job = await this.latestTourJob(repo.id);

    const availability = computeAvailability(tour, repo.clonePath != null);
    if (availability !== 'ready') {
      return { availability, tour, stale: false, job };
    }

    const state = await this.container.repoIntel.getIndexState(repo.id);
    const stale = computeStale(tour!, {
      indexerVersion: state.indexerVersion,
      lastIndexedSha: state.lastIndexedSha || null,
    });

    return { availability: 'ready', tour, stale, job };
  }

  /** `POST /repos/:id/tour/generate` — enqueue a whole-tour run; returns immediately (202). */
  async startWhole(workspaceId: string, repo: OnboardingRepoRef): Promise<TourJob> {
    if (!repo.clonePath) {
      throw new ValidationError('Repo is not cloned yet — cannot generate an onboarding tour.');
    }
    const enqueued = await this.container.jobs.enqueue(workspaceId, GENERATE_JOB_KIND, {
      repoId: repo.id,
    } satisfies GenerateJobPayload);
    // A job failure is tracked via the persisted `jobs` row (surfaced through
    // `getTour`/`toTourJob`), never through this promise — attach a no-op
    // catch so JobRunner's un-awaited `.done` doesn't surface as an unhandled
    // rejection when the job fails (AC-33).
    enqueued.done.catch(() => {});
    return this.jobById(enqueued.id);
  }

  /** `POST /repos/:id/tour/sections/:kind/regenerate` — enqueue a single-section run. */
  async regenerateSection(
    workspaceId: string,
    repo: OnboardingRepoRef,
    kind: TourSectionKind,
  ): Promise<TourJob> {
    if (!repo.clonePath) {
      throw new ValidationError('Repo is not cloned yet — cannot regenerate a section.');
    }
    const enqueued = await this.container.jobs.enqueue(workspaceId, REGENERATE_SECTION_JOB_KIND, {
      repoId: repo.id,
      sectionKind: kind,
    } satisfies RegenerateSectionJobPayload);
    // See the matching comment in `startWhole` (AC-34).
    enqueued.done.catch(() => {});
    return this.jobById(enqueued.id);
  }

  // ---- job bodies (registered in the constructor) --------------------------

  private async runWholeJob(payload: GenerateJobPayload): Promise<void> {
    const repo = await this.repoRef(payload.repoId);
    if (!repo) throw new Error(`Repo ${payload.repoId} not found`);
    await runWholeTourJob(this.container, this.repo, repo);
  }

  private async runSectionJob(payload: RegenerateSectionJobPayload): Promise<void> {
    const repo = await this.repoRef(payload.repoId);
    if (!repo) throw new Error(`Repo ${payload.repoId} not found`);
    await runSectionRegenerateJob(this.container, this.repo, repo, payload.sectionKind);
  }

  // ---- helpers ---------------------------------------------------------------

  private async repoRef(
    repoId: string,
  ): Promise<(OnboardingRepoRef & { workspaceId: string }) | null> {
    const [row] = await this.container.db
      .select({
        id: t.repos.id,
        workspaceId: t.repos.workspaceId,
        owner: t.repos.owner,
        name: t.repos.name,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row ?? null;
  }

  private async jobById(jobId: string): Promise<TourJob> {
    const [row] = await this.container.db.select().from(t.jobs).where(eq(t.jobs.id, jobId));
    if (!row) throw new Error(`Job ${jobId} not found immediately after enqueue`);
    return this.toTourJob(row);
  }

  /**
   * The latest onboarding job row for a repo (active OR most-recent
   * terminal). The generic `jobs` table has no `repoId` column — filter on
   * the jsonb `payload->>'repoId'` we enqueue with, scoped to onboarding's two
   * job kinds so an unrelated job never leaks in.
   */
  private async latestTourJob(repoId: string): Promise<TourJob | null> {
    const rows = await this.container.db
      .select()
      .from(t.jobs)
      .where(
        and(
          inArray(t.jobs.kind, [GENERATE_JOB_KIND, REGENERATE_SECTION_JOB_KIND]),
          sql`${t.jobs.payload} ->> 'repoId' = ${repoId}`,
        ),
      )
      .orderBy(desc(t.jobs.scheduledAt))
      .limit(1);
    const row = rows[0];
    return row ? this.toTourJob(row) : null;
  }

  /**
   * Map a `jobs` row to the wire `TourJob`. `failedSectionKinds` is not a
   * stored column — it's DERIVED at read time: for a failed section-kind job
   * it's just `[sectionKind]`; for a failed whole-tour job it's read back off
   * the persisted tour's own per-section `status:'failed'` flags (which
   * `runWholeTourJob` already wrote via `patchSection` before it threw).
   */
  private async toTourJob(row: JobRow): Promise<TourJob> {
    const payload = row.payload as { repoId?: string; sectionKind?: TourSectionKind } | null;
    const kind: TourJobKind = row.kind === REGENERATE_SECTION_JOB_KIND ? 'section' : 'whole';
    const sectionKind = kind === 'section' ? (payload?.sectionKind ?? null) : null;

    const tour =
      row.status === 'failed' && kind === 'whole' && payload?.repoId
        ? await this.repo.get(payload.repoId)
        : null;
    const failedSectionKinds = deriveFailedSectionKinds(row.status, kind, sectionKind, tour);

    return {
      id: row.id,
      kind,
      sectionKind,
      status: row.status,
      error: row.error,
      failedSectionKinds,
    };
  }
}
