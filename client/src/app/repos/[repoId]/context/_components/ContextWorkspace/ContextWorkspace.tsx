/* ContextWorkspace — the Project Context screen for one repo (SPEC-01 R1).
   Left: searchable list of `.md` documents discovered under the repo's
   configured root folders, each tagged with its origin root. Right: a
   read-only preview of the selected document's current content. Handles the
   three server-reported states distinctly: `ready` (list + preview), `empty`
   (AC-4 — explains docs can be added and are read as grounding) and
   `not_cloned` (AC-5 — explains discovery needs a clone first), never
   collapsing either into a generic error/empty view. */
"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, Skeleton, TextInput } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useRepoDocuments, useDocumentPreview } from "@/lib/hooks/documents";
import { ApiError } from "@/lib/api";
import { s } from "./styles";

export function ContextWorkspace({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isFetching, isError, error, refetch } = useRepoDocuments(repoId);
  const [query, setQuery] = React.useState("");

  const selectedPath = searchParams.get("doc");
  const preview = useDocumentPreview(repoId, selectedPath);

  const repoName = activeRepo?.full_name ?? repoId;
  const documents = data?.documents ?? [];
  const state = data?.state ?? "ready";
  const filtered = documents.filter((doc) =>
    doc.path.toLowerCase().includes(query.trim().toLowerCase()),
  );

  // Selecting a doc is an intra master/detail navigation — scroll:false keeps
  // the list from resetting its scroll position (client/INSIGHTS).
  const select = (path: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("doc", path);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const crumb = [{ label: repoName, mono: true, href: `/repos/${repoId}/pulls` }, { label: t("title") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <h1 style={s.title}>{t("title")}</h1>
            {!isLoading && !isError && state === "ready" && (
              <p style={s.subtitle}>{t("page.docCount", { count: documents.length })}</p>
            )}
          </div>
          <div style={s.headerActions}>
            <Button kind="secondary" icon="RefreshCw" loading={isFetching} onClick={() => refetch()}>
              {t("page.refresh")}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div style={s.stack}>
            <Skeleton height={44} />
            <Skeleton height={320} />
          </div>
        ) : isError ? (
          <ErrorState
            title={t("loadError")}
            body={error instanceof ApiError ? error.message : undefined}
            onRetry={() => refetch()}
          />
        ) : state === "not_cloned" ? (
          <EmptyState icon="GitBranch" title={t("notCloned.title")} body={t("notCloned.body")} />
        ) : state === "empty" ? (
          <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
        ) : (
          <div style={s.workspace}>
            <div style={s.listPane}>
              <TextInput
                value={query}
                onChange={setQuery}
                placeholder={t("page.searchPlaceholder")}
              />
              <div style={s.list}>
                {filtered.length === 0 ? (
                  <div style={s.noMatches}>{t("page.noMatches")}</div>
                ) : (
                  filtered.map((doc) => (
                    <button
                      key={doc.path}
                      type="button"
                      style={{
                        ...s.docRow,
                        ...(doc.path === selectedPath ? s.docRowActive : {}),
                      }}
                      onClick={() => select(doc.path)}
                      aria-pressed={doc.path === selectedPath}
                    >
                      <Icon.FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                      <span className="mono" style={s.docPath} title={doc.path}>
                        {doc.path}
                      </span>
                      <Badge mono>{doc.root}</Badge>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div style={s.previewPane}>
              {!selectedPath ? (
                <div style={s.previewCenter}>
                  <EmptyState icon="Eye" title={t("preview.selectPrompt")} />
                </div>
              ) : preview.isLoading ? (
                <div style={{ padding: 16 }}>
                  <Skeleton height={280} />
                </div>
              ) : preview.isError || !preview.data ? (
                <div style={s.previewCenter}>
                  <ErrorState title={t("preview.loadError")} onRetry={() => preview.refetch()} />
                </div>
              ) : (
                <>
                  <div className="mono" style={s.previewHeader}>
                    {preview.data.path}
                  </div>
                  <pre style={s.previewContent}>{preview.data.content}</pre>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
