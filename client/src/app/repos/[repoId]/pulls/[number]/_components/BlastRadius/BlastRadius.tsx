"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { useBlastRadius, useBlastSummary } from "@/lib/hooks/blast";
import { blastCallerUrl } from "@/lib/github-urls";
import type { BlastSymbolGroup, BlastCallerEntry } from "@/lib/types";
import { BlastGraph } from "./BlastGraph";
import { s } from "./styles";

interface BlastRadiusProps {
  prId: string | null | undefined;
  repoFullName: string | null | undefined;
}

type ViewMode = "tree" | "graph";

/**
 * BlastRadius panel — embedded in the Overview tab.
 *
 * Shows changed symbols, their cross-file callers (with click-to-code blob
 * links at the indexed SHA), reachable HTTP endpoints + cron jobs, a
 * Tree | Graph toggle, and honest empty / degraded states.
 *
 * The optional LLM summary is gated behind a user-initiated button so the
 * single model call never fires on panel mount.
 */
export function BlastRadius({ prId, repoFullName }: BlastRadiusProps) {
  const t = useTranslations("blast");
  const { data, isLoading } = useBlastRadius(prId);
  const [view, setView] = React.useState<ViewMode>("tree");
  const [summaryEnabled, setSummaryEnabled] = React.useState(false);
  const { data: summaryData, isLoading: summaryLoading } = useBlastSummary(
    prId,
    { enabled: summaryEnabled },
  );

  if (isLoading) return null;

  const isDegraded =
    data?.degraded === true || data?.index?.degraded === true;
  const isPartial = data?.index?.status === "partial";
  const totals = data?.totals ?? {
    symbols: 0,
    callers: 0,
    endpoints: 0,
    crons: 0,
  };
  const indexedSha = data?.index?.lastIndexedSha ?? null;
  // Empty ONLY when there are no changed symbols. A PR whose changed symbols have
  // no resolved downstream callers still has symbols worth listing — collapsing the
  // whole panel to a one-line message (the old `|| !hasCallers`) hid every symbol.
  const isEmpty = !data || totals.symbols === 0;
  // Symbols exist but nothing downstream resolved — show the symbols + a note.
  const noCallers = !isEmpty && totals.callers === 0;

  return (
    <section>
      <SectionLabel icon="GitMerge">Blast Radius</SectionLabel>

      {isDegraded && (
        <div style={s.degradedBadge} role="status" aria-label={t("degraded.badge")}>
          {t("degraded.badge")}
        </div>
      )}
      {!isDegraded && isPartial && (
        <div style={s.degradedBadge} role="status" aria-label={t("partial.badge")}>
          {t("partial.badge")}
        </div>
      )}

      <div style={s.card}>
        {/* Header: stat summary + Tree | Graph toggle */}
        <div style={s.header}>
          <span style={s.statRow}>
            {`${totals.symbols} ${t("stat.symbols")} · ${totals.callers} ${t("stat.callers")} · ${totals.endpoints} ${t("stat.endpoints")} · ${totals.crons} ${t("stat.crons")}`}
          </span>
          <div style={s.toggleGroup}>
            <button
              style={{
                ...s.toggleBtn,
                ...(view === "tree" ? s.toggleBtnActive : {}),
              }}
              onClick={() => setView("tree")}
              aria-pressed={view === "tree"}
            >
              {t("view.tree")}
            </button>
            <button
              style={{
                ...s.toggleBtn,
                ...(view === "graph" ? s.toggleBtnActive : {}),
              }}
              onClick={() => setView("graph")}
              aria-pressed={view === "graph"}
            >
              {t("view.graph")}
            </button>
          </div>
        </div>

        {/* Empty state — no changed symbols at all */}
        {isEmpty ? (
          <div style={s.emptyState}>{t("empty")}</div>
        ) : view === "graph" ? (
          <BlastGraph
            symbols={data?.symbols ?? []}
            repoFullName={repoFullName}
            indexedSha={indexedSha}
          />
        ) : (
          /* Tree view — always lists the changed symbols */
          <div style={s.tree}>
            {noCallers && (
              <div style={s.noCallersNote}>
                {t("noDownstream", { count: totals.symbols })}
              </div>
            )}
            {(data?.symbols ?? []).map((group, i) => (
              <SymbolRow
                key={`${group.file}:${group.name}:${i}`}
                group={group}
                repoFullName={repoFullName}
                indexedSha={indexedSha}
                t={t}
              />
            ))}
          </div>
        )}

        {/* Optional LLM summary disclosure */}
        <SummarySection
          enabled={summaryEnabled}
          onEnable={() => setSummaryEnabled(true)}
          isLoading={summaryLoading}
          summaryText={summaryData?.summary ?? null}
          skipped={summaryData?.skipped}
          t={t}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SymbolRow({
  group,
  repoFullName,
  indexedSha,
  t,
}: {
  group: BlastSymbolGroup;
  repoFullName: string | null | undefined;
  indexedSha: string | null;
  t: ReturnType<typeof useTranslations<"blast">>;
}) {
  return (
    <div style={s.symbolRow}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={s.symbolName}>{group.name}</span>
        <span style={s.symbolKind}>{group.kind}</span>
        <span style={s.symbolFile}>{group.file}</span>
        {group.endpoints.map((ep, ei) => (
          <span key={`ep-${ei}`} style={{ ...s.badge, ...s.endpointBadge }}>
            {ep}
          </span>
        ))}
        {group.crons.map((cron, ci) => (
          <span key={`cron-${ci}`} style={{ ...s.badge, ...s.cronBadge }}>
            {cron}
          </span>
        ))}
      </div>

      {group.callers.length > 0 && (
        <ul style={s.callerList} aria-label={t("callerCount", { count: group.callers.length })}>
          {group.callers.map((caller, ci) => (
            <CallerItem
              key={`${caller.file}:${caller.line}:${ci}`}
              caller={caller}
              repoFullName={repoFullName}
              indexedSha={indexedSha}
              t={t}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CallerItem({
  caller,
  repoFullName,
  indexedSha,
  t,
}: {
  caller: BlastCallerEntry;
  repoFullName: string | null | undefined;
  indexedSha: string | null;
  t: ReturnType<typeof useTranslations<"blast">>;
}) {
  const href = blastCallerUrl(repoFullName, indexedSha, caller.file, caller.line);
  const label = `${caller.file}:${caller.line}`;

  return (
    <li style={s.callerItem}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={s.callerLink}
          aria-label={t("clickToCode.aria", { file: caller.file, line: caller.line })}
        >
          {label}
        </a>
      ) : (
        <span style={s.callerLinkPlain}>{label}</span>
      )}
    </li>
  );
}

function SummarySection({
  enabled,
  onEnable,
  isLoading,
  summaryText,
  skipped,
  t,
}: {
  enabled: boolean;
  onEnable: () => void;
  isLoading: boolean;
  summaryText: string | null;
  skipped?: "no_key" | "no_data";
  t: ReturnType<typeof useTranslations<"blast">>;
}) {
  // Hide cleanly when no key or no data — no error UI.
  if (enabled && !isLoading && (summaryText === null || skipped)) {
    return null;
  }

  return (
    <div style={s.summarySection}>
      {!enabled ? (
        <button style={s.summaryBtn} onClick={onEnable}>
          {t("summary.show")}
        </button>
      ) : isLoading ? (
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("summary.loading")}
        </span>
      ) : summaryText ? (
        <p style={s.summaryText}>{summaryText}</p>
      ) : null}
    </div>
  );
}
