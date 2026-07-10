import type * as t from './schema.js';

/**
 * L02 demo skills + agent→skill links used by the seed.
 *
 * Skills are markdown rule blocks stored in the DB and injected into a reviewing
 * agent's prompt (ordered, enabled-only). These mirror the cards shown in the
 * Skills Lab design. `phantom-api-gate` is seeded as an IMPORTED, untrusted skill
 * (disabled until vetted) so the import → preview → vet flow is represented.
 *
 * The DB row is the source of truth at run time; editing a body here only affects
 * freshly seeded workspaces.
 */

/** A demo skill minus `workspaceId` (the seed injects the default workspace). */
type SeedSkill = Omit<typeof t.skills.$inferInsert, 'workspaceId'>;

export const DEMO_SKILLS: SeedSkill[] = [
  {
    name: 'pr-quality-rubric',
    description: 'Rubric for evaluating overall PR quality across correctness, tests, and clarity.',
    type: 'rubric',
    source: 'manual',
    enabled: true,
    body: `# PR Quality Rubric

Evaluate the pull request against the following dimensions. For each, return a
finding only when the issue is **worth the author's time** — aim for 5 high-signal
findings, not 50.

## Correctness
- Does the change do what the PR description claims?
- Are edge cases (empty input, nulls, concurrency) handled?

## Security
- Any secrets, tokens, or credentials in the diff?
- Untrusted input reaching a sink (SQL, shell, fetch)?

## Tests
- New branches covered by assertions?
- Are tests meaningful (not just snapshot churn)?

## Scope
- Does the diff stay within the stated intent?
- Flag out-of-scope changes separately rather than blocking.`,
  },
  {
    name: 'no-then-chains',
    description: 'House rule: always use async/await instead of .then() promise chains.',
    type: 'convention',
    source: 'extracted',
    enabled: true,
    body: `# Convention — no .then() chains

Our codebase standard is \`async/await\`, never \`.then()/.catch()\` chains.

Flag as a finding when the diff introduces:
- A \`.then(...)\` or \`.catch(...)\` chain on a promise that could be awaited.
- \`Promise.then\` used for control flow inside an \`async\` function.

Do NOT flag \`Promise.all([...])\`, \`.finally()\` for cleanup, or \`.catch()\` attached
to a fire-and-forget background task that is intentionally not awaited.`,
  },
  {
    name: 'secret-leakage-gate',
    description: 'Detects sk_live_, service_role, and NEXT_PUBLIC secrets committed in a diff.',
    type: 'security',
    source: 'community',
    enabled: true,
    body: `# Secret Leakage Gate

Treat any of the following appearing in the diff as a CRITICAL security finding:
- Stripe live keys: \`sk_live_\`, \`rk_live_\`.
- Supabase / Postgres \`service_role\` keys or connection strings with a password.
- A \`NEXT_PUBLIC_*\` variable holding a value that is actually a secret (a public
  prefix does not make a secret safe).
- Private keys (\`-----BEGIN ... PRIVATE KEY-----\`), AWS \`AKIA...\` access keys.

Require the secret be moved to an env var / secret store AND rotated. A secret in
git history is compromised even if removed in a later commit.`,
  },
  {
    name: 'lethal-trifecta',
    description: 'Flags PRs combining private data access, untrusted input, and an exfiltration path.',
    type: 'security',
    source: 'community',
    enabled: true,
    body: `# Lethal Trifecta Guard

Raise a finding when a single flow combines ALL THREE of:
1. **Untrusted input** an agent/LLM ingests (PR body, web page, file, tool output).
2. **Private data** access in the same flow (secrets, other users' data, internal APIs).
3. **An exfiltration path** (outbound HTTP, a tool call, attacker-readable output).

Name a concrete file:line for each of the three components. A normal authenticated
endpoint of the shape \`param → DB read → JSON response\` is ordinary access control,
NOT a trifecta — do not flag it.`,
  },
  {
    name: 'phantom-api-gate',
    description: 'Detects imports of functions/modules that do not exist in the codebase or deps.',
    type: 'security',
    // Imported from an untrusted source → seeded DISABLED until a human vets it.
    source: 'imported_url',
    enabled: false,
    body: `# Phantom API Gate

Flag when the diff imports or calls a function, module, or method that does not
appear to exist in the project's dependencies or source — a hallucinated API.

Signals:
- An import from a package not present in \`package.json\`.
- A method call on a known library that isn't part of its public API.
- A helper referenced but never defined or exported in the diff.

> Imported from a community source. Review the body before enabling — a foreign
> skill is foreign instructions in your agent's prompt.`,
  },
  {
    name: 'test-coverage-nudge',
    description: 'Suggests tests when new branches lack assertions or only cover the happy path.',
    type: 'custom',
    source: 'manual',
    enabled: true,
    body: `# Test Coverage Nudge

When the diff adds or changes non-test code, check that its new behaviour is tested:
- Every new \`if\`/\`else\`, \`switch\` arm, \`try/catch\`, and early-return guard should have
  at least one test input that reaches it.
- A function with an error path tested only for success is a gap — flag the
  uncovered failure branch and the input that triggers it.
- A happy-path-only test for code with a meaningful boundary (empty list, null,
  limit edge) is incomplete — name the missing corner case.

Do not demand tests for trivial getters or chase 100% coverage as a goal in itself.`,
  },
  {
    name: 'api-contract-guard',
    description: 'Catches breaking changes to route params, request bodies, and response shapes.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: `# API Contract Guard

Flag a CRITICAL finding when the diff makes a backward-incompatible change to an
existing HTTP endpoint that a current client depends on:
- A route path, method, or \`:param\` renamed, retyped, or removed.
- A request field made required, renamed, removed, or retyped (Zod schema tightened).
- A response field renamed, removed, retyped, or its nullability flipped.
- A status code changed for the same logical outcome (e.g. 200 → 204).

Additive changes (a new optional field, a brand-new route) are NOT breaking — do not
flag them. Internal refactors that leave the wire shape identical are NOT breaking.`,
  },
  // ---- API Contract Reviewer's four granular skills (docs/agent-prompts/skills/*).
  // Bodies mirror those docs verbatim; each is directive with a good/bad example so
  // the model has a concrete decision boundary. Seeded ENABLED so their eval cases
  // (`seed-evals-skills.ts`) can actually run (a disabled skill's body never reaches
  // the LLM, incl. the eval run path). Keep the two in sync when you edit a prompt.
  {
    name: 'breaking-change',
    description: 'Flags backward-incompatible changes to a public HTTP contract an existing client depends on.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: `# breaking-change

Flag any change that removes or alters a part of a PUBLIC HTTP contract an existing
client already depends on. A break is anything that makes a request that worked
before this PR now fail, or makes a response the client parsed before now parse
differently. Cite the exact \`file:line\` and name the field/param/route that breaks.

A change is breaking when it does ANY of these to an EXISTING route:
- removes or renames a route path, method, or \`:param\`;
- removes, renames, or retypes a request or response field;
- makes a previously-optional request field required, or adds a new required field;
- narrows an enum, tightens validation, or flips a field's nullability;
- changes the status code a client branches on for the same logical outcome.

Purely ADDITIVE changes are NOT breaking: a new optional request field, a new
response field, a brand-new route, or an internal refactor that leaves the wire
shape byte-identical. Do not flag those.

## Bad — silently breaks every caller
\`\`\`ts
// route: GET /users/:id  — response field renamed
- return { id: user.id, fullName: user.fullName };
+ return { id: user.id, name: user.fullName };   // clients reading \`fullName\` now get undefined
\`\`\`
\`\`\`ts
// request body — a new REQUIRED field rejects every old client
const Body = z.object({
  email: z.string(),
+ tenantId: z.string(),        // old clients omit it → 422
});
\`\`\`

## Good — additive, backward-compatible
\`\`\`ts
// new field is OPTIONAL → old clients keep working
const Body = z.object({
  email: z.string(),
+ tenantId: z.string().optional(),
});
\`\`\`
\`\`\`ts
// keep the old field, add the new one alongside it
return { id: user.id, fullName: user.fullName, name: user.fullName };
\`\`\`

When you find a break, report it as **CRITICAL** and state the concrete caller
request that would now fail.`,
  },
  {
    name: 'response-schema',
    description: 'Watches the SHAPE of responses — nullability flips, envelope/pagination changes, retypes.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: `# response-schema

Watch the SHAPE of responses specifically — the part clients deserialize. Compare the
before/after of every changed response schema or returned object literal in the diff.
A response break is invisible to the server's own tests but breaks the client's
parsing or rendering. Cite the exact \`file:line\`.

Treat each of these as a response-shape break on an existing route:
- a field removed or renamed (the client reads \`undefined\`);
- a field retyped (\`string\` → \`number\`, object → array, scalar → object);
- a required field made optional/nullable, or a nullable field made required;
- the envelope or pagination shape changed (\`{ items, nextCursor }\` →
  \`{ data, page }\`), or a bare array wrapped/unwrapped;
- a date/number serialization format changed (ISO string → epoch millis).

Adding a NEW optional field to a response is NOT a break — skip it.

## Bad — nullability flip + envelope change
\`\`\`ts
// was: { items: Item[]; nextCursor: string | null }
- return { items, nextCursor };
+ return { data: items, page: { next } };   // client reads \`items\`/\`nextCursor\` → both gone
\`\`\`
\`\`\`ts
// field was always present; now sometimes omitted → client must handle undefined
- return { id, email, verifiedAt };
+ return { id, email, ...(verifiedAt ? { verifiedAt } : {}) };
\`\`\`

## Good — stable shape, additive only
\`\`\`ts
return { items, nextCursor, totalCount };   // new field added, old keys untouched
\`\`\`

Report a confirmed response-shape break as **CRITICAL**; a soft change with a
plausible client migration as **WARNING**. Name the exact field and how the client
parses it today.`,
  },
  {
    name: 'semver-discipline',
    description: 'Flags a breaking change shipped in-place on a versioned path instead of a new version.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: `# semver-discipline

Map each contract change to the version bump it demands, and flag when a breaking
change ships WITHOUT the major bump (or new versioned path) that should carry it.
This is the policy layer on top of \`breaking-change\`: a break is only safe when it
rides a new version, not the existing one.

Rules:
- A backward-INCOMPATIBLE change to an existing versioned path (\`/v1/...\`) requires a
  NEW path (\`/v2/...\`) — the \`/v1\` shape must keep working. Mutating \`/v1\` in place is
  the violation.
- A package/library that exports the changed contract must get a MAJOR bump in
  \`package.json\` when the export changes incompatibly; a MINOR bump for additive-only.
- Additive changes (new optional field, new route, new enum member that clients can
  ignore) are MINOR — do not demand a major bump for them.

## Bad — breaking change mutates the existing version
\`\`\`ts
// /v1/orders previously returned \`total: number\`; this retypes it in place
- app.get('/v1/orders/:id', () => ({ total: cents }));
+ app.get('/v1/orders/:id', () => ({ total: { amount: cents, currency } }));  // /v1 contract broken
\`\`\`
\`\`\`jsonc
// package.json — exported response type changed incompatibly but only a patch bump
- "version": "2.4.1",
+ "version": "2.4.2",     // should be 3.0.0
\`\`\`

## Good — break carried on a new version, old one preserved
\`\`\`ts
app.get('/v1/orders/:id', () => ({ total: cents }));            // unchanged
app.get('/v2/orders/:id', () => ({ total: { amount, currency } })); // new shape on /v2
\`\`\`

Flag an in-place break on a versioned path as **CRITICAL**, and a missing/incorrect
version bump as **WARNING**. Name the path or package and the bump it needs.`,
  },
  {
    name: 'deprecation-policy',
    description: 'Flags silent removal of a still-public surface instead of soft-deprecating it.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    body: `# deprecation-policy

Prefer SOFT deprecation over silent removal. When a PR deletes a field, param, route,
or enum value that clients may still use, the change should instead mark it deprecated
and keep returning/accepting it for a migration window. Flag silent removals and
point at the soft-deprecation path.

What good deprecation looks like:
- the old field/route keeps working (still returned / still accepted) during the
  window;
- it is annotated as deprecated — a \`@deprecated\` JSDoc tag, an \`x-deprecated\` schema
  marker, a \`Deprecation\` / \`Sunset\` response header, or a doc note — so callers are
  warned BEFORE it disappears;
- a replacement is offered alongside it; removal happens in a LATER, clearly-versioned
  release, not the same PR that introduces the replacement.

A removal is acceptable without a window ONLY if the surface was never public
(internal route, unreleased feature, or a field added earlier in the same unreleased
version).

## Bad — silent hard removal
\`\`\`ts
// field clients still read, deleted outright with no warning
- return { id, email, legacyToken };
+ return { id, email };
\`\`\`
\`\`\`ts
// route deleted in the same PR that adds its replacement
- app.get('/users/:id/profile', getProfile);   // callers 404 immediately
+ app.get('/users/:id/card', getCard);
\`\`\`

## Good — deprecate, keep, then remove later
\`\`\`ts
/** @deprecated use \`email\`; removed in v3. Still returned through v2.x. */
return { id, email, legacyToken };             // kept during the window
\`\`\`
\`\`\`ts
reply.header('Deprecation', 'true');
reply.header('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT');
return getProfile();                            // old route still served, marked sunset
\`\`\`

Flag a silent removal of a still-public surface as **CRITICAL** (it is also a
\`breaking-change\`); flag a removal that is missing only the deprecation annotation as
**WARNING**.`,
  },
];

