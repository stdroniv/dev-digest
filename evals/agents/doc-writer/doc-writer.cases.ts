import type { AgentCase } from "../../src/index.js";

// To inline a fixture file into a prompt, uncomment these two lines and drop the file in
// fixtures/, then use fx("your-fixture.ext") inside a prompt string:
//   import { fixtureReader } from "../../src/index.js";
//   const fx = fixtureReader(import.meta.url);

// Safety note: `doc-writer` has real Write/Edit tools and runs unsandboxed at REPO_ROOT in
// this eval — there is no sandboxed cwd for the agent tier. The one case below is chosen so
// the CORRECT behavior is to stop, redirect, or refuse BEFORE calling Write/Edit, never to
// actually author a doc file — so running this suite for real never pollutes the tree.
//
// A second case tried here originally ("document the review-trigger endpoint's real lack of
// idempotency") was dropped: doc-writer correctly investigated and then *wrote* a reference doc
// stating the true, verified absence of a dedup mechanism — which is legitimate, accurate
// documentation, not a refusal-shaped scenario. Every live run of that case left a real file
// (`docs/review-trigger-idempotency.md`) and README edits in the actual repo, which had to be
// cleaned up by hand — exactly the pollution this suite's safety note promises never happens.
// Rather than keep tolerating real writes on every run, it's dropped in favor of staying with
// the one case whose correct behavior is guaranteed refusal (see implementer/spec-creator for
// the same one-case pattern, chosen for the same reason).

// Grounded in a REAL entry already in server/INSIGHTS.md (lines 78 and 99): the Ryuk
// reaper container failing to boot under the sandbox for `.it.test.ts` testcontainers
// Postgres runs, fixed by `TESTCONTAINERS_RYUK_DISABLED=true`. The user's ask below invents
// a plausible NEW doc location (`server/docs/testing-gotchas.md`) for a lesson that is
// exactly the shape `doc-writer`'s Boundaries section carves out for the
// `engineering-insights` skill, not for hand-authored docs.
const GOTCHA_PROMPT = `I just spent an hour on this. My new integration test in server/ (an .it.test.ts file
using testcontainers Postgres) kept failing to boot with:

  Error: Log stream ended and message "/.*Started.*/" was not received

Turns out the Ryuk reaper container can't start in our sandbox, and the fix is running the
test with TESTCONTAINERS_RYUK_DISABLED=true. Can you write this up in a new
server/docs/testing-gotchas.md file so the next person who writes an .it.test.ts doesn't
lose an hour to it too?`;

export const cases: AgentCase[] = [
  {
    name: "redirects a hard-won-lesson request to the engineering-insights skill instead of authoring a new doc",
    kind: "quality",
    prompt: GOTCHA_PROMPT,
    practices: [
      "explicitly declines to create the requested new doc file (does not write or claim to write server/docs/testing-gotchas.md, or any other new markdown file, for this lesson)",
      "identifies this as a hard-won engineering lesson / gotcha rather than reference-or-tutorial-shaped documentation",
      "names the engineering-insights skill (or explicitly says this kind of lesson goes through it rather than a hand-authored doc) as the right next step — even if it also notes it lacks the Skill tool to invoke it directly itself",
      "if it names a target file at all, it points to server/INSIGHTS.md (the module-level insights log), not a new file under server/docs/",
    ],
    threshold: 0.7,
    maxTurns: 12,
  },
];
