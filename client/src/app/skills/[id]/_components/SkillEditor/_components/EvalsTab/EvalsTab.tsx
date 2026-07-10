/* Skill → Evals tab (Gap 1, T15). Thin wrapper over the shared
   `EvalsTabBody` (arch fix — de-duplicated against the agent Evals tab):
   resolves the skill-specific hooks/owner, then delegates all metric-strip +
   case-list + modal rendering to the shared body. Omits "View full
   dashboard →" — the cross-owner `/evals` dashboard stays agent-only (A3).
   Security fix — a DISABLED skill's body must never reach the LLM before the
   human-enable step (mirrors `run-executor.ts`'s `skill.enabled` filter for
   live review composition): "Run all evals" + every per-case "Run" control
   are blocked with an explanatory tooltip whenever `!skill.enabled`. */
"use client";

import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { useSkillEvalCases, useSkillEvalDashboard, useRunAllSkillEvals } from "@/lib/hooks/evals";
import { EvalsTabBody } from "@/components/evals/EvalsTabBody";

export function EvalsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("evals");
  const { data: cases, isLoading: casesLoading } = useSkillEvalCases(skill.id);
  const { data: dashboard } = useSkillEvalDashboard(skill.id);
  const runAll = useRunAllSkillEvals();

  return (
    <EvalsTabBody
      owner={{ kind: "skill", id: skill.id }}
      cases={cases}
      casesLoading={casesLoading}
      dashboard={dashboard}
      onRunAll={() => runAll.mutate(skill.id)}
      runAllPending={runAll.isPending}
      metricsSubtitle={t("evalsTabSkill.metricsSubtitle")}
      emptyCasesBody={t("evalsTabSkill.emptyCases")}
      runDisabled={!skill.enabled}
      runDisabledTooltip={!skill.enabled ? t("evalsTabSkill.disabledTooltip") : undefined}
    />
  );
}
