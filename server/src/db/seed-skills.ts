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
];

/**
 * agent name → ordered skill names. The order here becomes `agent_skills.order`,
 * which drives the order of skill blocks in the assembled prompt.
 */
export const AGENT_SKILL_LINKS: Record<string, string[]> = {
  'Security Reviewer': ['secret-leakage-gate', 'lethal-trifecta'],
  'Performance Reviewer': ['pr-quality-rubric', 'no-then-chains'],
  'Test Quality Reviewer': ['test-coverage-nudge', 'pr-quality-rubric'],
  'API Contract Reviewer': ['api-contract-guard'],
};
