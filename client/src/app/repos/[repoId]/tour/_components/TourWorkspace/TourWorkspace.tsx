/* TourWorkspace — the Onboarding Tour screen for one repo (SPEC-02 T14).
   Consumes `useOnboardingTour` and switches on `availability`/`job`/`tour`
   into visually distinct states:
   - `unavailable`               → "cannot generate until the repo is available" (AC-35).
   - `empty` + no active job     → the designed empty state + generate CTA (AC-4/5/6).
   - `empty` + active whole job  → empty state + whole-tour in-progress spinner (AC-26).
   - `empty` + terminal failed   → empty state + the job's reason + retry (AC-33
     first-ever/empty edge case — this must NEVER render as a `ready` tour of
     five failed cards).
   - `ready`                     → header, anchor nav (five sections + a sixth
     "Generation cost" anchor), the five section cards, the cost panel, a
     "may be out of date" banner when `stale` (AC-30), and a whole-tour failure
     banner carrying `job.error` above the still-intact tour when a terminal
     `failed` `whole` job is returned alongside a ready tour (AC-33). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Skeleton, ErrorState } from "@devdigest/ui";
import type {
  ArchitectureContent,
  CriticalPathsContent,
  FirstTasksContent,
  HowToRunContent,
  ReadingPathContent,
  TourSection,
} from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useOnboardingTour, useGenerateTour } from "@/lib/hooks/onboarding";
import { ApiError } from "@/lib/api";
import { TourHeader } from "../TourHeader";
import { AnchorNav, type AnchorItem } from "../AnchorNav";
import { SectionCard } from "../SectionCard";
import { ArchitectureSection } from "../ArchitectureSection";
import {
  CriticalPathsSection,
  HowToRunSection,
  ReadingPathSection,
  FirstTasksSection,
} from "../sections";
import { CostPanel } from "../CostPanel";
import { SECTION_ORDER, SECTION_META, sectionAnchorId } from "./section-meta";
import { useScrollSpy } from "./useScrollSpy";
import { s } from "./styles";

const COST_ANCHOR_ID = sectionAnchorId("cost");

/** Anchor ids in display order — the five sections plus the cost card. Stable
   module constant so the scroll-spy subscribes once (not per render). */
const ANCHOR_IDS = [...SECTION_ORDER.map((kind) => sectionAnchorId(kind)), COST_ANCHOR_ID];

function renderSectionContent(section: TourSection, githubUrl: string | null): React.ReactNode {
  if (!section.content) return null;
  switch (section.kind) {
    case "architecture":
      return <ArchitectureSection content={section.content as ArchitectureContent} githubUrl={githubUrl} />;
    case "critical_paths":
      return <CriticalPathsSection content={section.content as CriticalPathsContent} githubUrl={githubUrl} />;
    case "how_to_run":
      return <HowToRunSection content={section.content as HowToRunContent} />;
    case "reading_path":
      return <ReadingPathSection content={section.content as ReadingPathContent} />;
    case "first_tasks":
      return <FirstTasksSection content={section.content as FirstTasksContent} githubUrl={githubUrl} />;
    default:
      return null;
  }
}

