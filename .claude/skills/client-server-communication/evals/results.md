# client-server-communication — eval results

Run: 3 eval cases x 5 trials each (15 executor runs total). All 16 expectations passed 5/5.

## Eval 0 — review-comments (clear-cut violations)

| Expectation | Pass rate | Diagnosis |
|---|---|---|
| F1 verb URL `POST /getReviewComments` | 5/5 | PASS |
| F2 `200 {ok:false}` instead of 4xx | 5/5 | PASS |
| F3 stack trace leaked in 500 body | 5/5 | PASS |
| F4 non-idempotent `PUT .../increment-vote` | 5/5 | PASS |
| F5 client `as ReviewCommentRecord[]` cast, not parse | 5/5 | PASS |

## Eval 1 — digest-exports (precision trap)

| Expectation | Pass rate | Diagnosis |
|---|---|---|
| F1 offset pagination, no envelope | 5/5 | PASS |
| F2 missing Cache-Control/ETag despite comment | 5/5 | PASS |
| F3 bare-string 404 vs error envelope | 5/5 | PASS |
| F4 retryable POST, no Idempotency-Key | 5/5 | PASS |
| F5 busy-poll (`setTimeout(tick, 750)`) instead of push | 5/5 | PASS |
| F6 (precision) api-client.ts NOT flagged | 5/5 | PASS |
| F7 (precision) DELETE handler / error handler NOT flagged | 5/5 | PASS |

## Eval 2 — pr-run-events (SSE partial-failure / reconnect, uncommon scenario)

| Expectation | Pass rate | Diagnosis |
|---|---|---|
| F1 no terminal done/error SSE event | 5/5 | PASS |
| F2 no per-event `id:` / Last-Event-ID resume | 5/5 | PASS |
| F3 client has no `onerror` / connection-health signal | 5/5 | PASS |
| F4 (precision) SSE/push choice itself NOT flagged | 5/5 | PASS |

## Summary

- Total expectations: 16
- Overall pass rate: 1.0 (16/16 at 5/5)
- Distinct SKILL_GAP findings: 0
- Distinct FIXTURE_ISSUE findings: 0
- Note: in eval 1 trial 1, one output mislabeled the Cache-Control finding (F2) as "out of scope for this skill" while still correctly applying the skill's own rule 9 and reaching the right fix -- a self-labeling quirk in a single trial, not a missed expectation, skill gap, or fixture defect.

## Takeaway

The skill's explicit, DevDigest-grounded rules (status codes, error envelope, idempotency, pagination, caching, and the SSE/live-update guidance) were followed consistently and precisely across all 15 independent executions, including the harder precision-trap and SSE-reconnect scenarios that a generic REST checklist would likely miss. No changes to SKILL.md or references are indicated by this run. No fixture rewrites are indicated either.
