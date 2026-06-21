# Severity rubric & finding format

Severities and the gate match the repo's own model — keep them identical so a self-review
is comparable to a DevDigest product review.

- Enum: `server/src/vendor/shared/contracts/findings.ts` → `CRITICAL | WARNING | SUGGESTION`.
- Ranks/gate: `reviewer-core/src/output/to-review.ts` → `SEV_RANK { SUGGESTION:1, WARNING:2, CRITICAL:3 }`,
  `FAIL_ON_MIN_RANK.critical = 3`. **Only CRITICAL trips the gate.**

## What each severity means

### 🔴 CRITICAL (rank 3 — blocks the push)
A defect that is unsafe to ship. The bar is "would a reviewer request changes?". Examples:
- Security: leaked secret/key/token, SQL/command injection, missing authz on a mutating
  route, the lethal trifecta (private-data access + untrusted input + exfil path), unsafe
  `dangerouslySetInnerHTML` on user input.
- Correctness: a bug that breaks the feature, data loss/corruption, a crash on a normal path.
- Architecture rule **violations** that the skills mark as forbidden: inner→outer import in
  the onion layers, DB/HTTP/FS imported into `reviewer-core`, a Fastify handler hand-rolling
  `Schema.parse(req.body)` instead of schema-first validation.

### 🟡 WARNING (rank 2 — does not block, fix soon)
A real problem that isn't release-blocking: missing error handling on an edge path, an N+1
query, a misused hook/effect, a missing `await`, a type hole (`any`) that weakens safety,
test gaps on new logic.

### 🔵 SUGGESTION (rank 1 — optional polish)
Style/clarity/maintainability: naming, placement nits, minor simplifications, doc gaps.

## When unsure

Down-rank rather than over-block: only call something CRITICAL when you can name the
concrete harm and cite the skill rule it breaks. A self-review that cries CRITICAL on style
trains people to `--no-verify`. Be precise.

## Finding format (one per issue)

Render findings as a markdown list matching the product's `composeBody`:

```
**<total> findings** · <c> critical · <w> warning · <s> suggestion

- 🔴 **<title>** (critical, <category>) — `path/to/file.ts:120-128`
  - <rationale — why it's wrong; cite the skill rule, e.g. "backend-onion-architecture: inner→outer import">
  - _Suggestion:_ <the fix>
- 🟡 **<title>** (warning, perf) — `path/to/file.ts:44`
  - <rationale>
```

`category` ∈ `bug | security | perf | style | test`. Ground every finding on a changed
line; drop anything you can't anchor to the diff.
