/**
 * OnboardingService — hermetic unit tests (T5).
 *
 * Two layers:
 *  (1) pure decision helpers (`computeAvailability`/`computeStale`/
 *      `deriveFailedSectionKinds`) — directly unit-tested, no DB.
 *  (2) the job bodies (`runWholeTourJob`/`runSectionRegenerateJob`,
 *      `job-handler.ts`) — run against a FAKE in-memory
 *      `OnboardingRepositoryPort` (no DB) + a mocked `llm`/`repoIntel`/
 *      `tokenizer`, exercising the real content-preservation logic
 *      (AC-24/33/34) end to end at the pipeline level.
 *
 * `OnboardingService`'s own DB-touching methods (job enqueue, latest-job
 * lookup) are covered end-to-end against a real Postgres in
 * `routes.it.test.ts` (T7) — hermetically faking drizzle's chainable query
 * builder for those would test the fake, not the service.
 */
import { describe, it, expect } from 'vitest';
import type { OnboardingTour, TourSection, TourSectionKind } from '@devdigest/shared';
import { MockLLMProvider } from '../../adapters/mocks.js';
import type { Container } from '../../platform/container.js';
import type { Db } from '../../db/client.js';
import type { RepoIntel, IndexState } from '../repo-intel/types.js';
import type { OnboardingRepositoryPort } from './repository.js';
import { emptySection, runWholeTourJob, runSectionRegenerateJob } from './job-handler.js';
import { computeAvailability, computeStale, deriveFailedSectionKinds } from './service.js';
import type { OnboardingRepoRef } from './grounding.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REPO: OnboardingRepoRef & { workspaceId: string } = {
  id: 'repo-1',
  owner: 'acme',
  name: 'widgets',
  clonePath: '/mock/clones/acme/widgets',
  workspaceId: 'ws-1',
};

const VALID_FIXTURE_BY_SCHEMA: Record<string, unknown> = {
  ArchitectureContent: {
    prose: 'The service starts in src/index.ts.',
    refs: ['src/index.ts'],
    diagram: { nodes: [{ id: 'src/index.ts', label: 'index.ts' }], edges: [] },
  },
  CriticalPathsContent: { rows: [{ path: 'src/index.ts', why: 'entry point' }] },
  HowToRunContent: { steps: [{ command: 'pnpm install' }] },
  ReadingPathContent: { steps: [{ path: 'src/index.ts', reason: 'start here' }] },
  FirstTasksContent: {
    tasks: [
      { title: 'Add a test', path: 'src/index.ts', complexity: 'low' },
      { title: 'Fix a bug', path: 'src/server.ts', complexity: 'medium' },
    ],
  },
};

/** A fake `OnboardingRepositoryPort` backed by an in-memory Map — no DB. */
class FakeOnboardingRepository implements OnboardingRepositoryPort {
  private store = new Map<string, OnboardingTour>();

  seed(repoId: string, tour: OnboardingTour): void {
    this.store.set(repoId, tour);
  }

  async get(repoId: string): Promise<OnboardingTour | null> {
    return this.store.get(repoId) ?? null;
  }

  async upsertWhole(repoId: string, tour: OnboardingTour): Promise<void> {
    this.store.set(repoId, tour);
  }

  async patchSection(
    repoId: string,
    kind: TourSectionKind,
    section: TourSection,
  ): Promise<OnboardingTour> {
    const existing = this.store.get(repoId);
    if (!existing) throw new Error(`no tour for ${repoId}`);
    const sections = existing.sections.map((s) => (s.kind === kind ? section : s));
    const updated: OnboardingTour = { ...existing, sections };
    this.store.set(repoId, updated);
    return updated;
  }
}

