# Cost & robustness discipline — full rationale

> Pulled out of `SKILL.md` (v1.3.0) to keep the pipeline's hot path lean. Read this
> before a **large, multi-package, or loop-heavy** run; the four headline rules live in
> the skill body, the *why* and the rest live here.

A real run's telemetry showed **cache-read is ~93% of all tokens** — i.e. each agent's
context is re-billed on *every* turn — so the cost driver is **conversation length ×
context size**, not the model tier (tiers are already set per agent:
explorers→Haiku, executors + the `plan-verifier`/`spec-conformance` gates→Sonnet,
`spec-creator`/`implementation-plan`/reviewers→Opus). Optimise for *fewer, shorter,
leaner* agent turns and *zero wasted runs*:

- **One-retry-then-DIY on a dropped agent.** If a long single-shot agent (esp.
  `spec-creator` or `implementation-plan`) drops its connection, resume it **at most
  once**. If it drops again,
  write the artifact yourself from the context you already gathered — don't burn a
  third resume (a real run wasted ~8.6M tokens / ~26 min doing exactly that).
- **Split a big implementation by layer — and the threshold is files/turns, not just
  packages.** When a feature spans **more than one package** (`reviewer-core`/`server`/
  `client`) **or ~15+ files or a single run you expect to exceed ~150 turns**, spawn
  focused `implementer` tasks instead of one mega-run — cache-read grows super-linearly
  with turn count, so three ~100-turn agents cost far less than one ~300-turn agent.
  **This applies *within* a single package too:** a big **client-only** build (e.g. an
  App-Router screen with i18n + nav + hooks + ~6 components + the page/wiring) is over
  the threshold even though it's one package — split it **by sub-layer**
  (foundation: i18n + nav + hooks → components → page/state-wiring), not into one
  T8–T14 mega-agent. Two reasons: cost, and **blast radius** — in one real run a single
  ~274-turn / ~40-file client implementer dropped its connection near the end, losing the
  final page-wiring task and forcing a recovery agent that re-read ~11M cache-read of
  siblings the first had already built. A sub-layer split caps each agent's turns *and*
  makes a mid-run drop recoverable to one small piece. **Below the threshold, keep a
  single run** (splitting re-pays base-context load + handoff per agent). When you split,
  run the layers/sub-layers in **dependency order** (`reviewer-core` → `server` →
  `client`; within client: foundation → components → wiring) and thread the *real*
  exported signature / route contract / component API from each layer into the next
  agent's prompt — subagents share no memory, so a downstream agent that has to guess the
  upstream interface re-introduces the drift the split was meant to avoid.
- **Keep each agent's context lean.** Hand it the **exact file list / paths** (you
  already compute the changed-file set) so it acts instead of rediscovering. Tell
  `implementer`/`test-writer` to run the heaviest verification (full suites) as a
  **final** step and not re-dump large tool output mid-run — every dumped log is
  re-billed on all later turns.
- **Scope re-validation tightly — and never by *resuming* a reviewer.** On loop-back,
  re-check with "confirm **only** these findings on these changed files," never a full
  re-review. But spawn a **fresh, minimal** agent (or just `Read` the 2–3 changed files
  yourself) — resuming a prior reviewer re-bills its entire transcript as cache-read, so
  a 4-item confirmation can cost as much as the original full pass (one run's "scoped"
  re-verify came in *higher* than the verification it was shrinking). If you already hold
  the evidence the re-check would gather — e.g. the implementer's pasted green test output
  for exactly those items — skip the agent entirely. (This is the same fresh-minimal-agent
  rule the Step 6 *adjudicate-a-dispute* step relies on.)
- **Lean exploration.** Prefer **1–2 broader explorers** (or pass a shared file list
  so they don't each re-read the same files) over many overlapping ones. Lower
  priority — explorers run on cheap Haiku.
- **Don't background a verification the pipeline just waits on.** Run a sub-agent in the
  background only when there's *parallel* work to overlap it with. In a serial step (e.g.
  a single re-verify before the report) backgrounding buys nothing and can deadlock a Stop
  hook into pinging you each idle turn — and every idle turn re-bills the orchestrator's
  (large) context, the most expensive thing in the run. Run it foreground, or verify
  inline. And never *poll* a background agent — completion notifications fire automatically.
- **Escalate model only on purpose.** Per-agent `model:` is already tuned; override
  via the `Task` `model` param only to bump `implementer` to `opus` when the plan
  flags genuinely hard/ambiguous work — the default Sonnet handles mechanical edits.
