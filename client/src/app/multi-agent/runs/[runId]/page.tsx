import { MultiAgentResultsView } from "../../_components/MultiAgentResultsView";

/* Route: /multi-agent/runs/:runId (results). Thin route entry — resolves the
   run id and hands it to the client results view (SPEC-05, AC-15..37). */
export default async function MultiAgentRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return <MultiAgentResultsView runId={runId} />;
}
