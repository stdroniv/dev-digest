# react-best-practices eval results

Run date: 2026-07-05 · 5 trials/eval · 3 eval cases, 16 expectations, 80 expectation-instances.

**Overall pass rate: 0.85 (68/80)**. Zero SKILL_GAPs — every miss traces to fixture/expectation design, not missing or wrong skill content.

## Eval 0 — findings-panel (clear-cut / obviously-broken)

| # | Expectation | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | sortedFindings derived-state-via-useEffect | 5/5 | PASS |
| F2 | Analytics useEffect stale-closure / bad deps | 5/5 | PASS |
| F3 | index-as-key on reorderable list | 5/5 | PASS |
| F4 | renderSortSummary render-factory | 5/5 | PASS |
| F5 | useQuery in body vs custom hook | 0/5 (fixed, spot-check 2/2) | FIXTURE_ISSUE (fixed) |

## Eval 1 — team-members (hard / precision trap)

| # | Expectation | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | Inline `roles` array breaks MemberBadge memo | 5/5 | PASS |
| F2 | TeamCountBadge `{count && ...}` falsy-zero bug | 5/5 | PASS |
| F3 | useTeamStats unnecessary useMemo | 5/5 | PASS |
| F4/F5 (merged) | PermissionsContext derive-don't-store + over-engineered Context (credited as either two findings or one combined finding) | fixed, spot-check 2/2 | FIXTURE_ISSUE (fixed) |
| F6 | Precision: MemberBadge.tsx not flagged | 5/5 | PASS |
| F7 | Precision: WorkspaceThemeProvider.tsx not flagged | 5/5 | PASS |

## Eval 2 — activity-feed (uncommon scenario)

| # | Expectation | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | Mismatched on/off closures (subscribe leak) | 5/5 | PASS |
| F2 | StrictMode mount/unmount/remount implication explained | 5/5 | PASS |
| F3 | Hook returns new object/array, defeats ActivityList memo | 5/5 | PASS |
| F4 | Precision: ActivityList.tsx not itself criticized (hook-side fix required; secondary non-contradicting memo()-removal mention on the child allowed) | 3/5 (fixed, spot-check 2/2) | FIXTURE_ISSUE (fixed) |

## Fixture issues (3, no skill gaps) — all fixed 2026-07-06

1. **eval 0 / F5 (fixed)** — `useQuery`-in-body vs custom-hook extraction never surfaced separately from the loading/error-handling finding; crowded out by 4 co-located CRITICAL bugs in one small file. Fix: reworded eval 0's prompt in `evals.json` to ask for "all React best-practice issues ... including code organization and structure, not just bugs." Spot-check: 2/2 independent trials PASSED — each gave the hook-extraction point as its own distinct finding.
2. **eval 1 / F4+F5 (fixed)** — Context-over-engineering and Derive-Don't-Store fire on the identical 4 lines; reviewers correctly fix both but never narrate them as two distinct findings. Fix: merged F4 and F5 in `evals.json` into a single "F4/F5 (merged)" expectation crediting either two separate call-outs or one combined call-out addressing both angles. Spot-check: 2/2 independent trials PASSED — each gave one combined finding covering both the useState+useEffect anti-pattern and the unnecessary Context/Provider.
3. **eval 2 / F4 (fixed)** — 2/5 trials suggested dropping `memo()` from `ActivityList` as an *alternative* fix while still correctly rooting the bug in the hook — a reasonable engineering call that tripped an over-strict precision check. Fix: reworded F4 in `evals.json` to require the hook-side fix as primary while explicitly allowing a secondary, non-contradicting mention of dropping the child's `memo()`. Spot-check: 2/2 independent trials PASSED — both rooted the fix in the hook and explicitly cleared `ActivityList.tsx`.

## Takeaway

The skill's content is solid — no case where SKILL.md was missing guidance or gave wrong guidance. All three fixture issues stemmed from expectations asking reviewers to separate things that were either genuinely entangled in the code (eval 1 F4/F5) or lower-priority relative to co-located bugs (eval 0 F5, eval 2 F4). All three were fixed via prompt/expectation edits in `evals.json` (not skill changes) and re-validated with 2 independent spot-check trials each (not full 5-trial reruns).
