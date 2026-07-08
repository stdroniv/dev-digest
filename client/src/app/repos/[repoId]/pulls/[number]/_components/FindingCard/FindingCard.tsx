/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubPrFileUrl } from "@/lib/github-urls";
import { useCreateCaseFromFinding } from "@/lib/hooks/evals";
import { notify } from "@/lib/toast";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  prNumber,
  pathSha,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  prNumber?: number | null;
  /** SHA-256 of `f.file` for the PR-files diff anchor; absent → bare /files link. */
  pathSha?: string;
}) {
  const t = useTranslations("prReview");
  const tEvals = useTranslations("evals");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && prNumber != null
      ? githubPrFileUrl(repoFullName, prNumber, f.file, f.start_line, f.end_line, pathSha)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;
  const hasDecision = accepted || dismissed;

  const createCase = useCreateCaseFromFinding();
  // The server is the source of truth for idempotency across sessions/reloads
  // (AC-5): `already_added` on the mutation result is a real cross-session
  // signal, not a client-only session guard. `caseAdded` mirrors that the
  // finding now has a case (freshly created or pre-existing); `wasAlreadyAdded`
  // remembers WHICH of the two it was, so the button label can distinguish
  // "Added" (this click created it) from "Already added" (it already existed).
  const [caseAdded, setCaseAdded] = React.useState(false);
  const [wasAlreadyAdded, setWasAlreadyAdded] = React.useState(false);

  function handleTurnIntoEvalCase() {
    if (caseAdded) {
      notify.info(tEvals("findingCard.alreadyAdded"));
      return;
    }
    createCase.mutate(f.id, {
      onSuccess: (data) => {
        setCaseAdded(true);
        setWasAlreadyAdded(data.already_added);
        notify.success(
          data.already_added
            ? tEvals("findingCard.alreadyAddedConfirmation", { name: data.case.name })
            : tEvals("findingCard.confirmation", { name: data.case.name }),
        );
      },
      onError: (err) => {
        notify.error(err instanceof Error ? err.message : "Couldn't create the eval case.");
      },
    });
  }

  const evalButtonLabel = !caseAdded
    ? tEvals("findingCard.turnIntoEvalCase")
    : wasAlreadyAdded
      ? tEvals("findingCard.alreadyAdded")
      : tEvals("findingCard.added");

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              disabled={!hasDecision || createCase.isPending}
              active={caseAdded}
              title={!hasDecision ? tEvals("findingCard.noDecisionTooltip") : undefined}
              onClick={handleTurnIntoEvalCase}
            >
              {evalButtonLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