/**
 * agent name → ordered skill names. The order here becomes `agent_skills.order`,
 * which drives the order of skill blocks in the assembled prompt.
 */
export const AGENT_SKILL_LINKS: Record<string, string[]> = {
  // `pr-quality-rubric` is shared across three reviewers so the Skills → Stats tab
  // has a "used by 3 agents" demo (mirrors the design mockup).
  'General Reviewer': ['pr-quality-rubric'],
  'Security Reviewer': ['secret-leakage-gate', 'lethal-trifecta'],
  'Performance Reviewer': ['pr-quality-rubric', 'no-then-chains'],
  'Test Quality Reviewer': ['test-coverage-nudge', 'pr-quality-rubric'],
  'API Contract Reviewer': ['api-contract-guard'],
};

/**
 * Demo data for the Skills → Stats tab. The base seed only attributes PR #482's
 * review to the Security Reviewer (which does NOT use `pr-quality-rubric`), so
 * that skill would otherwise show all-zero stats. This adds a second demo PR
 * whose reviews are attributed to the rubric's agents, with categorized findings
 * in a realistic accepted/dismissed mix — giving non-zero pull frequency, accept
 * rate, findings count, and a category breakdown. Kept on its OWN PR so PR #482
 * (asserted by existing tests + e2e flows) is left untouched.
 */
