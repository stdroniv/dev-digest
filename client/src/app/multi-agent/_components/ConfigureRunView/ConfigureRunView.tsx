/* ConfigureRunView — the /multi-agent Configure-run experience (SPEC-05,
   AC-1/6..10/17). Renders RunConfig (which sources its own PR list + estimates),
   and owns the launch + navigation to the results page. Opens with no PR when
   no `?pr=` is provided (AC-1); preselection round-trips from the results
   page's "Configure run" affordance (AC-17). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { useLaunchMultiAgentRun } from "@/lib/hooks/multi-agent";
import { RunConfig } from "../RunConfig";

export interface ConfigureRunViewProps {
  /** Preselected PR id from `?pr=` (AC-17); null opens with no PR (AC-1). */
  preselectedPr?: string | null;
  /** Preselected agent ids from `?agents=` (AC-17). */
  preselectedAgents?: string[];
}

export function ConfigureRunView({
  preselectedPr = null,
  preselectedAgents = [],
}: ConfigureRunViewProps) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const launch = useLaunchMultiAgentRun();

  const handleRun = React.useCallback(
    async (prId: string, agentIds: string[]) => {
      const res = await launch.mutateAsync({ prId, agentIds });
      router.push(`/multi-agent/runs/${res.run_id}`);
    },
    [launch, router],
  );

  return (
    <AppShell crumb={[{ label: t("results.crumb") }, { label: t("configure.crumb") }]}>
      <RunConfig
        preselectedPr={preselectedPr}
        preselectedAgents={preselectedAgents}
        onRun={handleRun}
      />
    </AppShell>
  );
}
