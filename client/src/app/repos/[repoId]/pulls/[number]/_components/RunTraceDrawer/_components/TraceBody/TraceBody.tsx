/* TraceBody — the Trace tab content: Configuration, Stats, Findings, Prompt
   assembly, Tool calls, and Raw output sections for one persisted RunTrace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { RunTrace, FindingRecord, DocumentRead } from "@devdigest/shared";
import { PROMPT_COLORS } from "../../constants";
import { formatSeconds, formatTokens } from "../../helpers";
import { formatUsd } from "@/lib/cost";
import { s } from "../../styles";
import { TraceSection } from "../TraceSection";
import { ToolCallRow } from "../ToolCallRow";
import { PromptBlock } from "../PromptBlock";
import { FindingsSection } from "../FindingsSection";
import { Row, Stat } from "../Atoms";

/** Origin chip for a `documents_read` entry — distinguishes agent-owned vs a
    named skill's attached doc (AC-28 "traceable origin"). */
function OriginBadge({ origin, t }: { origin: DocumentRead["origin"]; t: ReturnType<typeof useTranslations> }) {
  if (origin.type === "skill") {
    return (
      <Badge color="var(--accent-text)" bg="var(--bg-hover)" icon="Layers">
        {origin.skill_name ?? t("trace.config.origin.skill")}
      </Badge>
    );
  }
  return (
    <Badge color="var(--text-secondary)" bg="var(--bg-hover)" icon="User">
      {t("trace.config.origin.agent")}
    </Badge>
  );
}

