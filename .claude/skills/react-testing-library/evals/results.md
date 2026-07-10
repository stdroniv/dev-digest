# react-testing-library — eval results

Run date: 2026-07-05 · 5 trials/case · 15 executor runs total (general-purpose agents, no memory of each other)

## Summary

| Eval | Expectations | Pass rate |
|---|---|---|
| 0. verdict-banner-bad-test-review (clear-cut) | 6 | 6/6 @ 5/5 = 1.00 |
| 1. findings-list-precision-trap (hard, false-positive trap) | 6 | 6/6 @ 5/5 = 1.00 |
| 2. debounced-search-fake-timers (uncommon scenario) | 5 | 5/5 @ 5/5 = 1.00 |
| **Total** | **17** | **1.00 overall** |

**skill_gaps: 0 · fixture_issues: 0**

## Per-expectation detail

### Eval 0 — verdict-banner-bad-test-review

| ID | Expectation | Pass/5 | Diagnosis |
|---|---|---|---|
| F1 | Flags `fireEvent.click`, recommends `userEvent` | 5/5 | PASS |
| F2 | Flags `getByTestId` on heading/button (Tier-3 vs Tier-1) | 5/5 | PASS |
| F3 | Flags `getByTestId('regenerate-error')`, recommends `getByRole('alert')` | 5/5 | PASS |
| F4 | Flags destructuring from `render()` | 5/5 | PASS |
| F5 | Flags racing assertion after click (regen success) | 5/5 | PASS |
| F6 | Flags racing assertion after click (regen failure) | 5/5 | PASS |

### Eval 1 — findings-list-precision-trap

| ID | Expectation | Pass/5 | Diagnosis |
|---|---|---|---|
| F1 | Flags redundant/wrong-layer `global.fetch` mock | 5/5 | PASS |
| F2 | Flags `container.querySelector` | 5/5 | PASS |
| F3 | Flags module-level `sharedFindings` shared mutable state | 5/5 | PASS |
| F4 | Flags `getByTestId('findings-empty')` | 5/5 | PASS |
| F5 | Precision: does NOT flag "renders findings from the hook" | 5/5 | PASS |
| F6 | Precision: does NOT flag "shows the loading state" | 5/5 | PASS |

### Eval 2 — debounced-search-fake-timers

| ID | Expectation | Pass/5 | Diagnosis |
|---|---|---|---|
| F1 | Uses `userEvent`, not `fireEvent` | 5/5 | PASS |
| F2 | `vi.useFakeTimers()`/`vi.useRealTimers()` wired correctly | 5/5 | PASS |
| F3 | Reconciles userEvent's internal delay with fake timers (`delay: null` / `advanceTimers` / `advanceTimersByTimeAsync`) | 5/5 | PASS |
| F4 | Asserts no call before debounce window elapses | 5/5 | PASS |
| F5 | Asserts exactly-once call with final value after window | 5/5 | PASS |

## Notes

- No SKILL_GAP or FIXTURE_ISSUE surfaced in this run — all 17 expectations held at 5/5 across independent trials.
- Eval 2 specifically targeted a hypothesized gap (SKILL.md's Timers section shows `vi.useFakeTimers()`/`advanceTimersByTime()` but never calls out the userEvent-internal-delay-vs-fake-timers interaction). The hypothesis did not materialize as a miss: all 5 trials independently reached for `userEvent.setup({ delay: null })` and/or `{ advanceTimers: vi.advanceTimersByTime }` / `vi.advanceTimersByTimeAsync`. This is general model knowledge compensating for a documentation gap, not evidence the gap doesn't exist — SKILL.md's Timers section could still be strengthened with an explicit userEvent+fake-timers example for robustness against weaker models or future drift, but this run doesn't demonstrate a live defect.
- 5 of 15 initial agent launches hit a transient "model temporarily unavailable" classifier error and were retried once each; all retries succeeded and are included in the 5/5 trial counts above.
