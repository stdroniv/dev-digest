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
| [`spec-creator`](./spec-creator.md) | `opus` | Turns a feature request into an agreed **specification** (the what/why) — analyses the design for missing behaviour, edge cases, cross-module hand-offs, and UX gaps, asks blocking questions, then writes testable **EARS** acceptance criteria to `specs/SPEC-NN-<date>-<slug>.md`. Specs only — never implementation detail (that's the implementation-plan agent's job). | Spec file only (`specs/`) | `Read, Grep, Glob, Agent, Edit, Write` |
| [`implementation-plan`](./implementation-plan.md) | `opus` | Turns an agreed spec / request into a precise, ordered, verifiable implementation plan (the how) and saves it to `docs/plans/<slug>.md`. Reads skills on demand (routing table in its body), not via a `skills:` preload. Plans only — never edits source, never authors a spec. | Plan file only (`docs/plans/`) | `Read, Grep, Glob, Bash, Agent, Write` |
| [`spec-conformance`](./spec-conformance.md) | `sonnet` | Read-only **plan⊨spec gate**, run *before* code at the approval gate: maps every spec AC to an owning plan task (Covered / Partial / Uncovered) and reverse-checks every task back to an AC, flagging plan scope creep. Emits a traceability matrix + verdict over the spec and plan documents — no diff, no code. Distinct from `plan-verifier`, which checks **code vs plan** *after* implementation. | No | `Read, Grep, Glob` |
| [`implementer`](./implementer.md) | `sonnet` | Executes an existing plan — writes/edits frontend + backend code, loads the skills relevant to the module, then verifies with typecheck/test/build. Executes only — doesn't design. | Yes (code, tests) | `Read, Grep, Glob, Edit, Write, Bash` |
| [`test-writer`](./test-writer.md) | `sonnet` | Adds behavior-focused tests across all four packages (`client/`, `server/`, `reviewer-core/`, `e2e/`), discovering existing test conventions, then **runs** typecheck + tests and pastes the real output. Minimises mocking by design. Tests only — doesn't redesign the code under test. | Yes (tests only) | `Read, Grep, Glob, Edit, Write, Bash` |
| [`architecture-reviewer`](./architecture-reviewer.md) | `opus` | Read-only architectural review — dependency direction, layering, coupling/cohesion, boundaries, SoC. High-signal findings (severity + principle + direction), never code rewrites. Reuses the repo's `CRITICAL/WARNING/SUGGESTION` vocabulary. | No | `Read, Grep, Glob` |
| [`plan-verifier`](./plan-verifier.md) | `sonnet` | Read-only completeness-**and-scope** gate — maps each planned requirement to `file:line` + test evidence (Implemented / Partial / Missing / Cannot-verify) **and** maps every change in the diff back to a requirement, flagging out-of-scope work. Emits a traceability matrix + verdict. Coverage, not quality. | No | `Read, Grep, Glob, Bash` |
| [`security-reviewer`](./security-reviewer.md) | `opus` | Read-only, **local-only** security review of the current diff — checks changed code against OWASP Top 10:2025 + the OWASP LLM Top 10 (incl. the secrets/untrusted-input/exfil "lethal trifecta"), reasons about reachability, and aggregates grounded `file:line` findings by severity **High / Medium / Low** each with a `0.0–1.0` confidence score. Findings only — never edits, never hits the network. | No | `Read, Grep, Glob, Bash` |
| [`doc-writer`](./doc-writer.md) | `sonnet` | Turns code, plans, or notes into well-placed documentation — picks the Diátaxis type (tutorial / how-to / reference / explanation / ADR) and the location (`docs/`, module `README`/`CLAUDE.md`, `docs/adr/`), writes docs-as-code, and adds Mermaid only where it earns its place. | Yes (docs) | `Read, Grep, Glob, Write, Edit` |

## The feature pipeline (how they fit together)

For a non-trivial feature the agents form a pipeline. **The primary session is the
orchestrator** — it invokes each agent, reads what comes back, and decides the next
step. The code-acting and review agents (`implementer`, `test-writer`,
`architecture-reviewer`, `plan-verifier`, `spec-conformance`, `security-reviewer`,
`doc-writer`) are **leaf workers**: they hold no `Agent` tool, so an agent cannot
spawn another agent. The two upstream authoring agents — `spec-creator` and
`implementation-plan` — **do** hold `Agent`, but *only* to delegate a **read-only
lookup** to `researcher`/`Explore` (keeping raw exploration out of their opus context
and taking back just the conclusion); they never orchestrate the pipeline or fire a
code-acting agent. All pipeline sequencing, fan-out, and loop-back happen one level
up, in the session driving them — or in a `Workflow` script, the only mechanism that
orchestrates agents deterministically.

> **Run it in one command:** the [`ship-feature`](../skills/ship-feature/SKILL.md)
> skill (`/ship-feature <request>`) codifies this exact pipeline — the main session
> follows it to drive the stages below, including the approval gate and the review loop.

