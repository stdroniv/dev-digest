# Workflow Retro Ledger

One row per retro. Longitudinal trend log for multi-agent runs — see `.claude/skills/workflow-retro`.

| date | label | agents (top+nested) | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|---------------------|------------|-----------|------|-------------|------|--------------------|
| 2026-07-02 | onboarding-generator-ship | 13 (12+1 nested Explore) | 271k→674k (+172M cache-read) | 96% | ~multi-hr (incl. human gates) | ~1.7× (approx) | n/a (mixed Opus/Sonnet; prices unverified) | [workflow] Split a large single-package UI build by sub-layer (foundation→components→wiring) past ~15 files/~150 turns, so a dropped agent has a small blast radius |
