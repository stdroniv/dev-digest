# DevDigest — Custom Subagents

Project-scoped Claude Code subagents for DevDigest. Each agent is a single
`<name>.md` file: YAML frontmatter (`name`, `description`, `tools`, `model`) plus
a Markdown body that becomes the agent's entire system prompt.

> **Loading:** new or edited agent files only become invokable after a **session
> restart** (or when created via the `/agents` UI) — they're read at session start.

## Available agents

| Agent | Model | Role | Writes? | Tools |
|-------|-------|------|---------|-------|
| [`researcher`](./researcher.md) | `sonnet` | Read-only lookup — searches **this codebase** or the **web** and returns a short, strictly-formatted answer with citations. Prefix a request with `[code]` or `[web]` to force the search type. | No | `Read, Grep, Glob, WebSearch, WebFetch` |
| [`planner`](./planner.md) | `opus` | Turns a feature request into a precise, ordered, verifiable implementation plan and saves it to `docs/plans/<slug>.md`. Plans only — never edits source. | Plan file only (`docs/plans/`) | `Read, Grep, Glob, Write` |
| [`implementer`](./implementer.md) | `sonnet` | Executes an existing plan — writes/edits frontend + backend code, loads the skills relevant to the module, then verifies with typecheck/test/build. Executes only — doesn't design. | Yes (code, tests) | `Read, Grep, Glob, Edit, Write, Bash` |
| [`test-writer`](./test-writer.md) | `sonnet` | Adds behavior-focused tests across all four packages (`client/`, `server/`, `reviewer-core/`, `e2e/`), discovering existing test conventions, then **runs** typecheck + tests and pastes the real output. Minimises mocking by design. Tests only — doesn't redesign the code under test. | Yes (tests only) | `Read, Grep, Glob, Edit, Write, Bash` |
| [`architecture-reviewer`](./architecture-reviewer.md) | `opus` | Read-only architectural review — dependency direction, layering, coupling/cohesion, boundaries, SoC. High-signal findings (severity + principle + direction), never code rewrites. Reuses the repo's `CRITICAL/WARNING/SUGGESTION` vocabulary. | No | `Read, Grep, Glob` |

## How they fit together

```
research → plan the change → build it → cover it → review it
 researcher →  planner    → implementer → test-writer → architecture-reviewer
 (code/web)  docs/plans/…   executes plan  adds+runs tests  read-only design review
```

The `plan-verifier` skill (not an agent) closes the loop on the other end: given the
`docs/plans/<slug>.md` and the built code, it checks that **every** planned
requirement is actually covered (Implemented / Partial / Missing), distinct from the
architecture-reviewer's *design* review and `pr-self-review`'s *quality* gate.

- The **handoff artifact is a file** (`docs/plans/<slug>.md`). A subagent gets no
  parent conversation history, so the plan file *is* the contract between planner,
  implementer, test-writer, and plan-verifier — keep new stages stateless across
  that boundary.
- **Skill routing:** `planner`, `implementer`, `test-writer`, and
  `architecture-reviewer` carry a *module → skill* table in their bodies and `Read`
  only the 1–2 relevant `.claude/skills/<name>/SKILL.md` files on demand (rather than
  the `skills:` frontmatter field, which would preload every skill into context).
- Custom project agents **auto-load the `CLAUDE.md` hierarchy** for their CWD;
  module docs (`<module>/CLAUDE.md`, `<module>/INSIGHTS.md`, `docs/*`) are read on
  demand.

## Invoking

- **Auto-delegation:** Claude routes to an agent based on its `description`. The
  planner/implementer descriptions include "use proactively" triggers.
- **Explicit:** ask for it by name — e.g. *"use the planner to design X"*,
  *"have the implementer build docs/plans/x.md"*, *"ask the researcher how Y works"*.

## Sources & references

General subagent design (applies to all three agents):

- [Create custom subagents — Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
  — frontmatter fields, model aliases (`sonnet`/`opus`/`haiku`/`fable`/`inherit`),
  `tools` inheritance, and `description`/system-prompt guidance.

The **`implementer`** agent's prompt was researched from (June 2026):

- [Best practices for Claude Code — Anthropic](https://code.claude.com/docs/en/best-practices)
  — evidence-first verification, scope discipline, adversarial review.
- [Effective harnesses for long-running agents — Anthropic Engineering](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
  — one-step-at-a-time execution, test before marking complete.
- [Effective context engineering for AI agents — Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  — just-in-time context, structured note-taking.
- [Claude Code system prompts (reverse-engineered) — Piebald-AI](https://github.com/Piebald-AI/claude-code-system-prompts)
  — "do not add features beyond what was asked"; deviation/scope guidance.

The **`planner`** and **`researcher`** agents are project-authored and predate
this documentation; they follow the general subagent docs above (no separate
external source). DevDigest-specific conventions all three honor live in root
[`CLAUDE.md`](../../CLAUDE.md) and [`INSIGHTS.md`](../../INSIGHTS.md).

The **`test-writer`** and **`architecture-reviewer`** agents were researched
(June 2026) from:

- **test-writer** — [Fastify Testing](https://fastify.dev/docs/latest/Guides/Testing/)
  (`inject`, lifecycle teardown), [TkDodo — Testing React Query](https://tkdodo.eu/blog/testing-react-query)
  (`retry:false`/`gcTime:Infinity`, per-test `QueryClient`, MSW),
  [Testing Library query priority](https://testing-library.com/docs/queries/about/),
  and [arXiv 2602.00409](https://arxiv.org/html/2602.00409v1) — coding agents
  over-mock ~95% of the time; explicit no-mock instructions are the proven fix.
- **architecture-reviewer** — [Augment Code — high-quality AI review](https://www.augmentcode.com/blog/how-we-built-high-quality-ai-code-review-agent)
  (signal-over-noise, ~1–3 findings/review), [Conventional Comments](https://conventionalcomments.org/)
  (severity labels), [operationalizing ADRs with fitness functions](https://platformtoolsmith.com/blog/operationalizing-adrs-fitness-functions/)
  (anti-rationalization), and [arXiv 2201.01184](https://arxiv.org/pdf/2201.01184)
  — manual review alone catches ~17% of architecture drift.
