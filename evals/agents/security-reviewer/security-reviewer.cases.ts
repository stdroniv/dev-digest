import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// Split into two single-vuln fixtures (rather than one combined diff) after the first run of
// this suite: the combined diff spanned two unrelated modules (repos/ + pulls/) and forced the
// agent to read both modules' CLAUDE.md/INSIGHTS.md plus two skill files before answering, which
// blew the 240s global testTimeout before it ever produced a final report. Splitting halves the
// per-case investigation surface while still covering both categories (breadth now lives across
// two cases instead of one).
//
// Even split, a second run showed the SSRF case alone still hit the 240s global testTimeout —
// security-reviewer's own Workflow (root+module INSIGHTS.md/CLAUDE.md, the security skill +
// examples.md, plus module-specific skills) is genuinely heavy before it even opens the diff.
// `timeoutMs` gives these two cases real headroom without changing the shared 240s default other
// eval files rely on.

// A new repo-preview endpoint does `fetch()` on a user-supplied homepage URL with no host/scheme
// allowlist — a real SSRF (OWASP A01, which folds SSRF in for 2025).
const SSRF_PROMPT = `Do a security review of this diff.

${fx("repo-preview-ssrf.diff")}`;

// A new "Ask AI about this PR" chat feature concatenates the raw PR diff and the user's raw
// question directly into one LLM user turn, bypassing reviewer-core's
// assemblePrompt/wrapUntrusted/injection-guard path entirely — a real LLM01 prompt-injection risk.
const PROMPT_INJECTION_PROMPT = `Do a security review of this diff.

${fx("ask-ai-prompt-injection.diff")}`;

// A diff that LOOKS security-adjacent (a new route reading a PR-scoped resource, a new repository
// module) but has zero real vulnerabilities: the `:id` param is Zod-validated (uuid, 422 on
// anything else), the query is a parameterized Drizzle `and(eq(...), eq(...))` scoped by
// `workspaceId` (the repo's actual tenancy/ownership guard per `_shared/context.ts` — DevDigest is
// a single-user-per-workspace local app with no separate auth-role system), and the new log line
// records only a `userId`/`prId` pair, never a secret. A reviewer prone to pattern-matching
// anxiety ("new route + new repo file + logging = suspicious") should still recognize each
// mitigation is real and already present, per the agent's own "What NOT to flag" list.
const BENIGN_PROMPT = `Do a security review of this diff.

${fx("pull-note-route.diff")}`;

export const cases: AgentCase[] = [
  {
    name: "flags the SSRF in the repo-preview endpoint with citation, category, severity, and confidence",
    kind: "quality",
    prompt: SSRF_PROMPT,
    practices: [
      "flags `fetch(homepageUrl)` in server/src/modules/repos/preview.ts as an SSRF finding — a user-supplied `homepageUrl` reaches an outbound `fetch()` with no host/scheme allowlist",
      "categorizes the finding under OWASP A01 (Broken Access Control, which now includes SSRF) — mentions 'A01' and 'SSRF' by name",
      "assigns severity High",
      "gives the finding a numeric confidence score between 0.0 and 1.0",
      "cites a concrete file:line (or the exact offending snippet, `await fetch(homepageUrl)`) as evidence",
      "does not fabricate an UNRELATED finding disconnected from the diff (e.g. no invented SQLi, no invented secret leak) — a second finding on the SAME fetch call is fine (e.g. unbounded `res.text()` with no size cap is a legitimate secondary resource-exhaustion/DoS observation on the same line, not a fabrication) as long as it stays grounded in code actually in the diff",
    ],
    threshold: 1.0,
    maxTurns: 20,
    timeoutMs: 420_000,
  },
  {
    name: "flags the LLM prompt-injection issue in the Ask-AI feature with citation, category, severity, and confidence",
    kind: "quality",
    prompt: PROMPT_INJECTION_PROMPT,
    practices: [
      "flags the message construction in server/src/modules/pulls/ask.service.ts (`${rawDiff}\\n\\nReviewer question: ${question}`) as a prompt-injection risk — raw, undelimited diff/PR content and the user's free-text question are concatenated directly into one LLM user turn with no delimiting/scrubbing",
      "categorizes the finding as LLM01 (Prompt Injection) by name, and/or explicitly notes this call bypasses reviewer-core's `assemblePrompt`/`wrapUntrusted`/injection-guard path that the rest of the codebase uses",
      "assigns severity High",
      "gives the finding a numeric confidence score between 0.0 and 1.0",
      "cites a concrete file:line (or the exact offending snippet) as evidence",
      "does not fabricate additional unrelated findings beyond this one real issue — stays scoped to what the diff actually introduces",
    ],
    threshold: 1.0,
    maxTurns: 20,
    timeoutMs: 420_000,
  },
  {
    name: "does not fabricate a vulnerability in the benign PR-note route and recognizes the real mitigations",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no High or Medium findings for this diff (at most a Low/informational note) — it does not invent an IDOR, missing-auth, or injection finding",
      "if it comments on the route at all, explicitly recognizes that `req.params.id` is Zod-validated via the shared `IdParams` schema (rejects non-uuid input before the handler runs)",
      "if it comments on the query at all, explicitly recognizes that `notes.repo.ts` uses a parameterized Drizzle `eq()`/`and()` clause (not raw SQL) scoped by `workspaceId`, so one workspace cannot read another workspace's note",
      "does not flag the new `req.log.info({ userId, prId })` log line as a secret/sensitive-data leak — it correctly identifies it logs only an id, not a credential or token",
      "does not claim the route is missing authentication/authorization in a way that contradicts the workspace-scoped query already present",
    ],
    threshold: 0.8,
    maxTurns: 32,
  },
];
