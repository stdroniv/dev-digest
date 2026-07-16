import { ConfigureRunView } from "./_components/ConfigureRunView";

/* Route: /multi-agent (Configure run). Thin route entry — reads optional
   ?pr= / ?agents= preselection (AC-1, AC-17) and hands it to the client view. */
export default async function MultiAgentConfigurePage({
  searchParams,
}: {
  searchParams: Promise<{ pr?: string; agents?: string }>;
}) {
  const sp = await searchParams;
  const preselectedAgents = sp.agents ? sp.agents.split(",").filter(Boolean) : [];
  return <ConfigureRunView preselectedPr={sp.pr ?? null} preselectedAgents={preselectedAgents} />;
}
