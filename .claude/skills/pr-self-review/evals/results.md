# pr-self-review eval results

5 trials/eval, 3 evals, 15 expectations total. Overall pass rate: **89.3%** (67/75 trial-expectation checks).
No SKILL_GAP findings — every miss traces to a fixture-authoring mistake, not a gap in
SKILL.md/routing.md/severity.md. See `notes` in `evals.json` for the diff→fixture-file adaptation.

## eval 0 — critical-and-warning-mix (clear-cut CRITICAL + WARNING + clean file)

| Exp | Check | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | SQL injection flagged CRITICAL | 5/5 | PASS |
| F2 | N+1 query flagged WARNING (not CRITICAL) | 5/5 | PASS |
| F3 | No finding on clean mapper.ts | 5/5 | PASS |
| F4 | Verdict BLOCKED, critical >= 1 | 5/5 | PASS |
| F5 | Rollup critical count matches findings list | 5/5 | PASS |

All 5 trials also correctly raised a second CRITICAL (route bypassing service/repository —
onion-architecture "presentation touching infrastructure") on the same search handler. Expected and fine.

## eval 1 — authz-precision-trap (hard precision trap: backend route + frontend hook)

| Exp | Check | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | DELETE route missing authz flagged CRITICAL | 5/5 | PASS |
| F2 | No CRITICAL/WARNING on service.ts | 2/5 | **FIXTURE_ISSUE (fixed)** |
| F3 | No CRITICAL/WARNING on the client hook (SUGGESTION OK) | 4/5 | FIXTURE_ISSUE (fixed) |
| F4 | GET/POST routes not misdescribed as vulnerable | 5/5 | PASS |
| F5 | Both backend + frontend skills invoked; BLOCKED | 5/5 | PASS |

F2: fixture's service.ts accidentally reused the DI-construction-in-constructor smell seeded
intentionally in eval 0 — 3/5 trials correctly flagged it as WARNING, contradicting the eval's
"service.ts is clean" premise. **Fixed**: `evals/files/authz-precision-trap/service.ts` now
resolves its repository via `container.notificationsRepo` (a composition-root getter, matching the
real `Container`'s `get reviewRepo()`/`get agentsRepo()` pattern) instead of `new`-ing it in the
constructor. F3: one trial added a defensible secondary SUGGESTION on the hook — the expectation
in `evals.json` was reworded to tolerate a non-blocking SUGGESTION as long as no CRITICAL/WARNING
is raised.

**Spot-check (2026-07-06):** 2 independent re-run trials against the corrected
fixture/expectations (not a full 5-trial rerun) — both trials: no CRITICAL/WARNING on service.ts,
only a non-blocking SUGGESTION on the client hook, F1/F4/F5 still held. Both trials PASS.

## eval 2 — test-only-diff (uncommon scenario: no source files changed)

| Exp | Check | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | service.test.ts weak assertion flagged | 5/5 | PASS |
| F2 | notifications.test.tsx premature assertion flagged | 5/5 | PASS |
| F3 | Both findings WARNING/SUGGESTION, never CRITICAL | 5/5 | PASS |
| F4 | Verdict PASS, critical 0 | 5/5 | PASS |
| F5 | No blocking backend-onion-architecture finding on the test file (non-blocking WARNING/SUGGESTION OK) | 1/5 | **FIXTURE_ISSUE (fixed)** |

F5: the fixture's `as never` + `@ts-expect-error` private-field test-double pokes exactly the
DI/composition-root convention backend-onion-architecture documents — 4/5 trials correctly (and
usefully) cited that skill at WARNING/SUGGESTION level. Non-blocking, on-topic; the expectation
was too strict in assuming that skill has nothing to say about a test file. **Fixed**: reworded
in `evals.json` to tolerate an on-topic, non-blocking WARNING/SUGGESTION on the server test file's
DI seam, as long as the PASS verdict holds.

**Spot-check (2026-07-06):** 2 independent re-run trials against the corrected expectation — both
trials raised a non-blocking WARNING/SUGGESTION on the DI-bypass test-double pattern (no
CRITICAL), verdict stayed PASS both times, F1-F4 still held. Both trials PASS.

## Takeaways

- **No SKILL_GAP**: routing (routing.md), severity calibration (severity.md), and the BLOCKED/PASS
  gate all behaved correctly and consistently across all 15 trials — including the two edge cases
  (cross-cutting diff, test-only diff) the skill's own docs don't spell out explicitly.
- **3 FIXTURE_ISSUE findings**, all from fixtures that were subtly *less clean* than the eval
  authoring intended, or expectations that were stricter than the skill's own (reasonable)
  behavior. None indicate the skill over-flags or under-flags — the "extra" findings are real,
  correctly-severitied, non-blocking observations.
- **All 3 fixed 2026-07-06**: `authz-precision-trap/service.ts` now uses a container-getter
  pattern instead of `new`-ing its repository; the two overly-strict expectations (eval1/F3,
  eval2/F5) were reworded to tolerate defensible, non-blocking secondary findings. A 2-trial
  spot-check (not a full 5-trial rerun) confirmed all 3 now pass — see the `spot_check_2026_07_06`
  block in `results.json`.
