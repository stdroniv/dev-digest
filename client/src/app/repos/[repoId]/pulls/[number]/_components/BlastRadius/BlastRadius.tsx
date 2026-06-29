"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel, Skeleton } from "@devdigest/ui";
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

  if (isLoading) {
    return (
      <section>
        <SectionLabel icon="Workflow">Blast Radius</SectionLabel>
        <div style={s.card}>
          <div style={{ padding: 16 }}>
            <Skeleton height={120} />
          </div>
        </div>
      </section>
    );
  }

  const isDegraded =
    data?.degraded === true || data?.index?.degraded === true;
  const isPartial = data?.index?.status === "partial";
  // Limited cross-file resolution — distinct informational note, NOT the
  // degraded/partial badge. Does NOT gate isEmpty.
  const isLimited = data?.resolution?.limited === true;
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
      {/* Step 8: section icon GitMerge → Workflow (confirmed against design source) */}
      <SectionLabel icon="Workflow">Blast Radius</SectionLabel>

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
          {/* Step 6: per-stat icon groups; each rendered as icon + template-literal text node
              so getByText(/N label/) finds exactly the stat item span (getNodeText reads
              direct text nodes only, not descendant element text). */}
          <div style={s.statRow}>
            <span style={s.statItem}>
              <Icon.Code size={13} style={{ color: "var(--text-muted)" }} />
              {`${totals.symbols} ${t("stat.symbols")}`}
            </span>
            <span style={s.statItem}>
              <Icon.CornerDownRight size={13} style={{ color: "var(--text-muted)" }} />
              {`${totals.callers} ${t("stat.callers")}`}
            </span>
            <span style={s.statItem}>
              <Icon.Globe size={13} style={{ color: "var(--text-muted)" }} />
              {`${totals.endpoints} ${t("stat.endpoints")}`}
            </span>
            <span style={s.statItem}>
              <Icon.Clock size={13} style={{ color: "var(--text-muted)" }} />
              {`${totals.crons} ${t("stat.crons")}`}
            </span>
          </div>

          {/* Step 9: segmented toggle control — container wraps both buttons */}
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
            {isLimited && (
              <div style={s.noCallersNote} role="note">
                {t("resolution.note")}
              </div>
            )}
            {(data?.symbols ?? []).map((group, i) => (
              <SymbolRow
                key={`${group.file}:${group.name}:${i}`}
                group={group}
                repoFullName={repoFullName}
                indexedSha={indexedSha}
                t={t}
                defaultOpen={i === 0}
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

/** Appends "()" only for callable kinds (function/method); bare name otherwise. */
function displayName(group: BlastSymbolGroup): string {
  return group.kind === "function" || group.kind === "method"
    ? `${group.name}()`
    : group.name;
}

function SymbolRow({
  group,
  repoFullName,
  indexedSha,
  t,
  defaultOpen,
}: {
  group: BlastSymbolGroup;
  repoFullName: string | null | undefined;
  indexedSha: string | null;
  t: ReturnType<typeof useTranslations<"blast">>;
  defaultOpen: boolean;
}) {
  // Step 7: first symbol open, rest collapsed (matches design; keeps caller-link tests green)
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div style={s.symbolRow}>
      {/* Step 7: collapsible header row with chevron button, code chip, file, badges, count */}
      <div style={s.symbolHeader}>
        {/* Chevron: one ChevronRight rotated 90° when open */}
        <button
          style={s.chevronBtn}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={t("symbolToggle", { name: group.name })}
        >
          <Icon.ChevronRight
            size={14}
            style={{
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform .12s",
            }}
          />
        </button>

        {/* Step 7: Code chip — icon + monospace displayName (no kind label) */}
        <span style={s.symbolChip}>
          <Icon.Code size={12} style={{ color: "var(--accent)" }} />
          <span style={s.symbolName}>{displayName(group)}</span>
        </span>

        <span style={s.symbolFile} title={group.file}>{group.file}</span>

        {/* Step 9: endpoint badges with Globe icon; cron badges with Clock icon */}
        {group.endpoints.map((ep, ei) => (
          <span key={`ep-${ei}`} style={{ ...s.badge, ...s.endpointBadge }}>
            <Icon.Globe size={12} />
            {ep}
          </span>
        ))}
        {group.crons.map((cron, ci) => (
          <span key={`cron-${ci}`} style={{ ...s.badge, ...s.cronBadge }}>
            <Icon.Clock size={12} />
            {cron}
          </span>
        ))}

        {/* Step 7: per-symbol caller count — right-aligned plain muted text (NOT a pill) */}
        <span style={s.symbolCount}>
          {t("callerCount", { count: group.callers.length })}
        </span>
      </div>

      {/* Caller list renders only when open and callers exist */}
      {open && group.callers.length > 0 && (
        <ul
          style={s.callerList}
          aria-label={t("callerCount", { count: group.callers.length })}
        >
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
      {/* Step 7: CornerDownRight connector as a SEPARATE element so the file:line
          label stays its own text node (caller-link tests unaffected) */}
      <span aria-hidden="true" style={s.callerConnector}>
        <Icon.CornerDownRight size={11} />
      </span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={s.callerLink}
          aria-label={t("clickToCode.aria", { file: caller.file, line: caller.line })}
          title={label}
        >
          {label}
        </a>
      ) : (
        <span style={s.callerLinkPlain} title={label}>{label}</span>
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
