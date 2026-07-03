"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Button, Skeleton, MonoLink } from "@devdigest/ui";
import type { WhyRiskBriefState } from "@devdigest/shared";
import { useGenerateWhyRiskBrief } from "@/lib/hooks/brief";
import { githubPrFileUrl } from "@/lib/github-urls";
import { s } from "./styles";

/**
 * MOCK review-focus items — presentation-only stand-in for the real
 * `state.brief.review_focus` list, which the current `WhyRiskFocusItem`
 * contract cannot yet supply (it carries only `{ path }`, no line/reason).
 *
 * TODO(SPEC-03 follow-up): replace with real `state.brief.review_focus` once
 * `WhyRiskFocusItem` carries `line`+`reason` — see
 * docs/plans/why-risk-brief-design-alignment.md "Deferred follow-ups".
 */
const MOCK_REVIEW_FOCUS: { path: string; line: number; reason: string }[] = [
  {
    path: "src/modules/billing/service.ts",
    line: 128,
    reason: "Core retry logic — the change's central behavior.",
  },
  {
    path: "src/modules/billing/routes.ts",
    line: 42,
    reason: "New endpoint wiring for the retry webhook.",
  },
  {
    path: "src/db/schema/billing.ts",
    line: 17,
    reason: "Schema change touching the retry_count column.",
  },
];

interface ReviewFocusProps {
  state: WhyRiskBriefState | undefined;
  isLoading: boolean;
  prId: string;
  repoFullName: string | null | undefined;
  prNumber: number;
}

/**
 * ReviewFocus — "Review focus — read these first" right-column section.
 *
 * Renders the mock, priority-ordered review-focus list with a visible count
 * badge when the brief is `ready` (AC-4/AC-5, realized against MOCK data —
 * see the TODO above); otherwise renders the unified "No brief yet" empty
 * state, gating only this brief-dependent content (AC-19). Owns
 * `useGenerateWhyRiskBrief` for the "Generate brief" action (AC-18) — never
 * auto-fires on mount (AC-16).
 */
export function ReviewFocus({ state, isLoading, prId, repoFullName, prNumber }: ReviewFocusProps) {
  const t = useTranslations("whyRiskBrief");
  const generate = useGenerateWhyRiskBrief(prId);

  const handleGenerate = () => {
    generate.mutate();
  };

  if (isLoading || state === undefined) {
    return (
      <section>
        <div style={s.card}>
          <CardHeader title={t("reviewFocus.title")} />
          <div style={{ padding: 16 }}>
            <Skeleton height={88} />
          </div>
        </div>
      </section>
    );
  }

  if (state.status === "ready") {
    return (
      <section>
        <div style={s.card}>
          <CardHeader
            title={t("reviewFocus.title")}
            count={t("reviewFocus.count", { count: MOCK_REVIEW_FOCUS.length })}
          />
          <ol style={s.list}>
            {MOCK_REVIEW_FOCUS.map((item, i) => (
              <li key={i} style={s.listItem}>
                <MonoLink href={githubPrFileUrl(repoFullName ?? "", prNumber, item.path)}>
                  {`${item.path}:${item.line}`}
                </MonoLink>
                <span style={s.reason}>{` — ${item.reason}`}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    );
  }

  // not_generated / not_available / skipped → the unified empty state (AC-19a).
  const reason =
    state.status === "not_available"
      ? t("notAvailableHint")
      : state.status === "skipped"
        ? t("skippedNoModel")
        : t("emptyState.subtitle");

  return (
    <section>
      <div style={s.card}>
        <CardHeader title={t("reviewFocus.title")} />
        <EmptyState
          heading={t("emptyState.heading")}
          reason={reason}
          showGenerate={state.status === "not_generated"}
          isPending={generate.isPending}
          generateLabel={t("generate")}
          generatingLabel={t("generating")}
          onGenerate={handleGenerate}
        />
      </div>
    </section>
  );
}

// ---- Sub-components --------------------------------------------------------

/**
 * In-card header for the Review-focus card — icon + uppercase title (mirrors
 * `SectionLabel`) with an optional count badge pinned to the right. Sits inside
 * the card (above a divider) so the title is part of the card, not a floating
 * label above it.
 */
function CardHeader({ title, count }: { title: string; count?: string }) {
  return (
    <div style={s.cardHeader}>
      <Icon.ListChecks size={14} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
      <span style={s.cardHeaderTitle}>{title}</span>
      {count != null && (
        <span style={{ ...s.countBadge, marginLeft: "auto" }}>{count}</span>
      )}
    </div>
  );
}

/** Unified empty-state shell for the brief-dependent Review-focus slot (AC-19a). */
function EmptyState({
  heading,
  reason,
  showGenerate,
  isPending,
  generateLabel,
  generatingLabel,
  onGenerate,
}: {
  heading: string;
  reason: string;
  showGenerate: boolean;
  isPending: boolean;
  generateLabel: string;
  generatingLabel: string;
  onGenerate: () => void;
}) {
  return (
    <div style={s.emptyWrap}>
      <div style={s.emptyIconBox}>
        <Icon.FileText size={22} aria-hidden="true" />
      </div>
      <p style={s.emptyHeading}>{heading}</p>
      <p style={s.emptySubtitle}>{reason}</p>
      {showGenerate && (
        <Button kind="primary" onClick={onGenerate} disabled={isPending}>
          {isPending ? generatingLabel : generateLabel}
        </Button>
      )}
    </div>
  );
}
