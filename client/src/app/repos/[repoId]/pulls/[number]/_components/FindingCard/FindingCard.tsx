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
import type { EvalCase, FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubPrFileUrl } from "@/lib/github-urls";
import { useFindingEvalCasePreview } from "@/lib/hooks/evals";
import { CaseEditorModal } from "@/components/evals/CaseEditorModal";
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

  // Gap 2 — "Turn into eval case" opens a pre-filled, reviewable modal instead
  // of directly saving. The preview is fetched ONLY once the user opens it
  // (`enabled: evalModalOpen`) — an eager per-card GET + `loadDiff` on every
  // render would be wasteful (client/INSIGHTS.md gotcha). `already_added` on
  // the fetched preview is the real cross-session idempotency signal (AC-5) —
  // not a client-only session guard — so re-clicking the same finding always
  // routes back through the server.
  const [evalModalOpen, setEvalModalOpen] = React.useState(false);
  const { data: preview } = useFindingEvalCasePreview(f.id, evalModalOpen);
  const notifiedAlreadyAddedRef = React.useRef(false);

  React.useEffect(() => {
    if (!evalModalOpen) {
      notifiedAlreadyAddedRef.current = false;
      return;
    }
    if (preview?.already_added && preview.existing_case && !notifiedAlreadyAddedRef.current) {
      notifiedAlreadyAddedRef.current = true;
      notify.info(tEvals("findingCard.alreadyAddedConfirmation", { name: preview.existing_case.name }));
    }
  }, [evalModalOpen, preview, tEvals]);

  function handleTurnIntoEvalCase() {
    if (!hasDecision) return; // defense-in-depth; the button is already disabled
    setEvalModalOpen(true);
  }

  function closeEvalModal() {
    setEvalModalOpen(false);
  }

  function handleSeededSaved(result: { case: EvalCase; already_added: boolean }) {
    notify.success(
      result.already_added
        ? tEvals("findingCard.alreadyAddedConfirmation", { name: result.case.name })
        : tEvals("findingCard.confirmation", { name: result.case.name }),
    );
  }

  const caseAdded = preview?.already_added === true;
  const evalButtonLabel = caseAdded
    ? tEvals("findingCard.alreadyAdded")
    : tEvals("findingCard.turnIntoEvalCase");

  return (
    <>
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
                disabled={!hasDecision}
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
      {evalModalOpen && preview && (
        preview.already_added && preview.existing_case ? (
          <CaseEditorModal
            mode="edit"
            owner={{ kind: "agent", id: preview.existing_case.owner_id }}
            evalCase={preview.existing_case}
            lastRun={null}
            onClose={closeEvalModal}
          />
        ) : (
          <CaseEditorModal
            mode="seeded"
            owner={{ kind: "agent", id: preview.owner_id }}
            evalCase={null}
            lastRun={null}
            seed={{ findingId: f.id, draft: preview }}
            onSaved={handleSeededSaved}
            onClose={closeEvalModal}
          />
        )
      )}
    </>
  );
}
