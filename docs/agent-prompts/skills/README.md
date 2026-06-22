# Reusable review skills

Markdown skill bodies that attach to a reviewing agent (Skills tab → linked via
`agent_skills`). Each skill's body is injected verbatim into the agent's prompt under
`## Skills / rules` at review time (`reviews/run-executor.ts` → `reviewer-core`
`assemblePrompt`). When no skills are linked, that section is omitted and the prompt is
byte-identical to the no-skills baseline — which is what makes the A/B experiment below
clean.

## API Contract Reviewer skills

Pair these four with the `api-contract-reviewer.md` agent prompt:

| Skill | Catches |
|-------|---------|
| `breaking-change.md` | removed/renamed/retyped public field, param, or route; newly-required request field |
| `response-schema.md` | response-shape changes — nullability flips, envelope/pagination changes, retypes |
| `semver-discipline.md` | a breaking change shipped in-place on a versioned path instead of a new version |
| `deprecation-policy.md` | silent removal of a still-public surface instead of soft-deprecating it |

Each is directive and carries a **good/bad** example so the model has a concrete
decision boundary, not just a label.

## How to load them (one via import)

1. **Create** `breaking-change`, `response-schema`, `semver-discipline` in the Skills UI
   (type `convention`), pasting each file's body.
2. **Import** `deprecation-policy.md` through the Skills "Import" drawer
   (`POST /skills/import` → preview → confirm) to exercise the `source='imported_url'`
   path. Imported skills land disabled — enable it after a quick read.
3. **Link** all four to the API Contract Reviewer agent (Agents → Skills tab).

See `../../conventions-extractor.md` for the end-to-end experiment + demo script.