```mermaid
flowchart LR
    R["researcher<br/>optional context"] --> S["spec-creator<br/>writes specs/SPEC-NN.md"]
    S --> P["implementation-plan<br/>writes docs/plans/{slug}.md"]
    P --> SC{"spec-conformance<br/>plan ⊨ spec?"}
    SC -- gaps --> P
    SC -- covers --> A["human approval gate"]
    A --> I["implementer<br/>executes the plan"]
    I --> T["test-writer<br/>adds + runs tests"]
    T --> Rev
    subgraph Rev["review · parallel · read-only"]
        direction TB
        AR["architecture-reviewer"]
        SR["security-reviewer"]
        PV["plan-verifier"]
    end
    Rev --> G{"blocking<br/>findings?"}
    G -- yes --> I
    G -- no --> D["doc-writer<br/>optional"]
    D --> Done(["merge-ready"])
```

**Stage by stage:**

1. **researcher** *(optional)* — targeted lookups before planning ("how does X work
   here?", "[web] what do the library docs say?"). Skip it when the implementation-plan agent's own
   reading suffices.
2. **spec-creator** *(opus, recommended for non-trivial features)* — turns the request
   into an agreed spec at `specs/SPEC-NN-<date>-<slug>.md` with EARS acceptance
   criteria, resolving scope, edge-case, cross-module, and UX gaps with you *before*
   planning starts. The spec is the WHAT/WHY; the implementation-plan agent consumes it for the HOW. Skip
   only when the requirements are already crisp and small.
3. **implementation-plan** *(opus)* — turns the spec (or a crisp request) into an ordered, verifiable plan at
   `docs/plans/<slug>.md`. It restates each spec AC and cites its ID, so the plan is
   traceable back to the spec. **Stop here for approval** before any code is written.
4. **spec-conformance** *(sonnet, at the approval gate)* — a fast, read-only
   **plan⊨spec** check: every spec AC maps to an owning task (Covered / Partial /
   Uncovered) and every task traces back to an AC (no plan scope creep). It runs on
   the two *documents* (no code yet), so it's cheap — catching a dropped AC here is far
   cheaper than after a wasted implementer run. Gaps loop back to `implementation-plan`;
   a clean pass plus the human's go unlocks implementation. (Skip only for a tiny plan
   with no separate spec.)
5. **implementer** *(sonnet)* — executes the approved plan; verifies with
   typecheck / lint / test / build.
6. **test-writer** *(sonnet)* — adds behavior-focused tests and runs them.
7. **review — run the three in parallel** (all read-only, independent, so fan them
   out at once): **architecture-reviewer** (design / layering / boundaries) ·
   **security-reviewer** (OWASP + LLM-trifecta on the diff) · **plan-verifier**
   (**code vs plan** completeness *and* scope — the post-code mirror of stage 4's
   plan⊨spec check).
