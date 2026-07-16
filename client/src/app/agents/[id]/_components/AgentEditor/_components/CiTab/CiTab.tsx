/* Agent → CI tab (SPEC-05 T12, N12/AC-38..41). Empty state opens the T10
   Export Wizard (AC-38); once the agent has ≥1 CI installation, shows the
   "CI deployment" header + "Active in N repos" count, the "Fail CI on" 3-way
   segmented control persisted via the existing `useUpdateAgent({ ci_fail_on
   })` (AC-21, Rec3 — no new hook/route), and one row per installation with
   repo/target/status/workflow-version/last-run + an "update available" drift
   indicator (AC-39/40). No `SegmentedControl` primitive exists in
   `@devdigest/ui`, so the 3-way toggle is built feature-local here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, Icon } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useCiInstallations } from "@/lib/hooks/ci";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { ExportWizard } from "../ExportWizard";
import { CI_STATUS_META, FAIL_ON_OPTIONS } from "./constants";
import { relativeTimeCompact } from "./helpers";

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "13px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  marginBottom: 8,
};

const failOnCardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  marginBottom: 16,
};

const segmentedWrapStyle: React.CSSProperties = {
  display: "flex",
  gap: 2,
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 7,
  padding: 2,
  flexShrink: 0,
};

function segmentButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 5,
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    background: active ? "var(--bg-elevated)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  };
}

const addRepoButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  width: "100%",
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px dashed var(--border-strong)",
  background: "transparent",
  color: "var(--text-secondary)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  marginTop: 2,
};

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const { data: installations } = useCiInstallations(agent.id);
  const updateAgent = useUpdateAgent();
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const list = installations ?? [];
  const exported = list.length > 0;

  return (
    <div style={{ maxWidth: 720 }}>
      {wizardOpen && <ExportWizard agent={agent} onClose={() => setWizardOpen(false)} />}

      {!exported ? (
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "40px 0" }}>
          <EmptyState
            icon="Workflow"
            title={t("ciTab.emptyTitle")}
            body={t("ciTab.emptyBody")}
            cta={t("ciTab.addToCi")}
            onCta={() => setWizardOpen(true)}
          />
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t("ciTab.deploymentHeading")}</h2>
            <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
              {t("ciTab.activeInRepos", { count: list.length })}
            </Badge>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              {/* "Update CI config" re-opens the Export Wizard (same
                  setWizardOpen(true) as "Add to CI") — re-installing an
                  already-exported repo is idempotent and bumps the workflow
                  version (AC-17/41), so re-running the wizard IS the update
                  path (AC-39/40). */}
              <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => setWizardOpen(true)}>
                {t("ciTab.updateConfig")}
              </Button>
              <Button kind="primary" size="sm" icon="Plus" onClick={() => setWizardOpen(true)}>
                {t("ciTab.addToCi")}
              </Button>
            </div>
          </div>

          <div style={failOnCardStyle}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("ciTab.failCiOnLabel")}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                {t("ciTab.failCiOnHint")}
              </div>
            </div>
            <div style={segmentedWrapStyle} role="group" aria-label={t("ciTab.failCiOnLabel")}>
              {FAIL_ON_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateAgent.mutate({ id: agent.id, patch: { ci_fail_on: opt.value } })}
                  aria-pressed={agent.ci_fail_on === opt.value}
                  style={segmentButtonStyle(agent.ci_fail_on === opt.value)}
                >
                  {t(`ciTab.${opt.labelKey}`)}
                </button>
              ))}
            </div>
          </div>

          {list.map((inst) => {
            const statusMeta = inst.status ? CI_STATUS_META[inst.status] : null;
            const lastRun = relativeTimeCompact(inst.last_run_at);
            return (
              <div key={inst.id} style={rowStyle}>
                <Icon.GitBranch size={16} style={{ color: "var(--text-muted)" }} />
                <span className="mono" style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                  {inst.repo}
                </span>
                <Badge color="var(--text-secondary)" icon="Workflow">
                  {t(`exportWizard.targets.${inst.target}`)}
                </Badge>
                {statusMeta ? (
                  <Badge color={statusMeta.c} bg={statusMeta.bg} dot>
                    {t(`runs.status.${statusMeta.labelKey}`)}
                  </Badge>
                ) : (
                  <Badge color="var(--text-muted)">{t("ciTab.neverRun")}</Badge>
                )}
                <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {t("ciTab.workflowVersion", { version: inst.workflow_version })}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  {lastRun ? t("ciTab.lastRunAgo", { value: lastRun }) : t("ciTab.neverRun")}
                </span>
                {inst.update_available && (
                  <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                    {t("ciTab.updateAvailable")}
                  </Badge>
                )}
              </div>
            );
          })}

          <button type="button" onClick={() => setWizardOpen(true)} style={addRepoButtonStyle}>
            <Icon.Plus size={15} />
            {t("ciTab.addRepository")}
          </button>
        </>
      )}
    </div>
  );
}
