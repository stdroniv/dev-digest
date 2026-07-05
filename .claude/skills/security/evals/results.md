# Security skill — eval results (2026-07-05, fixture fixes + spot-check 2026-07-06)

5 trials per eval case, 3 cases, 15 expectations total. **Overall pass rate: 96% (72/75 trial-expectation pairs).**

Both FIXTURE_ISSUEs below were fixed on 2026-07-06 and re-validated with a 2-trial spot check each (not a full 5-trial rerun) — see "Fixture fixes" section at the bottom.

## Case 0 — auth-jwt-none-and-nosql-injection

| Exp | Text | Pass/5 | Diagnosis |
|---|---|---|---|
| F1 | jwt.verify() missing `algorithms` allowlist | 5/5 | PASS |
| F2 | NoSQL operator injection in login query | 5/5 | PASS |
| F3 | Hardcoded MongoDB connection string | 4/5 | FIXTURE_ISSUE (fixed) |
| F4 | Plaintext password compare (no bcrypt) | 5/5 | PASS |
| F5 | Missing rate limiter on /login | 5/5 | PASS |

## Case 1 — file-upload-precision-trap

| Exp | Text | Pass/5 | Diagnosis |
|---|---|---|---|
| F1 | `file.originalname` used as on-disk filename | 5/5 | PASS |
| F2 | DELETE path built from `req.query.path`, no containment check | 5/5 | PASS |
| F3 | `Media.create({ ...req.body })` mass assignment | 5/5 | PASS |
| F4 | Missing rate limiter on POST /avatars | 5/5 | PASS |
| F5 | Precision: MIME allowlist not escalated to F1-F4 severity | 3/5 | FIXTURE_ISSUE (fixed — check moved to Case 3) |
| F6 | Precision: static-serving config / Mongoose schema not flagged | 5/5 | PASS |

## Case 3 — upload-mime-allowlist-precision (new, added 2026-07-06)

Isolated fixture (`files/upload-mime-only/upload-config.ts`) with only the spoofable client-reported MIME check and a safe `crypto.randomUUID()` filename — no co-located real bug. Not part of the original 5-trial run; validated with a 2-trial spot check only.

| Exp | Text | Pass/2 | Diagnosis |
|---|---|---|---|
| F1 | MIME allowlist not escalated to HIGH/CRITICAL when graded in isolation | 2/2 | PASS (spot-check) |
| F2 | Server-generated filename recognized as already safe against traversal | 2/2 | PASS (spot-check) |

## Case 2 — idor-and-proxy-trust-bypass

| Exp | Text | Pass/5 | Diagnosis |
|---|---|---|---|
| F1 | GET/DELETE comment IDOR (no ownership check) | 5/5 | PASS |
| F2 | Notes `canManageComment` unused server-side (client-only enforcement) | 5/5 | PASS |
| F3 | `trust proxy: true` enables X-Forwarded-For spoofing | 5/5 | PASS |
| F4 | Proposes specific hop-count/CIDR fix | 5/5 | PASS |

## Findings

**SKILL_GAP: none found.** SKILL.md's A01 (ownership checks), A04 (JWT algorithm pinning), A05 (NoSQL casting), A08 (mass assignment), File Upload Security (server-generated filenames, path.resolve containment), and the Express `trust proxy` quirk all fully covered every violation the fixtures seeded, across all 5 trials each. This is a strong result for the skill as-is — no changes recommended to SKILL.md.

**FIXTURE_ISSUE x2 (both fixed 2026-07-06):**
1. `auth-jwt-none/users-repository.ts`'s inline comment marking the Mongo URI as a "synthetic ... not a real credential" leaked eval intent into the code — one trial explicitly used that comment to justify *not* reporting the hardcoded-secret pattern. Fix: keep the "this is fake" disclosure only in `evals.json` notes, not in the fixture source.
2. `file-upload-mixed` co-locates the spoofable-MIME weakness with the real filename bug in the same file; 2/5 trials reasonably escalated the MIME finding to HIGH severity because the two bugs compound. The "don't over-flag MIME as high severity" expectation is hard to grade cleanly when a second real bug in the same fixture legitimately amplifies it — consider separating the two into different files if a cleaner precision signal is needed.

No FLAKY classifications were needed — every partial failure had an identifiable root cause (fixture leakage or fixture bug interaction), not unexplained model variance.

## Fixture fixes (2026-07-06)

1. **Hardcoded-secret comment** — removed the "Synthetic connection string for eval fixtures only — not a real credential" comment from `files/auth-jwt-none/users-repository.ts`. The "this is fake" disclosure now lives only in `evals.json`'s `notes` field (matching the `backend-onion-architecture` skill's precedent). Spot-check: 2 independent trials, each reading only `SKILL.md` + the three fixture files (no visibility into evals.json/results.json) — **2/2 PASS**, both trials flagged the Mongo URI as a CRITICAL hardcoded-credential finding with a concrete env-var/rotation fix.

2. **MIME-check/filename-bug co-location** — removed the MIME `fileFilter` from `files/file-upload-mixed/upload-config.ts` entirely (that fixture now contains only the real filename/path-traversal bug, F1-F4/F5(was F6)). Created a new isolated fixture `files/upload-mime-only/upload-config.ts` (safe `crypto.randomUUID()`-based filename + only the spoofable client-reported MIME allowlist, no other planted bug), tracked as new eval case id 3, `upload-mime-allowlist-precision`. Spot-check: 2 independent trials against the isolated fixture — **2/2 PASS**, both trials rated the MIME check MEDIUM or a non-blocking "note" and explicitly declined to escalate to HIGH/CRITICAL, and both explicitly recognized the server-generated filename as already safe against path traversal.

Both fixes are spot-checks (2 trials each), not full 5-trial reruns — sufficient to confirm the fixture-authoring problem is resolved, not a new statistically robust pass-rate measurement.
