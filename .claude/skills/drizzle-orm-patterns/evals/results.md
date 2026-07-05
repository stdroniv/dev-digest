# drizzle-orm-patterns eval results (5 trials/case, 2026-07-05)

## Eval 0 — digest-runs (N+1 + untransacted write)
| Exp | Text | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | Flags N+1 loop in listRunsWithFindings | 5/5 | PASS |
| F2 | Recommends relational `with` query + relations() | 5/5 | PASS |
| F3 | Flags completeRun's untransacted update+insert | 5/5 | PASS |

## Eval 1 — invites (MySQL precision trap)
| Exp | Text | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | Flags unchunked 5,000-row batch insert | 5/5 | PASS |
| F2 | Flags `.returning()` on MySQL insert | 5/5 | PASS |
| F3 | Flags listActiveMembers missing soft-delete filter | 5/5 | PASS |
| F4 | Flags `invitedBy.references(users.id)` (no arrow fn) | 5/5 | PASS |
| F5 | Precision: doesn't flag getInvitesPage pagination | 5/5 | PASS |
| F6 | Precision: doesn't flag revokeInvite's transaction | 5/5 | PASS |

**Fixture defects found (unintended, not scored) — both FIXED:**
- `schema.ts` `emailIdx: { columns, unique }` is invalid Drizzle syntax — all 5 trials flagged it as CRITICAL. Not a seeded violation; crowded the intended signal. Diagnosis: FIXTURE_ISSUE (fixed) — changed to `uniqueIndex('users_email_idx').on(table.email)`. Spot-check: 2/2 fresh trials now call the index syntax correct with no complaint, while still catching all 4 intended violations (F1-F4) and both precision checks (F5-F6).
- `getInvitesPage` docstring says "non-expired" but code never filters `expiresAt` — 3/5 trials caught the mismatch. Diagnosis: FIXTURE_ISSUE (fixed) — docstring corrected to "outstanding (non-revoked)" to match actual behavior, per evals.json's original intent for F5 (grading the pagination mechanism, not expiry filtering). Spot-check: 2/2 fresh trials found no docstring/behavior mismatch.

## Eval 2 — comment-threads (self-referencing adjacency list + unsafe migration)
| Exp | Text | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | Flags missing `(): AnyPgColumn =>` on self-ref FK | 5/5 | PASS |
| F2 | Flags migration's NOT NULL w/o DEFAULT on ~42M rows | 5/5 | PASS |
| F3 | Flags unique email index vs. soft-delete interaction | 0/5 | **SKILL_GAP (fixed)** |
| F4 | Precision: doesn't flag listActiveUsers' isNull filter | 5/5 | PASS |

F3 fix: added a "Soft Delete + Unique Constraints" subsection to `references/common-patterns.md` (partial/conditional `uniqueIndex().on(...).where(sql\`deleted_at IS NULL\`)` pattern, with rationale distinguishing it from the `onConflictDoUpdate` reactivation case) plus a cross-reference callout in `references/schema-definition.md`'s Indexes section. Spot-check: 2/2 fresh trials, re-run against the updated skill on eval 2's prompt, now explicitly flag the `users.email` partial-index gap, citing the new guidance by name.

## Summary
- **13 expectations graded, 60/65 trial-checks passed → overall pass rate 0.92 (original run)**
- **1 SKILL_GAP, now fixed**: skill never documented combining soft delete with a unique constraint (partial/conditional unique index). All 5 original trials fixed the adjacent race condition (`onConflictDoUpdate`) but missed that a genuinely new user can never reuse a soft-deleted email. Fixed in `common-patterns.md`/`schema-definition.md`; spot-check 2/2 trials now pass.
- **2 FIXTURE_ISSUEs, both fixed** (both in eval 1, neither caused a graded failure): an accidental invalid-syntax bug in the email index, and a docstring/behavior mismatch in `getInvitesPage`. Both cleaned up so the fixture no longer generates true-but-unintended findings that dilute the precision-trap's signal; spot-check 2/2 trials each confirm the noise is gone and all intended findings still fire.
- **0 FLAKY** — every miss/pass was consistent across all 5 trials of its eval case (no split decisions), so there's no non-determinism story here; the one failure was a clean, reproducible skill gap, now closed.
