/* Agent → Evals tab (SPEC-04, T15). Thin wrapper over the shared
   `EvalsTabBody` (arch fix — de-duplicated against the skill Evals tab):
   resolves the agent-specific hooks/owner, then delegates all metric-strip +
   case-list + modal rendering to the shared body. Only the agent tab shows
   "View full dashboard →" (A3 — the cross-owner `/evals` dashboard is
   agent-only). */
"use client";

import { useTranslations } from "next-intl";
import type { Agent } from "@devdigest/shared";
import { useAgentEvalCases, useAgentEvalDashboard, useRunAllEvals } from "@/lib/hooks/evals";
import { EvalsTabBody } from "@/components/evals/EvalsTabBody";

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("evals");
  const { data: cases, isLoading: casesLoading } = useAgentEvalCases(agent.id);
  const { data: dashboard } = useAgentEvalDashboard(agent.id);
  const runAll = useRunAllEvals();

  return (
    <EvalsTabBody
      owner={{ kind: "agent", id: agent.id }}
      cases={cases}
      casesLoading={casesLoading}
      dashboard={dashboard}
      onRunAll={() => runAll.mutate(agent.id)}
      runAllPending={runAll.isPending}
      metricsSubtitle={t("evalsTab.metricsSubtitle")}
      emptyCasesBody={t("evalsTab.emptyCases")}
      dashboardHref="/evals"
    />
  );
}