export function TourWorkspace({ repoId }: { repoId: string }) {
  const t = useTranslations("tour");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, error, refetch } = useOnboardingTour(repoId);
  const generate = useGenerateTour(repoId);

  const [openMap, setOpenMap] = React.useState<Record<string, boolean>>({});
  const [activeAnchor, setActiveAnchor] = React.useState<string>(sectionAnchorId(SECTION_ORDER[0]!));

  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [{ label: repoName, mono: true, href: `/repos/${repoId}/pulls` }, { label: t("title") }];

  const isOpen = (id: string, defaultOpen: boolean) => openMap[id] ?? defaultOpen;
  const setOpenFor = (id: string) => (open: boolean) => setOpenMap((m) => ({ ...m, [id]: open }));

  const navigateToAnchor = (id: string) => {
    setActiveAnchor(id);
    setOpenMap((m) => ({ ...m, [id]: true }));
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  // Keep the anchor rail in sync while the reader scrolls manually (both ways).
  // Only active once a ready tour is on screen — the section elements exist then.
  const tourReady = data?.availability === "ready" && !!data.tour;
  useScrollSpy(ANCHOR_IDS, setActiveAnchor, tourReady);

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <div style={s.stack}>
            <Skeleton height={44} />
            <Skeleton height={320} />
          </div>
        </div>
      </AppShell>
    );
  }

  if (isError || !data) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          title={t("loadError.title")}
          body={error instanceof ApiError ? error.message : undefined}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  const { availability, tour, stale, job } = data;

  if (availability === "unavailable") {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <div style={s.emptyCenter}>
            <div style={s.emptyIcon}>
              <Icon.GitBranch size={22} />
            </div>
            <div style={s.emptyTitle}>{t("unavailable.title")}</div>
            <div style={s.emptyBody}>{t("unavailable.body")}</div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (availability === "empty") {
    const activeJob = job && (job.status === "queued" || job.status === "running") ? job : null;
    const failedJob = job && job.status === "failed" ? job : null;

    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <div style={s.emptyCenter}>
            <div style={s.emptyIcon}>
              <Icon.Hexagon size={22} />
            </div>
            {activeJob ? (
              <>
                <div style={s.emptyTitle}>{t("empty.generatingTitle")}</div>
                <div style={s.emptyBody}>{t("empty.generatingBody")}</div>
                <div role="status" aria-label={t("empty.generatingTitle")} style={s.spinRow}>
                  <Icon.RefreshCw size={14} style={s.spin} />
                </div>
              </>
            ) : failedJob ? (
              <>
                <div style={s.emptyTitle}>{t("empty.failedTitle")}</div>
                <div role="alert" style={s.emptyError}>
                  {failedJob.error ?? t("unknownError")}
                </div>
                <Button kind="primary" loading={generate.isPending} onClick={() => generate.mutate()}>
                  {t("empty.retry")}
                </Button>
              </>
            ) : (
              <>
                <div style={s.emptyTitle}>{t("empty.title")}</div>
                <div style={s.emptyBody}>{t("empty.body")}</div>
                <Button kind="primary" loading={generate.isPending} onClick={() => generate.mutate()}>
                  {t("empty.cta")}
                </Button>
              </>
            )}
          </div>
        </div>
      </AppShell>
    );
  }

  // availability === "ready" — `tour` is guaranteed non-null by the service
  // contract (T5): `ready` requires at least one section with real content.
  if (!tour) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState title={t("loadError.title")} onRetry={() => refetch()} />
      </AppShell>
    );
  }

  const wholeJobActive = job?.kind === "whole" && (job.status === "queued" || job.status === "running");
  const wholeJobFailed = job?.kind === "whole" && job.status === "failed";

  const anchorItems: AnchorItem[] = [
    ...SECTION_ORDER.map((kind) => ({
      id: sectionAnchorId(kind),
      label: t(`anchorNav.${SECTION_META[kind].messageKey}`),
    })),
    { id: COST_ANCHOR_ID, label: t("anchorNav.cost") },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <p style={s.advisory}>
          <Icon.Info size={13} />
          {t("advisory")}
        </p>

        <TourHeader
          repoId={repoId}
          repoName={repoName}
          provenance={tour.provenance}
          generatedAt={tour.generatedAt}
          sections={tour.sections}
          regenerating={wholeJobActive || generate.isPending}
          onRegenerate={() => generate.mutate()}
        />

        <div style={s.stack}>
          {wholeJobActive && (
            <div role="status" aria-label={t("empty.generatingTitle")} style={s.spinRow}>
              <Icon.RefreshCw size={14} style={s.spin} />
              <span>{t("empty.generatingTitle")}</span>
            </div>
          )}

          {wholeJobFailed && (
            <div role="alert" style={s.banner("crit")}>
              <Icon.AlertOctagon size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={s.bannerText}>{t("wholeFailureBanner", { reason: job?.error ?? t("unknownError") })}</span>
            </div>
          )}

          {stale && (
            <div role="status" style={s.banner("warn")}>
              <Icon.AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={s.bannerText}>{t("stale.banner")}</span>
              <Button kind="secondary" icon="RefreshCw" onClick={() => generate.mutate()}>
                {t("stale.regenerate")}
              </Button>
            </div>
          )}
        </div>

        <div style={s.body}>
          <AnchorNav items={anchorItems} activeId={activeAnchor} onNavigate={navigateToAnchor} />
          <div style={s.main}>
            {SECTION_ORDER.map((kind) => {
              const section = tour.sections.find((sec) => sec.kind === kind);
              if (!section) return null;
              const anchorId = sectionAnchorId(kind);
              return (
                <SectionCard
                  key={kind}
                  kind={kind}
                  icon={SECTION_META[kind].icon}
                  title={t(`sections.${SECTION_META[kind].messageKey}.title`)}
                  section={section}
                  repoId={repoId}
                  open={isOpen(anchorId, true)}
                  onOpenChange={setOpenFor(anchorId)}
                >
                  {renderSectionContent(section, tour.provenance.githubUrl)}
                </SectionCard>
              );
            })}
            <CostPanel
              sections={tour.sections}
              open={isOpen(COST_ANCHOR_ID, false)}
              onOpenChange={setOpenFor(COST_ANCHOR_ID)}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