function fakeRepoIntel(): RepoIntel {
  const state: IndexState = {
    repoId: REPO.id,
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 1,
    lastIndexedSha: 'sha-1',
    indexerVersion: 4,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    degraded: false,
  };
  return {
    indexRepo: async () => ({ status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 }),
    refreshIndex: async () => ({ status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 }),
    getIndexState: async () => state,
    getBlastRadius: async () => ({ changedSymbols: [], callers: [], impactedEndpoints: [] }),
    getRepoMap: async () => ({ text: 'src/index.ts: main()', tokens: 5, cached: true }),
    getFileRank: async () => [],
    getSymbolsInFiles: async () => [],
    getCallerSignatures: async () => [],
    getUnresolvedReferences: async () => [],
    getConventionSamples: async () => [],
    getTopFilesByRank: async () => ['src/index.ts'],
    getCriticalPaths: async () => [['src/index.ts', 'src/server.ts']],
  };
}

/** `resolveFeatureModel` reads a workspace override off `container.db` — stub
 * the one chain it calls (`select({key,value}).from(settings).where(...)`) so
 * it resolves to "no override" and falls through to the registry default,
 * without touching a real DB. */
const FAKE_SETTINGS_DB = {
  select: () => ({ from: () => ({ where: async () => [] }) }),
} as unknown as Db;

function makeContainer(llm: MockLLMProvider): Container {
  return {
    db: FAKE_SETTINGS_DB,
    llm: async () => llm,
    tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
    repoIntel: fakeRepoIntel(),
  } as unknown as Container;
}

function readySection(kind: TourSectionKind, marker: string): TourSection {
  return {
    kind,
    status: 'ready',
    content: VALID_FIXTURE_BY_SCHEMA[schemaNameFor(kind)] as TourSection['content'],
    cost: { tokensIn: 111, tokensOut: 22 },
    error: null,
    generatedAt: `2025-01-0${marker}T00:00:00.000Z`,
  };
}

function schemaNameFor(kind: TourSectionKind): string {
  const map: Record<TourSectionKind, string> = {
    architecture: 'ArchitectureContent',
    critical_paths: 'CriticalPathsContent',
    how_to_run: 'HowToRunContent',
    reading_path: 'ReadingPathContent',
    first_tasks: 'FirstTasksContent',
  };
  return map[kind];
}

const ALL_KINDS: TourSectionKind[] = [
  'architecture',
  'critical_paths',
  'how_to_run',
  'reading_path',
  'first_tasks',
];

function seedReadyTour(repo: FakeOnboardingRepository): OnboardingTour {
  const tour: OnboardingTour = {
    repoId: REPO.id,
    sections: ALL_KINDS.map((k, i) => readySection(k, String(i + 1))),
    provenance: {
      fileCount: 10,
      indexed: true,
      indexerVersion: 4,
      lastIndexedSha: 'sha-1',
      model: 'deepseek/deepseek-v4-flash',
      githubUrl: 'https://github.com/acme/widgets',
    },
    generatedAt: '2025-01-01T00:00:00.000Z',
  };
  repo.seed(REPO.id, tour);
  return tour;
}

// ---------------------------------------------------------------------------
// (1) Pure decision helpers
// ---------------------------------------------------------------------------

