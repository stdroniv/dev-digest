# reviewer-core — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module
(`@devdigest/reviewer-core`). Managed by the `engineering-insights` skill. Add each
entry under one section; keep it actionable cold; never edit or delete existing entries.

## What Works

- The false-negative re-sample guard in `reviewPullRequest` (`src/review/run.ts`) MUST perturb each extra draw — bump `temperature` (default 0.4) AND offset the seed (`seed + i + 1`). Re-sending the same messages at `temperature: 0` + the same seed just reproduces the identical lazy-empty result (especially with the provider pinning from the determinism fix), silently defeating the guard. The guard is also scoped to `mode === 'single-pass'` and to `merged.findings.length === 0`, and the dedup (`dedupeFindings` in `reduce.ts`) is applied ONLY on the re-sample branch — so the normal single-sample path stays byte-identical to before (the repo's "omitted slot → identical behavior" contract). Off by default via `resampleOnEmpty ?? 0`.

## What Doesn't Work

- The grounding gate (`src/grounding.ts`) is an ASYMMETRIC safety net: it only DROPS findings whose lines don't intersect a diff hunk (defends against false positives / hallucinated locations). It has ZERO defense against false NEGATIVES — when the model lazily returns `findings: []`, nothing recovers them, and `scoreFromFindings([])` (`src/review/reduce.ts`) mechanically returns 100 → a clean "approve". A single low-effort sample silently passes a buggy PR. Don't treat an empty findings list as trustworthy; if you need a real merge gate, add an explicit guard (re-sample on empty / self-consistency over N samples / worst-verdict union) — grounding will NOT catch this for you.
- `temperature: 0` (`src/llm/openrouter.ts:72`) does NOT make reviews reproducible. A byte-identical prompt (verified via SHA over every `prompt_assembly` section) produced 2 findings / 1643 output tokens one run and 0 findings / 131 tokens the next, same agent + same PR + same model. Causes: OpenRouter routes a model id across multiple upstream hosts/quantizations with no provider pinning, no `seed` is sent, and MoE models (e.g. `deepseek/deepseek-v4-flash`) route experts non-deterministically under server-side batching. `…-flash`/distilled tiers are especially prone to short lazy completions. To reduce drift: send a `seed` and pin `provider: { allow_fallbacks: false }` in the `chat.completions.create` call, and don't gate merges on a flash-tier model.

## Codebase Patterns

- The `skills` prompt slot (`assemblePrompt` in `src/prompt.ts`) is TRUSTED content: skill bodies are joined with `\n\n` under `## Skills / rules` and are deliberately NOT `wrapUntrusted()`-fenced (unlike the diff, PR body, repo-map, specs). The trust boundary is enforced upstream — the server's run-executor injects only `enabled` skills, and imported/community skills are created `enabled:false` until a human vets them. So if you add a new skill-like slot, decide trust explicitly: vetted house rules → plain; anything author/third-party-controlled → `wrapUntrusted`.

## Tool & Library Notes

- To debug "agent verdict regressed but nothing changed", compare the two runs' persisted prompts directly — don't trust the human-readable summaries (they describe the OUTPUT, which can diverge wildly from identical input). Traces live in Postgres, not the filesystem: `select trace from run_traces where run_id='<uuid>'` (jsonb). SHA-256 each `prompt_assembly` section (`user`, `system`, `skills`, `callers`, `repo_map`, `pr_description`) across both runs; if `tokens_in` matches and all hashes match, the input is byte-identical and the regression is pure model non-determinism, not your prompt/skills/diff. The `runs/<id>/trace` path users quote is a client route, not a file.

## Recurring Errors & Fixes

## Session Notes

## Open Questions
