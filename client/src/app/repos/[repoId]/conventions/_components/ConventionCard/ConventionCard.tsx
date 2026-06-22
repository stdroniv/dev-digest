/* ConventionCard — one detected convention candidate: category + rule, a
   confidence bar, the proving code snippet (clickable through to the real file
   on GitHub), and Accept / Reject / Edit controls. Matches the Conventions
   screenshot. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ProgressBar, Icon, TextInput, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { st } from "./styles";

export interface ConventionCardProps {
  candidate: ConventionCandidate;
  /** owner/name — used to build the GitHub evidence link. */
  repoFullName: string;
  /** Branch (or sha) the evidence link pins to. */
  repoRef: string;
  busy?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEdit: (patch: { category: string; rule: string }) => void;
}

/** Confidence bar colour: green when strong, amber mid, red weak. */
function confidenceColor(c: number): string {
  if (c >= 0.8) return "var(--ok)";
  if (c >= 0.6) return "var(--warn, #d99a2b)";
  return "var(--crit)";
}

export function ConventionCard({
  candidate,
  repoFullName,
  repoRef,
  busy,
  onAccept,
  onReject,
  onEdit,
}: ConventionCardProps) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [category, setCategory] = React.useState(candidate.category ?? "");
  const [rule, setRule] = React.useState(candidate.rule);

  const accepted = candidate.status === "accepted";
  const rejected = candidate.status === "rejected";
  const confidence = candidate.confidence ?? 0;
  const start = candidate.evidence_start_line ?? undefined;
  const end = candidate.evidence_end_line ?? undefined;
  const lineLabel =
    start != null ? (end != null && end !== start ? `${start}-${end}` : `${start}`) : "";
  const evidenceLabel = candidate.evidence_path
    ? `${candidate.evidence_path}${lineLabel ? `:${lineLabel}` : ""}`
    : "";
  const href =
    candidate.evidence_path && repoFullName
      ? githubBlobUrl(repoFullName, repoRef, candidate.evidence_path, start, end)
      : undefined;

  const accent = accepted ? "var(--ok)" : rejected ? "var(--border-strong)" : "var(--accent)";

  function saveEdit() {
    onEdit({ category: category.trim(), rule: rule.trim() });
    setEditing(false);
  }

  return (
    <div style={st.card(accent, rejected)} data-testid="convention-card">
      <div style={st.body}>
        <div style={st.header}>
          {candidate.category && !editing && (
            <Badge color="var(--accent)" bg="var(--accent-bg, rgba(80,120,255,.12))">
              {candidate.category}
            </Badge>
          )}
          {editing ? (
            <div style={st.editFields}>
              <TextInput value={category} onChange={setCategory} placeholder={t("card.category")} />
              <Textarea value={rule} onChange={setRule} rows={2} placeholder={t("card.rule")} />
            </div>
          ) : (
            <h3 style={st.rule}>{candidate.rule}</h3>
          )}
        </div>

        {evidenceLabel && (
          <div style={st.evidence}>
            <div style={st.evidenceHead}>
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" style={st.evidenceLink}>
                  <span className="mono">{evidenceLabel}</span>
                  <Icon.ExternalLink size={13} />
                </a>
              ) : (
                <span className="mono" style={st.evidencePath}>
                  {evidenceLabel}
                </span>
              )}
            </div>
            {candidate.evidence_snippet && (
              <pre style={st.snippet} className="mono">
                {candidate.evidence_snippet}
              </pre>
            )}
          </div>
        )}

        <div style={st.confidenceRow}>
          <span style={st.confidenceLabel}>{t("card.confidence")}</span>
          <div style={st.confidenceBar}>
            <ProgressBar value={confidence * 100} color={confidenceColor(confidence)} />
          </div>
          <span style={st.confidencePct}>{Math.round(confidence * 100)}%</span>
        </div>
      </div>

      <div style={st.actions}>
        {editing ? (
          <>
            <Button kind="primary" size="sm" icon="Check" onClick={saveEdit} disabled={busy}>
              {t("card.save")}
            </Button>
            <Button kind="secondary" size="sm" onClick={() => setEditing(false)} disabled={busy}>
              {t("card.cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button
              kind={accepted ? "primary" : "secondary"}
              size="sm"
              icon="Check"
              active={accepted}
              loading={busy}
              onClick={onAccept}
            >
              {accepted ? t("card.accepted") : t("card.accept")}
            </Button>
            <Button
              kind="secondary"
              size="sm"
              icon="X"
              active={rejected}
              disabled={busy}
              onClick={onReject}
            >
              {rejected ? t("card.rejected") : t("card.reject")}
            </Button>
            <Button kind="ghost" size="sm" icon="Edit" disabled={busy} onClick={() => setEditing(true)}>
              {t("card.edit")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
