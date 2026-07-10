# postgresql-table-design — Eval Results (2026-07-05)

5 trials per eval case, 3 eval cases, 16 expectations, 80 trial-checks total.
**Overall pass rate: 65/80 = 81.25%**

## Eval 0 — digest-schedule-runs-migration (obvious violations)

| Exp | Description | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | SERIAL → identity | 5/5 | PASS |
| F2 | VARCHAR → TEXT | 5/5 | PASS |
| F3 | TIMESTAMP → TIMESTAMPTZ | 5/5 | PASS |
| F4 | Missing FK indexes | 5/5 | PASS |
| F5 | FK missing ON DELETE | 5/5 | PASS |
| F6 | Missing (workspace_id, status) composite index | 5/5 | PASS |

**6/6 expectations at 100%.** Clear-cut case is fully covered by the skill.

## Eval 1 — review-workspace-schema (hard / precision trap)

| Exp | Description | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | author JSONB overuse | 0/5 | FIXTURE_ISSUE (fixed) |
| F2 | score CHECK missing NOT NULL | 0/5 | FIXTURE_ISSUE (fixed) |
| F3 | external_id UNIQUE missing NULLS NOT DISTINCT | 0/5 | FIXTURE_ISSUE (fixed) |
| F4 | Missing (workspace_id, status) composite index | 5/5 | PASS |
| F5 | tags TEXT[] missing GIN index | 5/5 | PASS |
| F6 | Precision: workspaces not flagged | 5/5 | PASS |
| F7 | Precision: review_comments.review_id FK not flagged | 5/5 | PASS |

**4/7 expectations at 100%; 3/7 failed in all 5 trials.** In every trial the model
explicitly *defended* all three intended violations as correct, deliberate design —
quoting the fixture's own in-line comments back as justification. Root cause: the
narrative comments I wrote to make the fixture "realistic" (snapshot rationale,
legacy-rows rationale) accidentally supply a legitimate-sounding reason for each
violation, so models reasoned themselves into the wrong (but locally coherent)
conclusion. This is a fixture-authoring defect, not a skill gap — the skill's
guidance on JSONB overuse, CHECK+NOT NULL, and NULLS NOT DISTINCT is all present
and correctly worded.

## Eval 2 — notifications-polymorphic (uncommon scenario)

| Exp | Description | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | Polymorphic association flagged, alternative proposed | 5/5 | PASS |
| F2 | SERIAL → identity | 5/5 | PASS |
| F3 | TIMESTAMP → TIMESTAMPTZ | 5/5 | PASS |

**3/3 at 100%.** Skill handles the uncommon structural anti-pattern well even
though it isn't named explicitly in SKILL.md — models generalized correctly from
the FK/normalization guidance.

## Findings

- **No SKILL_GAP found.** Every miss traces to fixture construction, not missing
  or wrong skill guidance.
- **3 distinct FIXTURE_ISSUE findings**, all in eval 1, all sharing the same root
  cause: explanatory comments in the fixture read as design justification rather
  than as backstory, letting the model rationalize away the intended violation.
- Recommended fix for next iteration: rewrite eval 1's three comments to state a
  concrete symptom/bug caused by the current design (e.g., "the dashboard can't
  tell an unscored review from a silently-failed score check", "duplicate rows
  are appearing because multiple re-imports share a NULL external_id") instead of
  a narrative that sounds like a deliberate tradeoff.

## Fixture fix + spot-check (2026-07-06)

Rewrote all three flagged comments in
`evals/files/review-workspace-schema/schema.sql` to state a concrete resulting
bug/symptom instead of a design justification:

- `author` JSONB: now says support tickets report full-table JSONB scans to
  find reviews by a given GitHub login, with no index/join path.
- `score`: now says the dashboard's `score IS NULL` "needs attention" bucket
  silently conflates "not yet scored" with "scoring crashed."
- `external_id`: now says webhook replays are producing duplicate rows in the
  studio because multiple rows share `external_id = NULL` under a plain
  `UNIQUE` constraint.

**Spot-check** (2 independent trials, not a full 5-trial rerun): each trial was
given only `SKILL.md` + the corrected `schema.sql` (no expectations shown) and
asked to review the schema. Both trials flagged all 3 previously-missed
violations (author JSONB, score/status NULL ambiguity, external_id duplicate
NULLs) and neither introduced a false positive on the two precision-check
items (`workspaces` table, `review_comments.review_id` FK+index), which both
trials still correctly left alone. Fixture fix confirmed effective; no full
5-trial rerun performed.
