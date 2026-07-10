import type { AgentCase } from "../../src/index.js";

// Real-world shape: point the agent at a real, already-implemented plan in this repo
// (docs/plans/onboarding-generator.md, implementing the approved specs/SPEC-02-...md) rather
// than a synthetic fixture, and scope it to a small "in-progress state" cluster of three
// related requirements (R-AC26/27/28) so the trace stays affordable while remaining a genuine
// verification task. We independently investigated the current codebase (not the agent) to
// establish ground truth before writing these practices:
//
// - R-AC26 (whole-tour progress indicator) — Implemented, Test evidence:
//   client/src/app/repos/[repoId]/tour/_components/TourWorkspace/TourWorkspace.test.tsx:299-318
//   ("TourWorkspace — whole-tour generation in progress (AC-26)" / "shows the whole-tour
//   in-progress spinner while a whole job is running") exercises a running `whole` job and
//   asserts a `role=status` spinner renders over the empty state.
// - R-AC27 (per-section spinner, siblings stay readable) — Implemented, Test evidence:
//   client/src/app/repos/[repoId]/tour/_components/SectionCard/SectionCard.test.tsx:62-65
//   ("shows a spinner while generating, while its content stays readable") against
//   SectionCard.tsx:58-70 (`generating = section.status === "generating"`).
// - R-AC28 (navigate away mid-generation; generation continues; completed tour shows on
//   return) — genuinely weaker: there is NO test that simulates a client navigating away and
//   back. The nearest evidence is architectural: job-handler.ts runs the job server-side via
//   `container.jobs` outside the request/response cycle (comment block atop job-handler.ts),
//   and routes.it.test.ts's regenerate test (~line 175-210) happens to use two SEPARATE app
//   instances (app1 posts + closes, app2 later reads) which incidentally shows job state
//   surviving independent of any one "client" — but no test is named/framed around AC-28, and
//   client/src/lib/hooks/onboarding.ts's poll-based `refetchInterval` is only unit-tested for
//   its own stop/start logic (onboarding.test.ts), not for "completed tour shows on return".
//   The honest classification is Implemented-by-architecture but backed only by Inspection/
//   Analysis, not a dedicated Test — a rigorous verifier must say so rather than inventing a
//   test name or silently upgrading it to the same confidence as R-AC26/27.
const PROMPT =
  "Verify ONLY these three requirements from docs/plans/onboarding-generator.md against the " +
  "current codebase: R-AC26, R-AC27, and R-AC28 (the 'in-progress' cluster). For each, state " +
  "its status (Implemented / Partial / Missing / Cannot-verify) with file:line evidence and the " +
  "verification method (Test / Inspection / Analysis). You do not need to run the full scope " +
  "check (git diff / out-of-scope changes) for this — just trace these three requirements " +
  "forward to evidence.";

export const cases: AgentCase[] = [
  {
    name: "correctly grades the in-progress cluster (R-AC26/27 solid; R-AC28 architectural-only) without overclaiming",
    kind: "quality",
    prompt: PROMPT,
    practices: [
      "classifies R-AC26 (whole-tour progress indicator) as Implemented, citing real file:line evidence in TourWorkspace.test.tsx (around the 'AC-26' / whole-tour in-progress spinner test) — not a vague 'tests pass' claim",
      "classifies R-AC27 (per-section spinner while siblings stay readable) as Implemented, citing real file:line evidence in SectionCard.tsx (the `status === \"generating\"` check) and/or SectionCard.test.tsx's 'shows a spinner while generating' test",
      "does NOT classify R-AC28 (navigate-away-mid-generation) as Implemented on the same footing as R-AC26/R-AC27 backed by a named dedicated automated test proving the exact navigate-away-and-return scenario — no such test exists in the repo, so the response must not fabricate one or claim 'tested' for it",
      "for R-AC28, either marks it Partial/Cannot-verify, or if it credits it as satisfied, explicitly labels the evidence as Inspection/Analysis (architectural reasoning: the job runs server-side via container.jobs independent of the client, per job-handler.ts) rather than Test — per its own Evidence-quality hierarchy that Test > Inspection > Analysis and an Analysis-only claim must never be upgraded to a confidently-tested 'Implemented'",
      "keeps R-AC26 and R-AC27 as distinct rows (whole-tour spinner vs per-section spinner) rather than merging or conflating them",
      "every Implemented/Partial claim cites an addressable file:line, not just a filename or a general assertion",
    ],
    threshold: 0.7,
    maxTurns: 24,
  },
];
