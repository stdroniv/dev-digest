# specs (cross-cutting)

Agreed **specifications** — the WHAT and WHY of a feature, before any implementation
planning. Design specs for work that spans more than one package (e.g. a new course
lesson's feature): the problem, the intended behaviour, and the contract changes.
Module-local specs go in `<module>/specs/`.

Canonical *current* behavior is the root [`README.md`](../README.md) and
[`docs/architecture.md`](../docs/architecture.md); specs here describe *intended* or
*in-progress* change, not the shipped system.

## Authoring

Specs are written by the [`spec-creator`](../.claude/agents/spec-creator.md) agent
(`opus`). One file per feature, named `SPEC-NN-<YYYY-MM-DD>-<kebab-slug>.md` — a
zero-padded, monotonically increasing Spec ID, the authoring date, then a short slug. The
Spec ID and filename stay stable across revisions; `spec-creator` edits a spec in place
rather than forking a new ID.

## What a spec is / isn't

- **Is:** problem & why, goals/non-goals, user stories, testable **EARS** acceptance
  criteria, edge cases, cross-module hand-offs (as behaviour), input provenance, and
  untrusted-input handling.
- **Isn't:** file paths, frameworks, DB schema, function/type signatures, API route
  shapes, or a task breakdown — that is the
  [`implementation-plan`](../.claude/agents/implementation-plan.md) agent's job, and its
  output lives in [`docs/plans/`](../docs/plans/).

Pipeline: `spec-creator` → `implementation-plan` → `implementer`. See
[`.claude/agents/README.md`](../.claude/agents/README.md).