describe('computeAvailability', () => {
  it('is "unavailable" when the repo is not cloned (AC-35)', () => {
    expect(computeAvailability(null, false)).toBe('unavailable');
  });

  it('is "empty" when no tour is persisted', () => {
    expect(computeAvailability(null, true)).toBe('empty');
  });

  it('is "empty" when every section has null content (first-ever run, AC-33 edge case)', () => {
    const tour: OnboardingTour = {
      repoId: 'r',
      sections: ALL_KINDS.map((k) => emptySection(k)),
      provenance: {
        fileCount: 0,
        indexed: false,
        indexerVersion: null,
        lastIndexedSha: null,
        model: 'x',
        githubUrl: null,
      },
      generatedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(computeAvailability(tour, true)).toBe('empty');
  });

  it('is "ready" when >=1 section has non-null content', () => {
    const repo = new FakeOnboardingRepository();
    const tour = seedReadyTour(repo);
    expect(computeAvailability(tour, true)).toBe('ready');
  });
});

describe('computeStale', () => {
  const tour = seedReadyTour(new FakeOnboardingRepository());

  it('is false when the stored index identity matches the current one', () => {
    expect(computeStale(tour, { indexerVersion: 4, lastIndexedSha: 'sha-1' })).toBe(false);
  });

  it('is true when the sha differs', () => {
    expect(computeStale(tour, { indexerVersion: 4, lastIndexedSha: 'sha-2' })).toBe(true);
  });

  it('is true when the indexer version differs', () => {
    expect(computeStale(tour, { indexerVersion: 5, lastIndexedSha: 'sha-1' })).toBe(true);
  });
});

describe('deriveFailedSectionKinds', () => {
  it('is [] for a non-failed job', () => {
    expect(deriveFailedSectionKinds('done', 'whole', null, null)).toEqual([]);
  });

  it('is [sectionKind] for a failed section-kind job', () => {
    expect(deriveFailedSectionKinds('failed', 'section', 'critical_paths', null)).toEqual([
      'critical_paths',
    ]);
  });

  it('reads failed kinds off the persisted tour for a failed whole-tour job', () => {
    const tour: OnboardingTour = {
      repoId: 'r',
      sections: ALL_KINDS.map((k) =>
        k === 'first_tasks'
          ? { ...emptySection(k), status: 'failed' as const, error: 'boom' }
          : readySection(k, '1'),
      ),
      provenance: {
        fileCount: 1,
        indexed: true,
        indexerVersion: 1,
        lastIndexedSha: 's',
        model: 'x',
        githubUrl: null,
      },
      generatedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(deriveFailedSectionKinds('failed', 'whole', null, tour)).toEqual(['first_tasks']);
  });
});

// ---------------------------------------------------------------------------
// (2) Job bodies
// ---------------------------------------------------------------------------

describe('runWholeTourJob — success', () => {
  it('marks and persists all 5 sections as ready', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: VALID_FIXTURE_BY_SCHEMA });
    const repo = new FakeOnboardingRepository();
    await runWholeTourJob(makeContainer(llm), repo, REPO);

    const tour = await repo.get(REPO.id);
    expect(tour).not.toBeNull();
    expect(tour!.sections).toHaveLength(5);
    for (const section of tour!.sections) {
      expect(section.status).toBe('ready');
      expect(section.content).not.toBeNull();
      expect(section.cost).toEqual({ tokensIn: 100, tokensOut: 50 });
      expect(section.error).toBeNull();
    }
    expect(computeAvailability(tour, true)).toBe('ready');
  });
});

describe('runWholeTourJob — one section fails while others succeed', () => {
  it('marks only the failing section as failed with a reason; the rest stay ready', async () => {
    const badFixtures = { ...VALID_FIXTURE_BY_SCHEMA, CriticalPathsContent: { bogus: true } };
    const llm = new MockLLMProvider('openai', { structuredBySchema: badFixtures });
    const repo = new FakeOnboardingRepository();

    await expect(runWholeTourJob(makeContainer(llm), repo, REPO)).rejects.toThrow(
      /critical_paths/,
    );

    const tour = await repo.get(REPO.id);
    const failed = tour!.sections.find((s) => s.kind === 'critical_paths')!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toBeTruthy();
    expect(failed.content).toBeNull(); // first-ever section — nothing to preserve

    for (const kind of ALL_KINDS.filter((k) => k !== 'critical_paths')) {
      const section = tour!.sections.find((s) => s.kind === kind)!;
      expect(section.status).toBe('ready');
      expect(section.content).not.toBeNull();
    }
  });
});

describe('runWholeTourJob — AC-33 first-ever whole-tour failure (empty edge case)', () => {
  it('leaves every section with null content when ALL sections fail on a first-ever run', async () => {
    const allBadFixtures = Object.fromEntries(Object.keys(VALID_FIXTURE_BY_SCHEMA).map((k) => [k, { bogus: true }]));
    const llm = new MockLLMProvider('openai', { structuredBySchema: allBadFixtures });
    const repo = new FakeOnboardingRepository();

    await expect(runWholeTourJob(makeContainer(llm), repo, REPO)).rejects.toThrow(
      /Generation failed for 5 of 5 sections/,
    );

    const tour = await repo.get(REPO.id);
    expect(tour!.sections.every((s) => s.status === 'failed')).toBe(true);
    expect(tour!.sections.every((s) => s.content === null)).toBe(true);
    // Availability must be "empty" (NOT "ready" with five failed cards) — AC-33 edge case.
    expect(computeAvailability(tour, true)).toBe('empty');
  });
});

