import { EvalDashboard } from "./_components/EvalDashboard";

/* Route: /evals (Eval Dashboard, SKILLS LAB). Thin route entry — the
   dashboard view (agent cards, cross-agent recent runs, drill-in to
   AgentEvalDetail) lives in _components/EvalDashboard. */
export default function EvalsPage() {
  return <EvalDashboard />;
}
