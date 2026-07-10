# fastify-best-practices eval results

Run date: 2026-07-05 · 3 eval cases x 5 trials = 15 executor reviews, 15 expectations graded.

**Overall pass rate: 0.92** (69/75 expectation-checks across all trials)

## Eval 0 — pr-comments (clear-cut: hang / crash / unvalidated body)

| Exp | Check | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | Manual `JSON.parse(Buffer)` bypasses schema | 5/5 | PASS |
| F2 | Missing `return` after 404 → null deref | 5/5 | PASS |
| F3 | Fallthrough causes crash / double-send | 5/5 | PASS |
| F4 | "already-resolved" branch never replies → hang | 2/5 | **SKILL_GAP (fixed)** — 2/2 spot-check trials now pass |
| F5 | `setImmediate` throw escapes error lifecycle | 5/5 | PASS |

## Eval 1 — digest-exports (precision trap)

| Exp | Check | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | preHandler 403 missing `return` | 5/5 | PASS |
| F2 | POST route has no `schema.body` | 5/5 | PASS |
| F3 | Catch block leaks `error.stack` to client | 5/5 | PASS |
| F4 | List route missing response schema | 5/5 | PASS |
| F5 | (precision) GET `/:exportId` not flagged | 5/5 | PASS |

Clean fixture — no false positives on the correctly-written route in any trial.

## Eval 2 — live-notifications (uncommon: fp misuse / silent swallow / ws leak)

| Exp | Check | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | Flags the comment's wrong explanation of `fp()`, not the wrap itself as broken | 2/5 (old wording) | **FIXTURE_ISSUE (fixed)** — 2/2 spot-check trials now pass |
| F2 | `onRequest` hook silently swallows errors | 5/5 | PASS |
| F3 | Heartbeat `setInterval` never cleared | 5/5 | PASS |
| F4 | No `close`/`error` listeners on the socket | 5/5 | PASS |
| F5 | Unguarded `JSON.parse` in message handler | 5/5 | PASS |

## Findings requiring action (both fixed and spot-checked)

**SKILL_GAP (1) — fixed:** `routes.md`/`hooks.md`/`error-handling.md` taught "you must `return` after `reply.send()`" but never taught the inverse: an async handler that returns `undefined` without calling `reply.send()` anywhere leaves the response unresolved (hangs). 3/5 trials missed this quieter bug while catching the louder `setImmediate` crash and null-deref bugs nearby.
Fix applied: added an explicit callout + code example to `routes.md`'s "Reply Methods" section describing this exact failure mode.
Spot-check: 2 fresh executor trials re-ran eval 0's prompt against the same fixture with the updated `routes.md`. Both explicitly flagged the "already-resolved" branch as never sending a reply and hanging the request. **2/2 spot-check trials now pass.**

**FIXTURE_ISSUE (1) — fixed:** eval 2's F1 expectation called the whole-plugin `fp()` wrap "encapsulation-breaking misuse," but the fixture's nested `fastify.register(liveNotificationsRoutes, {...})` call re-establishes its own encapsulation context regardless of the outer `fp()` wrap — so the inner hook stays correctly scoped either way. 3/5 trials reasoned this through correctly and defended the pattern (while still flagging the misleading comment).
Fix applied: reworded eval 2's F1 in `evals.json` to require only "flags the comment's factually wrong explanation of what `fp()` does," not "flags the wrap as encapsulation-breaking misuse."
Spot-check: 2 fresh executor trials re-ran eval 2's prompt against the fixture. Both flagged the comment as misleading and both explicitly concluded the `fp()` wrap itself is not broken/misuse. **2/2 spot-check trials now pass** against the reworded expectation.

No FLAKY diagnoses were needed — every sub-100% expectation had a clear, reproducible cause.
