# Skill Benchmark: backend-onion-architecture

**Model**: claude-sonnet-5
**Date**: 2026-07-05T14:23:32Z
**Evals**: 0 — webhooks-module-architecture-review (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 80% ± 0% | +0.20 |
| Time | 112.9s ± 0.0s | 89.3s ± 0.0s | +23.6s |
| Tokens | 59,907 ± 0 | 46,735 ± 0 | +13,172 |

## Notes

- Single run per configuration (n=1) — no variance data; treat the pass-rate delta as directional, not statistically robust.
- The only assertion that discriminated between conditions was F4 (raw Drizzle rows leaking outward with no DTO mapping) — without-skill missed it entirely, including the secondary security implication that the `secret` column round-trips back to the client.
- With-skill found 3 legitimate issues beyond the seeded 5 (DI/composition-root violation, hand-rolled Zod casts, no domain layer at all), each traceable to a specific reference doc.
- Without-skill found 2 legitimate issues beyond the seeded 5 (fetch has no error handling for thrown network errors; unused `:endpointId` param) — real but tactical rather than architectural.
- Caveat: the without-skill baseline was allowed to skim `server/CLAUDE.md` and a sibling module, so this isolates the skill's *incremental* value over already-good repo hygiene, not skill-vs-nothing.
