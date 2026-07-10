# Workflow Retro Ledger

One row per retro. Longitudinal trend log for multi-agent runs — see `.claude/skills/workflow-retro`.

| date | label | agents (top+nested) | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|---------------------|------------|-----------|------|-------------|------|--------------------|
| 2026-07-02 | onboarding-generator-ship | 13 (12+1 nested Explore) | 271k→674k (+172M cache-read) | 96% | ~multi-hr (incl. human gates) | ~1.7× (approx) | n/a (mixed Opus/Sonnet; prices unverified) | [workflow] Split a large single-package UI build by sub-layer (foundation→components→wiring) past ~15 files/~150 turns, so a dropped agent has a small blast radius |
| 2026-07-11 | skill-evals-eval-modal-ship | 8 (8+0 nested) | 281k→347k (+261M cache-read) | 98% | ~4.2h (incl. human gates) | 0.40 (2 fan-out bursts ~2.2–2.5× internally; serial implement/plan tentpoles) | ~$80 (Opus 4.8 std + Sonnet 5 intro; ~$54 implementer alone = 88% of cache-read) | [instruction] Split the implementer per-phase with a checkpoint once a plan exceeds ~10 tasks, UNLESS consecutive phases share a wire surface — caps the single-context cache-read tax (one agent = 228.9M cache-read / ~$54 here) |
