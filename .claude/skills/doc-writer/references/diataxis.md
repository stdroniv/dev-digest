# Diátaxis, ADRs, and placement — reference

Read this when choosing a documentation mode, writing an ADR, or deciding whether a
diagram is worth it. Source framework: [Diátaxis](https://diataxis.fr/).

## The four modes (+ two structural docs)

Diátaxis splits docs by the reader's need. The two axes are *action vs cognition*
and *acquisition vs application*:

| Mode | Reader is… | Oriented to | Voice | Anti-pattern |
|------|-----------|-------------|-------|--------------|
| **Tutorial** | learning, a newcomer | learning | "we will…", you guide them to success | dumping options/edge cases |
| **How-to guide** | competent, has a goal | a task | imperative steps, no detours | explaining concepts mid-task |
| **Reference** | working, needs facts | information | terse, complete, consistent | narrative, opinions |
| **Explanation** | curious, wants the why | understanding | discursive, makes connections | step-by-step instructions |

Two repo-relevant structural docs sit alongside:

- **ADR** — a single architectural decision (a focused Explanation with a fixed shape).
- **Architecture doc** — the system's end-to-end shape (Explanation + a diagram or two).

## Decision tree

```
Is the reader recording/justifying a decision?      → ADR (docs/adr/NNNN-slug.md)
Is the reader trying to grasp the whole system?     → Architecture doc (docs/architecture.md)
Otherwise, what is the reader doing right now?
  Learning the ropes for the first time?            → Tutorial
  Trying to complete a specific task?                → How-to guide
  Looking a fact up while working?                   → Reference
  Trying to understand why / how it fits?            → Explanation
```

If a request needs more than one (e.g. "document the review pipeline" → an
Explanation of the flow + a How-to for running it), write each as its own doc/section
in a single mode and link them. One file can hold multiple modes only if each is a
**clearly separated section** — never blended sentence-to-sentence.

## ADR format (Nygard / MADR)

One decision per file, `docs/adr/<NNNN>-<slug>.md` (zero-padded number):

```markdown
# NNNN. <short decision title>

- Status: Proposed | Accepted | Deprecated | Superseded by ADR-NNNN
- Date: YYYY-MM-DD

## Context
<the forces at play — the problem, constraints, what made this a decision>

## Decision
<the choice, in active voice: "We will …">

## Consequences
<what becomes easier and harder as a result — both directions>

## Alternatives considered
<options weighed and why they lost>
```

Rules: never edit an **Accepted** ADR to change the decision — add a new ADR and set
the old one's status to `Superseded by ADR-NNNN`. Keep superseded ADRs; deleting
them destroys the record of why things are the way they are.

## Placement quick map (this repo)

| Documenting… | Path |
|--------------|------|
| Module internals / how to work in a package | `<module>/README.md` or `<module>/CLAUDE.md` |
| Cross-module topic | `docs/<slug>.md` |
| One architectural decision | `docs/adr/<NNNN>-<slug>.md` |
| End-to-end system shape | `docs/architecture.md` (extend) |
| Reviewer-agent prompt docs | `docs/agent-prompts/` |
| Project front door | root `README.md` |

Filenames lowercase-hyphenated. Always link a new doc from its nearest index.

## When a diagram beats prose

Draw one when the answer is **topological** and a reader would otherwise spend real
effort reconstructing it in their head. Don't draw what's obvious from the code.

| Question shape | Diagram (Mermaid) |
|----------------|-------------------|
| "What talks to what?" (system/containers) | `flowchart` (C4 Context/Container level) |
| "What happens in what order?" (a flow) | `sequenceDiagram` |
| "How is the data shaped/related?" | `erDiagram` |
| "What states can this be in?" | `stateDiagram-v2` |

One abstraction level per diagram. High-level diagrams age well; code-level diagrams
rot within a sprint — prefer the former and let code be its own low-level doc. Author
diagrams via the `mermaid-diagram` skill.

## Style checklist

- Audience named in the opening line.
- Active voice; imperative for instructions.
- One idea per sentence; split past ~25 words.
- Link to code/generated artifacts rather than copying them (copies go stale).
- Explain the non-obvious (the why, the gotchas) — not what the code already says.

## Worked mode examples (same feature, different modes)

- **Tutorial:** "Build your first review" — walk a newcomer from importing a repo to
  reading findings, every command spelled out, guaranteed to work.
- **How-to:** "Re-run a review against a different model" — assumes familiarity;
  just the steps.
- **Reference:** "Review API" — endpoints, params, response shapes, status codes.
- **Explanation:** "How grounding works" — why findings cite code, the design
  rationale, the trade-offs.
