---
name: doc-writer
description: "Produce well-structured technical documentation from code, plans, or raw notes — and put it in the right place. Use this whenever the user wants to 'document this', 'write docs for…', 'turn this plan into a doc', 'explain how X works in the docs', 'create an ADR / architecture doc', 'write a README for this module', or hands over an implementation plan, a feature, or rough notes to be turned into a document (optionally with diagrams). It picks the correct documentation TYPE (tutorial / how-to / reference / explanation / ADR) via the Diátaxis framework, picks the correct LOCATION (docs/, module README/CLAUDE.md, docs/adr/), writes in a clean docs-as-code style, and adds Mermaid diagrams where a picture genuinely beats prose. Use it even when the user just says 'write this up' or 'make documentation' without naming a type or location — choosing those correctly is the main value."
allowed-tools: Read, Grep, Glob, Write, Edit, Skill
metadata:
  version: 1.0.0
  tags: documentation, docs-as-code, diataxis, adr, readme, architecture-doc, mermaid, technical-writing
  updated: 2026-06-24
---

# Doc Writer

Turn code, plans, or notes into documentation that lands in the right place, in the
right form. Most documentation fails for one of two reasons: it mixes purposes (a
tutorial clogged with reference tables nobody can follow), or it lives where no one
finds it. This skill exists to get **type** and **location** right first, then write.

## Procedure

### 1. Identify the input and pick the documentation TYPE (Diátaxis)

First name what you were handed: **existing code/feature**, **an implementation
plan** (e.g. `docs/plans/<slug>.md`), or **raw notes**. Then choose the mode by
asking *what is the reader trying to do at the moment they open this?*

| Reader's need | Mode | Produce |
|---------------|------|---------|
| Learn by doing (newcomer) | **Tutorial** | a guided, working outcome |
| Accomplish a specific task | **How-to guide** | steps to the goal, no digressions |
| Look something up while working | **Reference** | accurate, complete, scannable facts |
| Understand *why* (concepts, rationale) | **Explanation** | a mental model |
| Record an architectural decision | **ADR** | context · decision · consequences |
| Describe a system's shape end-to-end | **Architecture doc** | the topology + how parts interact |

Keep each document (or clearly-delimited section) in **one** mode. Mixing modes is
the most common documentation failure — a how-to with conceptual asides slows the
practitioner; a tutorial with reference tangents breaks the learning arc. If the
request spans modes, write separate docs and link them.

Read `references/diataxis.md` for the decision tree, the ADR format, and worked
examples of each mode.

### 2. Pick the LOCATION (this repo's conventions)

You may write across `docs/` and module docs. Choose by scope:

| What you're documenting | Where it goes |
|-------------------------|---------------|
| One module's internals / how to work in it | `<module>/README.md` or `<module>/CLAUDE.md` |
| Something cross-module | `docs/<slug>.md` |
| An architectural decision | `docs/adr/<NNNN>-<slug>.md` (create `docs/adr/` if absent) |
| End-to-end system shape | `docs/architecture.md` (extend it) |
| API surface | prefer generating from the Zod contracts; hand-write only the supplement |
| Project front door | root `README.md` |

Filenames are **lowercase-hyphenated** (`getting-started.md`, `0003-use-pgvector.md`).
Co-location rule: a doc about one module lives *in* that module; a doc that cuts
across modules lives in `docs/`.

### 3. Ground it in the source

Read the code, plan, or notes you're documenting before writing. Cite real symbols
and paths. **Link to code and generated artifacts instead of duplicating them** —
duplicated content is the content that goes stale first. If you state how something
behaves, make sure the code actually does that.

### 4. Write it (docs-as-code style)

- **Audience first** — state who the doc is for in the opening line; pitch the
  vocabulary to them.
- **Active voice, imperative instructions** — "Run `pnpm db:migrate`", not "the
  migration should be run".
- **One idea per sentence**; split anything past ~25 words.
- **Don't restate the code** — explain what isn't obvious from reading it (the why,
  the gotchas, the flow), which is exactly what the repo's `INSIGHTS.md` ethos values.
- Plain Markdown; it's versioned and reviewed like code.

### 5. Add diagrams only where they earn their place

A diagram beats prose when the question is **topological** (who calls what, what
lives where, what happens in what order) and a reader would otherwise spend real
time reconstructing it. Skip diagrams for things obvious from the code.

When you do diagram, **invoke the `mermaid-diagram` skill** and keep to **one
abstraction level per diagram**:

| Need | Diagram |
|------|---------|
| System / container topology | C4-style `flowchart` (Context or Container level) |
| Request / inter-service flow | `sequenceDiagram` |
| Data model / DB schema | `erDiagram` |
| State machine / decision logic | `stateDiagram` / flowchart |

High-level diagrams age well; code-level diagrams rot fast — prefer the former.

### 6. Write the file and link it

Write to the chosen path. Add a link from the nearest index (the parent `README.md`,
`docs/`’s index, or the relevant `CLAUDE.md` "Read when…" table) so the doc is
discoverable — an unlinked doc is an unfindable doc.

### 7. Report

State what you wrote, where, and which Diátaxis mode you chose and why — so the
choice is reviewable.

## Boundaries

- **Don't write `INSIGHTS.md`.** Hard-won engineering lessons go through the
  `engineering-insights` skill, which targets the right module and section. Defer to
  it rather than duplicating its job.
- **Never edit an Accepted ADR** — supersede it with a new numbered ADR and link the
  two. Keep superseded ADRs (institutional memory).
- **Never touch `*/src/vendor/**`** (generated) or existing migrations.
- Don't invent behavior to fill a doc — if the source is unclear, say so and ask,
  rather than documenting a guess.
