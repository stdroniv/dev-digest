/* ConventionsWorkspace — the Conventions Extractor surface for one repo.
   "Analyze repo" runs a scan (sample → cheap model → verify → persist); the
   verified candidates render as cards the user can accept / reject / edit. Once
   ≥1 is accepted, "Create skill" opens a pre-filled, editable modal that saves a
   single `repo-conventions` skill (source=extracted). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Skeleton, EmptyState, ErrorState, Badge } from "@devdigest/ui";
import type { ConventionCandidate, ConventionStatus } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import {
  useConventions,
  useExtractConventions,
  usePatchConvention,
  useConventionSkillPreview,
  type ConventionSkillPreview,
} from "@/lib/hooks/conventions";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillModal } from "../CreateSkillModal";
import { st } from "./styles";

export function ConventionsWorkspace({ repoId }: { repoId: string }) {
  const t = useTranslations("conventions");
  const toast = useToast();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: conventions, isLoading, isError, error, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const patch = usePatchConvention();
  const skillPreview = useConventionSkillPreview(repoId);

  const [modalPreview, setModalPreview] = React.useState<ConventionSkillPreview | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const repoName = activeRepo?.full_name ?? repoId;
  const repoShort = activeRepo?.name ?? repoName;
  const repoRef = activeRepo?.default_branch ?? "HEAD";
  const list = conventions ?? [];
  const acceptedCount = list.filter((c) => c.status === "accepted").length;
  const hasScanned = list.length > 0;

  const crumb = [
    { label: t("page.crumbLab") },
    { label: repoName, mono: true },
    { label: t("page.crumbConventions") },
  ];

  async function runScan() {
    try {
      const found = await extract.mutateAsync();
      toast.success(t("toast.scanDone", { count: found.length }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("page.extractionFailed"));
    }
  }

  async function setStatus(c: ConventionCandidate, status: ConventionStatus) {
    setPendingId(c.id);
    try {
      // Toggle off when re-clicking the active state.
      const next: ConventionStatus = c.status === status ? "pending" : status;
      await patch.mutateAsync({ id: c.id, repoId, patch: { status: next } });
      if (next === "accepted") toast.success(t("toast.accepted"));
      else if (next === "rejected") toast.success(t("toast.rejected"));
    } finally {
      setPendingId(null);
    }
  }

  async function editCandidate(c: ConventionCandidate, p: { category: string; rule: string }) {
    setPendingId(c.id);
    try {
      await patch.mutateAsync({ id: c.id, repoId, patch: p });
      toast.success(t("toast.edited"));
    } finally {
      setPendingId(null);
    }
  }

  async function openCreateSkill() {
    const preview = await skillPreview.mutateAsync();
    setModalPreview(preview);
  }

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={st.page}>
      <div style={st.header}>
        <div>
          <h1 style={st.title}>
            {t("page.headingPrefix")}
            <span className="mono" style={st.titleRepo}>
              {repoShort}
            </span>
          </h1>
          <p style={st.subtitle}>
            {hasScanned ? t("page.candidateCount", { count: list.length }) : t("page.subtitle")}
          </p>
        </div>
        <div style={st.headerActions}>
          {hasScanned && (
            <Button
              kind="primary"
              icon="Sparkles"
              disabled={acceptedCount === 0 || skillPreview.isPending}
              loading={skillPreview.isPending}
              onClick={openCreateSkill}
            >
              {t("page.createSkillCount", { count: acceptedCount })}
            </Button>
          )}
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={extract.isPending}
            onClick={runScan}
          >
            {hasScanned ? t("page.rescan") : t("page.runExtraction")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div style={st.stack}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={150} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title={t("page.extractionFailed")}
          body={error instanceof ApiError ? error.message : t("page.loadError")}
          onRetry={() => refetch()}
        />
      ) : extract.isPending && !hasScanned ? (
        <div style={st.stack}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={150} />
          ))}
        </div>
      ) : !hasScanned ? (
        <EmptyState
          icon="ListChecks"
          title={t("page.empty.title")}
          body={t("page.empty.body")}
          cta={t("page.empty.cta")}
          onCta={runScan}
          ctaLoading={extract.isPending}
        />
      ) : (
        <div style={st.stack}>
          {acceptedCount > 0 && (
            <Badge color="var(--ok)" bg="var(--ok-bg, #052e1c)" icon="Check">
              {t("page.acceptedCount", { count: acceptedCount })}
            </Badge>
          )}
          {list.map((c) => (
            <ConventionCard
              key={c.id}
              candidate={c}
              repoFullName={activeRepo?.full_name ?? ""}
              repoRef={repoRef}
              busy={pendingId === c.id}
              onAccept={() => setStatus(c, "accepted")}
              onReject={() => setStatus(c, "rejected")}
              onEdit={(p) => editCandidate(c, p)}
            />
          ))}
        </div>
      )}
      </div>

      {modalPreview && (
        <CreateSkillModal
          preview={modalPreview}
          acceptedCount={acceptedCount}
          repoName={repoShort}
          onClose={() => setModalPreview(null)}
        />
      )}
    </AppShell>
  );
}