8. **gate + loop-back** — the orchestrator collects findings. If any are blocking (a
   `CRITICAL`, a High-severity security finding, or a `plan-verifier` GAP), hand them
   back to the **implementer** to fix, then **re-run only the affected reviewers**.
   Repeat until reviews are clean *or* a round produces no new changes (convergence
   guard — don't loop forever on a disputed finding; surface it for a human instead).
9. **doc-writer** *(optional)* — once green, document the change (README / ADR /
   architecture doc).

**Conventions that make the pipeline work:**

- The **handoff artifact is a file** (`docs/plans/<slug>.md`). A subagent gets no
  parent conversation history, so the plan file *is* the contract between implementation-plan,
  implementer, test-writer, and the reviewers — keep stages stateless across that
  boundary, and when looping back pass the findings to the implementer explicitly.
- **Parallelise the review stage, serialise everything else.** Stages 1–6 each depend
  on the previous one's output; the three reviewers in stage 7 don't depend on each
  other, so launch them together. Stage 4 (`spec-conformance`) is a serial gate: it
  runs on the plan document before implementation, not alongside the code reviewers.
- **Skill routing:** the code-acting and review agents (`implementation-plan`, `implementer`,
  `test-writer`, `architecture-reviewer`) carry a *module → skill* table in their
  bodies and `Read` only the 1–2 relevant `.claude/skills/<name>/SKILL.md` files on
  demand — **never** the `skills:` frontmatter field, which would preload every skill
  and re-bill it as cache-read on every turn. `spec-creator` and `spec-conformance`
  are deliberately **skill-free** (skills teach the HOW; both work at the WHAT/plan
  level); `security-reviewer` reads the `security` skill on demand.
- **Don't double-run reviews.** The standalone `pr-self-review` skill routes changed
  files to the same architecture/security/quality skills the reviewer *agents* apply
  in stage 7 — it's the **manual** path for when you're *not* running the full
  pipeline. Inside `ship-feature`, the stage-7 agents already cover that ground; don't
  also invoke `/pr-self-review` or you pay for the review twice.
- Custom project agents **auto-load the `CLAUDE.md` hierarchy** for their CWD; module
  docs (`<module>/CLAUDE.md`, `<module>/INSIGHTS.md`, `docs/*`) are read on demand.
- **Cost discipline.** Real-run telemetry showed **cache-read ≈ 93% of all tokens** —
  each agent's context re-billed every turn — so cost tracks **conversation length ×
  context size**, not the model tier (tiers above are already tuned: reasoning-heavy
  `spec-creator`/`implementation-plan`/`architecture-reviewer`/`security-reviewer` on
  `opus`, executors plus the `plan-verifier`/`spec-conformance` gates on `sonnet`,
  ad-hoc exploration on Haiku). Keep runs cheap by keeping
  them short and lean: one-retry-then-DIY on a dropped agent, split a big build by
  layer, hand agents exact file lists, scope re-validation to specific findings, and
  don't poll background agents. The [`ship-feature`](../skills/ship-feature/SKILL.md)
  skill's **"Cost & robustness discipline"** section is the authoritative playbook.

## Invoking

- **Auto-delegation:** Claude routes to an agent based on its `description`. The
  implementation-plan/implementer descriptions include "use proactively" triggers.
- **Explicit:** ask for it by name — e.g. *"use the implementation-plan agent to design X"*,
  *"have the implementer build docs/plans/x.md"*, *"ask the researcher how Y works"*.

## Sources & references

General subagent design (applies to all agents):

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

The **`spec-creator`** agent was researched (July 2026) from:

- [github/spec-kit — `spec-driven.md`](https://github.com/github/spec-kit/blob/main/spec-driven.md)
  and [`spec-template.md`](https://github.com/github/spec-kit/blob/main/templates/spec-template.md)
  — the WHAT/WHY-vs-HOW split (specs ban tech stack / APIs / code structure), the
  `[NEEDS CLARIFICATION: …]` marker technique, auto-numbered spec IDs, and the
  `Status: draft` lifecycle.
- [Alistair Mavin — EARS: Easy Approach to Requirements Syntax](https://alistairmavin.com/ears/)
  — the five patterns (Ubiquitous / Event-driven / State-driven / Unwanted / Optional)
  and the complex-requirement clause ordering used for the acceptance-criteria grammar.
- The original EARS paper (Mavin, Wilkinson, Harwood, Novak — [RE'09, pp. 317–322](https://dl.acm.org/doi/abs/10.1109/RE.2009.9))
  and [Jama Software's EARS FAQ](https://www.jamasoftware.com/requirements-management-guide/writing-requirements/frequently-asked-questions-about-the-ears-notation-and-jama-connect-requirements-advisor/)
  — why one testable statement per criterion (fixed clause order) removes ambiguity
  about trigger, state, and response.

The **`implementation-plan`** and **`researcher`** agents are project-authored and predate
this documentation; they follow the general subagent docs above (no separate
external source). The **`plan-verifier`** and **`doc-writer`** agents are also
project-authored — each converted from the former same-named *skill* (their procedure
and reference material folded into the agent body). The **`spec-conformance`** agent
is project-authored as the pre-code mirror of `plan-verifier`: same traceability
discipline, but it checks the **plan against the spec** (two documents, no diff)
rather than the code against the plan. DevDigest-specific conventions they all honor
live in root [`CLAUDE.md`](../../CLAUDE.md) and [`INSIGHTS.md`](../../INSIGHTS.md).

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
- **security-reviewer** — [OWASP Top 10:2025](https://owasp.org/Top10/2025/),
  [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/), and
  [CVSS v3.1 — FIRST.org](https://www.first.org/cvss/v3.1/specification-document) for
  the High/Medium/Low + confidence rubric (full list in `security-reviewer.md`).
- **doc-writer** — the [Diátaxis](https://diataxis.fr/) framework (documentation type
  by reader need) plus Nygard/MADR ADR structure; converted from the `doc-writer` skill.

The **`security-reviewer`** agent was researched (June 2026) from:

- [OWASP Top 10:2025](https://owasp.org/Top10/2025/) — current category list
  (SSRF merged into A01), the basis for its OWASP mapping table.
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/)
  — LLM01/02/05/06/07/10 and the "lethal trifecta" (untrusted input + private
  data + exfil path), which the repo already models via `TrifectaComponent` in
  `server/src/vendor/shared/contracts/findings.ts`.
- [CVSS v3.1 Specification — FIRST.org](https://www.first.org/cvss/v3.1/specification-document)
  — the qualitative High/Medium/Low severity bands (used as a reasoning rubric,
  not a published numeric score). It also `Read`s the in-repo `security` skill
  (OWASP Top 10:2025, confidence-based review) for stack-specific safe/unsafe pairs.
