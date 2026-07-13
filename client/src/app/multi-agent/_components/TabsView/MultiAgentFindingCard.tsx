/* MultiAgentFindingCard — the Tabs-view finding card (SPEC-05 AC-22..25).

   Follows the existing FindingCard composition pattern
   (`app/repos/[repoId]/pulls/[number]/_components/FindingCard`) but is a NEW,
   always-expanded component that adds two actions the base card lacks — Learn
   and Turn into eval case — on top of Accept / Dismiss.

   The lean `AgentColumnFinding` (id/severity/category/title/file/start_line)
   carries neither confidence nor the suggested fix, so those (plus the
   rationale + persisted disposition) come from the enriched `FindingRecord`
   the parent `TabsView` looks up from `usePrReviews(prId)` and passes as
   `detail`. When no detail is found the confidence/fix/rationale rows are
   hidden and the actions still work off the finding id. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  CategoryTag,
  ConfidenceNum,
  Markdown,
  MonoLink,
  SeverityBadge,
  SEV,
  type Category,
  type Severity,
} from "@devdigest/ui";
import type { AgentColumnFinding, FindingRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useFindingAction } from "@/lib/hooks/reviews";
import { useLearnFinding } from "@/lib/hooks/multi-agent";
import { useCreateCaseFromFinding } from "@/lib/hooks/evals";
import { notify } from "@/lib/toast";
import { fc } from "./styles";

type Disposition = "none" | "accepted" | "dismissed";

/** The eval-case route (`POST /findings/:id/eval-case`) rejects with a
 *  no-decision error until the finding has been accepted/dismissed (AC-24). */
function isNoDecisionError(err: unknown): boolean {
  return err instanceof ApiError && (err.code === "no_decision" || err.status === 422);
}

export function MultiAgentFindingCard({
  finding,
  detail,
  prId,
}: {
  finding: AgentColumnFinding;
  /** Enriched persisted finding (confidence, suggestion, rationale, disposition
   *  timestamps). Absent → the enrichment lookup missed; rows degrade away. */
  detail?: FindingRecord;
  prId: string;
}) {
  const t = useTranslations("multiAgent");
  const action = useFindingAction();
  const learn = useLearnFinding();
  const evalCase = useCreateCaseFromFinding();

  // Disposition = the user's action this session if they acted, else whatever
  // the enriched detail persists. Keeping the local override null until an
  // action lets a later `usePrReviews` refetch flow through (AC-23/AC-31).
  const [localDisposition, setLocalDisposition] = React.useState<Disposition | null>(null);
  const persistedDisposition: Disposition = detail?.accepted_at
    ? "accepted"
    : detail?.dismissed_at
      ? "dismissed"
      : "none";
  const disposition = localDisposition ?? persistedDisposition;
  const accepted = disposition === "accepted";
  const dismissed = disposition === "dismissed";

  const sevColor = SEV[finding.severity as Severity]?.c ?? "var(--text-muted)";

  function handleAction(kind: "accept" | "dismiss") {
    action.mutate(
      { findingId: finding.id, action: kind, prId },
      { onSuccess: () => setLocalDisposition(kind === "accept" ? "accepted" : "dismissed") },
    );
  }

  function handleLearn() {
    learn.mutate(finding.id, {
      onSuccess: () => notify.success(t("tabs.learnConfirm")),
    });
  }

  function handleEvalCase() {
    // Gate on a prior disposition rather than firing a request we know the
    // server will reject — surface the helpful message either way (AC-24).
    if (disposition === "none") {
      notify.info(t("tabs.evalCaseNoDecision"));
      return;
    }
    evalCase.mutate(
      { findingId: finding.id },
      {
        // `already_added` is a benign, idempotent confirm — not an error.
        onSuccess: () => notify.success(t("tabs.evalCaseConfirm")),
        onError: (err) =>
          isNoDecisionError(err)
            ? notify.info(t("tabs.evalCaseNoDecision"))
            : notify.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }

  return (
    <div data-finding-id={finding.id} style={fc.card(sevColor, accepted || dismissed)}>
      <div style={fc.header}>
        <div style={{ paddingTop: 1 }}>
          <SeverityBadge severity={finding.severity as Severity} compact />
        </div>
        <div style={fc.headerMain}>
          <div style={fc.titleRow}>
            <span style={fc.title(dismissed)}>{finding.title}</span>
            <CategoryTag category={finding.category as Category} />
            {accepted && <span style={fc.tag("var(--ok)")}>{t("tabs.actions.accept")}</span>}
            {dismissed && <span style={fc.tag("var(--text-muted)")}>{t("tabs.actions.dismiss")}</span>}
          </div>
          <div style={fc.metaRow}>
            <MonoLink>
              {finding.file}:{finding.start_line}
            </MonoLink>
          </div>
        </div>
      </div>

      <div style={fc.body}>
        {detail && (
          <div style={fc.section}>
            <div style={fc.sectionLabel}>{t("tabs.confidence")}</div>
            <ConfidenceNum value={detail.confidence} />
          </div>
        )}

        {detail?.rationale && (
          <div style={fc.section}>
            <div style={fc.prose}>
              <Markdown>{detail.rationale}</Markdown>
            </div>
          </div>
        )}

        {detail?.suggestion && (
          <div style={fc.section}>
            <div style={fc.sectionLabel}>{t("tabs.suggestedFix")}</div>
            <div style={fc.prose}>
              <Markdown>{detail.suggestion}</Markdown>
            </div>
          </div>
        )}

        <div style={fc.actions}>
          <Button
            kind="secondary"
            size="sm"
            icon="Check"
            active={accepted}
            aria-pressed={accepted}
            disabled={action.isPending}
            onClick={() => handleAction("accept")}
          >
            {t("tabs.actions.accept")}
          </Button>
          <Button
            kind="ghost"
            size="sm"
            icon="X"
            active={dismissed}
            aria-pressed={dismissed}
            disabled={action.isPending}
            onClick={() => handleAction("dismiss")}
          >
            {t("tabs.actions.dismiss")}
          </Button>
          <Button
            kind="ghost"
            size="sm"
            icon="Brain"
            disabled={learn.isPending}
            onClick={handleLearn}
          >
            {t("tabs.actions.learn")}
          </Button>
          <Button
            kind="ghost"
            size="sm"
            icon="FlaskConical"
            disabled={evalCase.isPending}
            onClick={handleEvalCase}
          >
            {t("tabs.actions.evalCase")}
          </Button>
        </div>
      </div>
    </div>
  );
}
