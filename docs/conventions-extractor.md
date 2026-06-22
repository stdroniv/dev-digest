# Conventions Extractor + API Contract Reviewer experiment

Two connected deliverables:

1. **Conventions Extractor** — scan a repo, surface candidate coding conventions
   (each grounded in real `file:line` evidence), curate them (accept / reject / edit),
   and merge the accepted ones into a single reusable `repo-conventions` skill.
2. **API Contract Reviewer experiment** — prove skills change review behaviour: the
   same agent misses a breaking change without skills and catches it with them.

## How the Extractor works (and why findings are trustworthy)

```
sample (code only) → cheap LLM → mechanical verification → persist → curate → skill
```

- **Sampling is pure code, no model.** `ConventionsService.sample` reads the repo's
  lint/ts/prettier configs directly from the clone plus the top-ranked source files
  via `repoIntel.getConventionSamples(repoId, 12)` (`server/src/modules/conventions/`).
- **Extraction** asks a *cheap* model (`routeModel('classify', …)` → gpt-4o-mini /
  claude-haiku) for candidates, each citing `{file, line, snippet}`
  (`reviewer-core/src/conventions/extract.ts`).
- **Verification is the trust gate** (`reviewer-core/src/conventions/verify.ts`,
  modelled on `grounding.ts`): a candidate survives ONLY if its cited snippet actually
  exists in a sampled file. Hallucinated evidence is dropped before anything persists,
  and the line range is re-derived from the real match so the GitHub link is accurate.
- **Curation** — accept / reject / edit each candidate (`PATCH /conventions/:id`).
- **Skill assembly** merges ONLY `status='accepted'` candidates into one
  `repo-conventions` body grouped by category (`reviewer-core/.../assemble.ts`).
  Rejected/pending candidates can never reach it (enforced server-side in
  `buildSkillPreview`). Saved via `POST /skills` with `source='extracted'`.

> Expect noise. Many raw candidates are trivial or wrong — that's the point of the
> verification gate + human accept/reject. The deliverable is a few *real* rules
> curated into a project-specific skill, not a long list.

### Quality report (what the Extractor surfaced)

Fill in after running against the demo repo:
- candidates proposed by the model: `N`
- dropped by verification (ungrounded evidence): `M`
- accepted into the skill: `K`
- notes on precision / categories that worked best: …

### Product ideas to get more / better findings (follow-up)

1. **AST pre-seeding** — mine concrete patterns via ast-grep with frequency counts
   ("rule holds in N/M files") and feed them to the model so it ranks by real
   prevalence instead of guessing; pre-seeded candidates also give the verifier free
   ground truth.
2. **Threshold gating** on the N/M ratio; fold it into the confidence score.
3. **Multi-sample voting** — extract over 2–3 disjoint sample sets, keep rules that
   recur (cheap model ⇒ affordable).
4. **Per-category passes** (naming / error-handling / imports / testing) for recall.
5. **Duplicate clustering** via the existing pgvector embedding column.
6. **Negative-example mining** — sample the files that VIOLATE a rule and embed them
   as "bad examples" in the generated skill body, making it far more actionable.

## The A/B experiment

**Goal:** show the API Contract Reviewer catches a breaking change with skills that it
misses without them. The prompt is byte-identical between runs except for the injected
skills section (empty → omitted entirely), so the only variable is the skills.

1. **Create the agent** (Agents UI) using `docs/agent-prompts/api-contract-reviewer.md`
   as the system prompt; `strategy: single-pass`, `ci_fail_on: critical`.
2. **Author the skills** in `docs/agent-prompts/skills/` — create three in the UI and
   **import one** (`deprecation-policy`) to exercise the import path. See that folder's
   README.
3. **Pick a PR that breaks a contract** — e.g. renames a response field or makes a
   request field required. A minimal example:
   ```ts
   // GET /users/:id handler
   - return { id: user.id, fullName: user.fullName };
   + return { id: user.id, name: user.fullName };   // breaking: clients read `fullName`
   ```
4. **Run twice on the same PR:**
   - **Control** — agent with **0 skills linked** → expect it to miss / under-call the
     break (approve or a vague note).
   - **Treatment** — link all four skills → expect a CRITICAL `breaking-change` finding
     citing the exact `file:line`, and `request_changes`.
5. **Record** both runs (the run trace shows the injected skills block in the treatment
   run) for the demo video.

## Demo checklist (acceptance)

- [ ] Conventions page: "Analyze repo" → candidates with category, rule, confidence
      bar, and clickable evidence opening real code on GitHub.
- [ ] Accept several, reject one, edit one; statuses persist.
- [ ] "Create skill" → modal pre-filled with ONLY accepted candidates (rejected
      absent) → edit → Save → appears in Skills (`source=extracted`, `type=convention`).
- [ ] Link `repo-conventions` (or the contract skills) to an agent and run a review.
- [ ] API Contract Reviewer: without skills misses the break; with skills catches it.