export function TraceBody({ trace, findings }: { trace: RunTrace; findings: FindingRecord[] }) {
  const t = useTranslations("runs");
  const stats = trace.stats;
  return (
    <>
      <TraceSection icon="Settings" title={t("trace.configuration")}>
        <div style={s.configList}>
          <Row label={t("trace.config.model")}>
            <span className="mono" style={s.configModel}>
              {trace.config.model}
            </span>
          </Row>
          <Row label={t("trace.config.provider")}>
            <span className="mono" style={s.configProvider}>
              {trace.config.provider ?? "—"}
            </span>
          </Row>
          <Row label={t("trace.config.memoryPulled")}>
            <span>{t("trace.config.items", { count: trace.memory_pulled.length })}</span>
          </Row>
          <Row label={t("trace.config.specsRead")}>
            <div style={s.specsWrap}>
              {trace.specs_read.length === 0 ? (
                <span style={s.specsNone}>{t("trace.config.none")}</span>
              ) : (
                trace.specs_read.map((sp, i) => (
                  <span key={i} className="mono" style={s.spec}>
                    {sp}
                  </span>
                ))
              )}
            </div>
          </Row>
          {trace.documents_read.length > 0 && (
            <Row label={t("trace.config.documentsRead")}>
              <div style={s.docList}>
                {trace.documents_read.map((d) => (
                  <div key={d.path} style={s.docItem}>
                    <span className="mono" style={s.docPath}>
                      {d.path}
                    </span>
                    <OriginBadge origin={d.origin} t={t} />
                    <span className="tnum" style={s.docTokens}>
                      {t("trace.config.docTokens", { count: d.tokens })}
                    </span>
                  </div>
                ))}
              </div>
            </Row>
          )}
          {trace.documents_unavailable.length > 0 && (
            <Row label={t("trace.config.documentsUnavailable")}>
              <div style={s.unavailableBox}>
                <Icon.AlertTriangle size={13} style={s.unavailableIcon} />
                <div style={s.unavailableList}>
                  {trace.documents_unavailable.map((p) => (
                    <span key={p} className="mono" style={s.unavailableChip}>
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </Row>
          )}
          {/* AC-31 — same-repository invariant: a whole attached set excluded
              because its anchor repo differs from this PR's repo. Distinct
              from the per-document "unavailable" block above: different
              icon/color (neutral --info + GitBranch, not warn/AlertTriangle)
              and copy, since these paths were never individually resolved. */}
          {(trace.documents_repo_excluded ?? []).length > 0 && (
            <Row label={t("trace.config.documentsRepoExcluded")}>
              <div style={s.repoExcludedBox}>
                {(trace.documents_repo_excluded ?? []).map((exclusion, i) => (
                  <div key={i} style={s.repoExcludedEntry}>
                    <Icon.GitBranch size={13} style={s.repoExcludedIcon} />
                    <div style={s.repoExcludedMeta}>
                      <OriginBadge origin={exclusion.origin} t={t} />
                      <span style={s.repoExcludedCount}>
                        {t("trace.config.excludedCount", { count: exclusion.paths.length })}
                      </span>
                    </div>
                  </div>
                ))}
                <span style={s.repoExcludedNote}>{t("trace.config.excludedNote")}</span>
              </div>
            </Row>
          )}
        </div>
      </TraceSection>

      <TraceSection
        icon="Gauge"
        title={t("trace.stats")}
        right={
          <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
            {stats.grounding}
          </Badge>
        }
      >
        <div style={s.statsRow}>
          <Stat label={t("trace.stat.duration")} val={formatSeconds(stats.duration_ms)} />
          <Stat label={t("trace.stat.tokens")} val={formatTokens(stats.tokens_in, stats.tokens_out)} />
          <Stat label={t("trace.stat.cost")} val={formatUsd(stats.cost_usd)} />
          <Stat label={t("trace.stat.findings")} val={stats.findings} />
        </div>
      </TraceSection>

      <FindingsSection findings={findings} />

      <TraceSection icon="FileText" title={t("trace.promptAssembly")} defaultOpen={false}>
        <PromptBlock label={t("trace.prompt.system")} text={trace.prompt_assembly.system} color={PROMPT_COLORS.system} />
        {trace.prompt_assembly.skills != null && (
          <PromptBlock
            label={t("trace.prompt.skills")}
            text={trace.prompt_assembly.skills}
            color={PROMPT_COLORS.skills}
            badge={
              stats.skills_tokens != null
                ? t("trace.prompt.skillsTokens", { count: stats.skills_tokens })
                : undefined
            }
          />
        )}
        {trace.prompt_assembly.memory != null && (
          <PromptBlock label={t("trace.prompt.memory")} text={trace.prompt_assembly.memory} color={PROMPT_COLORS.memory} />
        )}
        {trace.prompt_assembly.repo_map != null && (
          <PromptBlock label={t("trace.prompt.repoMap")} text={trace.prompt_assembly.repo_map} color={PROMPT_COLORS.repoMap} />
        )}
        {trace.prompt_assembly.specs != null && (
          <PromptBlock
            label={t("trace.prompt.specs")}
            text={trace.prompt_assembly.specs}
            color={PROMPT_COLORS.specs}
            badge={
              stats.specs_tokens != null
                ? t("trace.prompt.specsTokens", { count: stats.specs_tokens })
                : undefined
            }
          />
        )}
        {trace.prompt_assembly.callers != null && (
          <PromptBlock label={t("trace.prompt.callers")} text={trace.prompt_assembly.callers} color={PROMPT_COLORS.callers} />
        )}
        <PromptBlock label={t("trace.prompt.user")} text={trace.prompt_assembly.user} color={PROMPT_COLORS.user} />
      </TraceSection>

      <TraceSection
        icon="Wrench"
        title={t("trace.toolCalls")}
        right={<Badge color="var(--text-muted)">{trace.tool_calls.length}</Badge>}
      >
        {trace.tool_calls.length === 0 ? (
          <span style={s.noToolCalls}>{t("trace.noToolCalls")}</span>
        ) : (
          trace.tool_calls.map((tc, i) => <ToolCallRow key={i} tc={tc} />)
        )}
      </TraceSection>

      <TraceSection icon="Code" title={t("trace.rawOutput")} defaultOpen={false}>
        <pre className="mono" style={s.rawPre}>
          {trace.raw_output || "—"}
        </pre>
      </TraceSection>
    </>
  );
}