export interface StatsDemoFinding {
  category: string;
  severity: string;
  /** 'accepted' or 'dismissed' — every demo finding is decided for a clean accept rate. */
  decision: 'accepted' | 'dismissed';
}

export interface StatsDemoReview {
  /** Agent (by name) the review is attributed to. */
  agent: string;
  findings: StatsDemoFinding[];
}

/**
 * Reviews for the stats-demo PR. The three `pr-quality-rubric` agents carry
 * categorized findings; Security + API Contract reviews (which don't use the
 * rubric) pad the pull-frequency denominator so it lands below 100%.
 *
 * Rubric totals: 15 findings across bug/perf/style/security/test, 11 accepted →
 * ~73% accept rate, used by 3 agents.
 */
export const STATS_DEMO_REVIEWS: StatsDemoReview[] = [
  {
    agent: 'Performance Reviewer',
    findings: [
      { category: 'perf', severity: 'WARNING', decision: 'accepted' },
      { category: 'perf', severity: 'WARNING', decision: 'accepted' },
      { category: 'bug', severity: 'WARNING', decision: 'accepted' },
      { category: 'bug', severity: 'SUGGESTION', decision: 'dismissed' },
      { category: 'style', severity: 'SUGGESTION', decision: 'accepted' },
      { category: 'security', severity: 'CRITICAL', decision: 'dismissed' },
    ],
  },
  {
    agent: 'General Reviewer',
    findings: [
      { category: 'bug', severity: 'WARNING', decision: 'accepted' },
      { category: 'bug', severity: 'WARNING', decision: 'accepted' },
      { category: 'style', severity: 'SUGGESTION', decision: 'accepted' },
      { category: 'style', severity: 'SUGGESTION', decision: 'dismissed' },
      { category: 'security', severity: 'CRITICAL', decision: 'accepted' },
      { category: 'perf', severity: 'WARNING', decision: 'accepted' },
    ],
  },
  {
    agent: 'Test Quality Reviewer',
    findings: [
      { category: 'bug', severity: 'WARNING', decision: 'accepted' },
      { category: 'style', severity: 'SUGGESTION', decision: 'dismissed' },
      { category: 'test', severity: 'SUGGESTION', decision: 'accepted' },
    ],
  },
  // Denominator padding — these agents do NOT use pr-quality-rubric.
  {
    agent: 'Security Reviewer',
    findings: [{ category: 'security', severity: 'CRITICAL', decision: 'accepted' }],
  },
  {
    agent: 'API Contract Reviewer',
    findings: [{ category: 'bug', severity: 'WARNING', decision: 'dismissed' }],
  },
];
