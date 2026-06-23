# Traceability Matrix — template & worked example

Read this when you need the full report shape or an example of good evidence vs
weak evidence. The goal of the matrix is that **anyone can follow each Evidence
reference and confirm the status themselves** — evidence that can't be checked is
not evidence.

## Columns

| Column | Rule |
|--------|------|
| `#` | Stable id per requirement (R-01, R-02, …) so gaps can be referenced. |
| `Requirement / AC` | One atomic, checkable outcome. Split bundled items. Quote the plan where possible. |
| `Status` | Exactly one of `Implemented` / `Partial` / `Missing` / `Cannot-verify`. |
| `Evidence` | Addressable: `file:line` and the **test name** that exercises the behavior. Add the verification method used (Test / Inspection / Analysis). |
| `Gap` | For anything not `Implemented`: what's absent, concretely. `none` otherwise. |

## Verification methods (note which you used)

- **Test** — a passing automated test exercises the AC path (strongest).
- **Inspection** — you read the code and confirmed the logic/wiring by eye.
- **Analysis** — you reasoned from related artifacts (types, schema, config).

Prefer Test. Down-rank confidence when the only evidence is Inspection/Analysis,
and never claim `Implemented` on Analysis alone for a behavioral requirement.

## Strong vs weak evidence

- ✅ `server/src/routes/skills.it.test.ts:88 — DELETE /skills/:id → 204` (Test)
- ✅ `client/src/features/skills/SkillPanel.tsx:42 — renders <DeleteButton> wired to useDeleteSkill` (Inspection)
- ❌ "the delete feature works" — not addressable
- ❌ "unit tests pass" — which test proves *this* requirement?
- ❌ "function `deleteSkill` exists" — present ≠ reachable ≠ tested

## Worked example

```
**Plan:** docs/plans/delete-a-skill.md  ·  **5 requirements** — 3 implemented · 1 partial · 1 missing

| #    | Requirement / AC                              | Status        | Evidence (file:line / test)                                   | Gap |
|------|-----------------------------------------------|---------------|---------------------------------------------------------------|-----|
| R-01 | DELETE /skills/:id removes the skill          | Implemented   | skills.it.test.ts:88 DELETE → 204; repo del at skills-repo.ts:51 (Test) | none |
| R-02 | Returns 404 for an unknown id                 | Implemented   | skills.it.test.ts:97 DELETE missing → 404 (Test)              | none |
| R-03 | UI delete button confirms before deleting     | Implemented   | SkillPanel.test.tsx:30 opens confirm dialog (Test)            | none |
| R-04 | Deletion is audit-logged                      | Partial       | logger.info call at skills.ts:60 (Inspection); no audit table write, no test | no persistent audit record; no test |
| R-05 | Bulk delete of multiple skills                | Missing       | grep finds no bulk/batch delete symbol (Analysis)            | not implemented |

**Verdict:** 2 GAPS 🔴 — R-04 (audit not persisted/tested), R-05 (bulk delete absent). R-01–R-03 met.
```

## Unrequested work (backward trace)

If you find code that no requirement asked for, list it under the matrix so scope
creep is visible — don't silently ignore it:

```
**Unrequested (no matching requirement):**
- `skills.ts:120` — export-to-CSV endpoint; not in the plan.
```
