/* VerdictBanner — ported from findings.jsx.
   request_changes / approve / comment + summary + finding/blocker counts + score. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Button, CircularScore } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";
import { formatUsd } from "@/lib/cost";
import { VERDICT_META } from "./constants";
import { s } from "./styles";

/** Token in→out summary in the design's `8.2K→1.3K` style (capital K, 1 decimal). */
function formatTokenFlow(tokensIn: number, tokensOut: number): string {
  const k = (n: number) => `${(n / 1000).toFixed(1)}K`;
  return `${k(tokensIn)}→${k(tokensOut)}`;
}

export function VerdictBanner({
  verdict,
  summary,
  score,
  findingsCount,
  blockers,
  agentName,
  costUsd,
  tokensIn,
  tokensOut,
  brief,
  onRegenerate,
  regenerating,
}: {
  verdict: Verdict;
  summary: string | null;
  score: number | null;
  findingsCount: number;
  blockers: number;
  agentName?: string | null;
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  /** WHEN present (brief `ready`), replaces `summary` with the brief's what/why
   *  as the header prose (AC-2), and surfaces the stale (AC-21) / docs-truncated
   *  (AC-31) indications. `null`/absent keeps the current `summary` fallback. */
  brief?: { what: string; why: string; stale: boolean; docsTruncated: boolean } | null;
  /** Regenerate the Why+Risk Brief in place. Rendered ONLY when a `ready` brief
   *  is present (i.e. `brief` is non-null) — the banner has no generate CTA for
   *  the not-yet-generated case (that lives in the ReviewFocus empty state). */
  onRegenerate?: () => void;
  /** True while the regenerate POST is in flight — spins the icon + disables. */
  regenerating?: boolean;
}) {
  const t = useTranslations("prReview");
  // Called unconditionally (rules of hooks); the two keys are only RESOLVED
  // inside the `brief`-present branches below, so a caller that never passes
  // `brief` (e.g. ReviewRunAccordion) never triggers MISSING_MESSAGE for a
  // namespace it doesn't provide.
  const tw = useTranslations("whyRiskBrief");
  const m = VERDICT_META[verdict] ?? VERDICT_META.comment;
  const VIcon = Icon[m.icon];
  const hasTokens = tokensIn != null && tokensOut != null;
  const hasStats = costUsd != null || hasTokens;
  return (
    <div style={s.wrap}>
      <div style={s.iconBox(m.bg, m.c)}>
        <VIcon size={22} />
      </div>
      <div style={s.main}>
        <div style={s.titleRow}>
          <span style={s.label(m.c)}>{t(`verdict.${m.labelKey}`)}</span>
          <Badge color="var(--text-secondary)">
            {t("verdict.findingsCount", { count: findingsCount })}
            {blockers > 0 ? t("verdict.blockers", { count: blockers }) : ""}
          </Badge>
          {agentName && (
            <Badge color="var(--accent-text)" bg="var(--accent-bg)" icon="Cpu">
              {agentName}
            </Badge>
          )}
          {brief?.stale && (
            <span style={s.staleBadge}>
              <Icon.Clock size={11} aria-hidden="true" />
              {tw("stale")}
            </span>
          )}
        </div>
        {brief ? (
          <>
            <p style={s.summary}>{brief.what}</p>
            <p style={s.whySummary}>{brief.why}</p>
            {brief.docsTruncated && <p style={s.truncatedNote}>{tw("docsTruncated")}</p>}
          </>
        ) : (
          summary && <p style={s.summary}>{summary}</p>
        )}
      </div>
      {brief && onRegenerate && (
        <Button
          kind="tertiary"
          icon="RefreshCw"
          loading={regenerating}
          onClick={onRegenerate}
          aria-label={regenerating ? tw("regenerating") : tw("regenerate")}
          title={regenerating ? tw("regenerating") : tw("regenerate")}
          style={{ alignSelf: "flex-start", flexShrink: 0 }}
        />
      )}
      {score != null && (
        <div style={s.scoreCol}>
          <CircularScore score={score} size={52} stroke={5} />
          <span style={s.scoreLabel}>{t("verdict.prScore")}</span>
          {hasStats && (
            <span className="mono tnum" style={s.scoreStat}>
              {costUsd != null && (
                <span style={s.scoreCost}>
                  <Icon.DollarSign size={11} />
                  {formatUsd(costUsd)}
                </span>
              )}
              {hasTokens && (
                <span style={s.scoreTokens}>{formatTokenFlow(tokensIn, tokensOut)}</span>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