describe('runWholeTourJob — AC-33 whole-tour failure with a prior tour present', () => {
  it('preserves every prior section content/cost/generatedAt when the re-run fails', async () => {
    const repo = new FakeOnboardingRepository();
    const priorTour = seedReadyTour(repo);

    const allBadFixtures = Object.fromEntries(Object.keys(VALID_FIXTURE_BY_SCHEMA).map((k) => [k, { bogus: true }]));
    const llm = new MockLLMProvider('openai', { structuredBySchema: allBadFixtures });

    await expect(runWholeTourJob(makeContainer(llm), repo, REPO)).rejects.toThrow();

    const tour = await repo.get(REPO.id);
    expect(tour!.sections.every((s) => s.status === 'failed')).toBe(true);
    for (const kind of ALL_KINDS) {
      const before = priorTour.sections.find((s) => s.kind === kind)!;
      const after = tour!.sections.find((s) => s.kind === kind)!;
      expect(after.content).toEqual(before.content);
      expect(after.cost).toEqual(before.cost);
      expect(after.generatedAt).toEqual(before.generatedAt);
      expect(after.error).toBeTruthy();
    }
    // Prior content survives, so availability stays "ready" with a banner (AC-33).
    expect(computeAvailability(tour, true)).toBe('ready');
  });
});

describe('runSectionRegenerateJob — AC-24 patches only its kind', () => {
  it('replaces only the target section, recomputes its cost, and leaves the other four untouched', async () => {
    const repo = new FakeOnboardingRepository();
    const priorTour = seedReadyTour(repo);

    const llm = new MockLLMProvider('openai', { structuredBySchema: VALID_FIXTURE_BY_SCHEMA });
    await runSectionRegenerateJob(makeContainer(llm), repo, REPO, 'how_to_run');

    const tour = await repo.get(REPO.id);
    const changed = tour!.sections.find((s) => s.kind === 'how_to_run')!;
    expect(changed.status).toBe('ready');
    expect(changed.cost).toEqual({ tokensIn: 100, tokensOut: 50 });
    expect(changed.generatedAt).not.toBe(
      priorTour.sections.find((s) => s.kind === 'how_to_run')!.generatedAt,
    );

    for (const kind of ALL_KINDS.filter((k) => k !== 'how_to_run')) {
      const before = priorTour.sections.find((s) => s.kind === kind)!;
      const after = tour!.sections.find((s) => s.kind === kind)!;
      expect(after).toEqual(before);
    }
  });
});

describe('runSectionRegenerateJob — AC-34 a failing regen of an already-populated section', () => {
  it('keeps the prior content/cost/generatedAt, marks status:"failed", and leaves the other 4 sections untouched', async () => {
    const repo = new FakeOnboardingRepository();
    const priorTour = seedReadyTour(repo);

    const badFixtures = { ...VALID_FIXTURE_BY_SCHEMA, CriticalPathsContent: { bogus: true } };
    const llm = new MockLLMProvider('openai', { structuredBySchema: badFixtures });

    await expect(
      runSectionRegenerateJob(makeContainer(llm), repo, REPO, 'critical_paths'),
    ).rejects.toThrow();

    const tour = await repo.get(REPO.id);
    const failedSection = tour!.sections.find((s) => s.kind === 'critical_paths')!;
    const priorSection = priorTour.sections.find((s) => s.kind === 'critical_paths')!;

    expect(failedSection.status).toBe('failed');
    expect(failedSection.error).toBeTruthy();
    expect(failedSection.content).toEqual(priorSection.content);
    expect(failedSection.cost).toEqual(priorSection.cost);
    expect(failedSection.generatedAt).toEqual(priorSection.generatedAt);

    for (const kind of ALL_KINDS.filter((k) => k !== 'critical_paths')) {
      const before = priorTour.sections.find((s) => s.kind === kind)!;
      const after = tour!.sections.find((s) => s.kind === kind)!;
      expect(after).toEqual(before);
    }
  });
});
