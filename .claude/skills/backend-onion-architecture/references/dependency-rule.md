# The Dependency Rule + mechanical enforcement

> **Source-code dependencies point only inward. An inner layer never imports an outer layer.**

Everything else in this skill is a consequence of that one rule. Review alone won't hold it —
enforce it mechanically with `dependency-cruiser`, which is **already a `server/` dependency**
(`dependency-cruiser@17.4.3`, used today for the repo-intel import graph).

## Layer order (outer → inner)

`presentation` → `infrastructure` → `application` → `domain`. Legal imports follow the arrows;
anything pointing back outward is a violation. The same rule makes `reviewer-core` (a pure inner
core) forbidden from importing `server`, a DB client, or any HTTP/FS module.

## Copy-paste config

Save as `server/.dependency-cruiser.cjs`. It encodes the rule against both the **target onion
folders** (`src/domain`, `src/application`, `src/infrastructure`, `src/presentation`) and the
**current module convention** (`routes.ts` / `service.ts` / `repository.ts`), so it is useful
before and after the migration.

```js
// server/.dependency-cruiser.cjs
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-stays-pure',
      comment: 'Domain core must not import outer layers, frameworks, ORMs, or SDKs.',
      severity: 'error',
      from: { path: '^src/(domain)/' },
      to: {
        path: [
          '^src/(application|infrastructure|presentation|adapters|db|modules)/',
          'node_modules/(drizzle-orm|fastify|zod|openai|@anthropic-ai|postgres)/',
        ],
      },
    },
    {
      name: 'application-no-framework-or-orm',
      comment: 'Use-cases depend on domain ports only — no Fastify, Drizzle, or DB client.',
      severity: 'error',
      from: { path: '^src/(application)/' },
      to: {
        path: [
          '^src/(infrastructure|presentation|adapters|db)/',
          'node_modules/(drizzle-orm|fastify|postgres)/',
        ],
      },
    },
    {
      name: 'handlers-never-touch-the-db',
      comment: 'Presentation/route handlers must go through a service, never query directly.',
      severity: 'error',
      from: { path: '(^src/presentation/|/routes\\.ts$)' },
      to: { path: ['^src/db/', 'node_modules/(drizzle-orm|postgres)/'] },
    },
    {
      name: 'services-no-fastify-or-drizzle',
      comment: 'Module services (application layer) must not import transport or ORM directly.',
      severity: 'error',
      from: { path: '/service\\.ts$' },
      to: { path: ['node_modules/(fastify|drizzle-orm)/'] },
    },
    {
      name: 'no-circular',
      comment: 'Circular dependencies break the layering.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
```

For `reviewer-core` purity, add this rule to **`reviewer-core/.dependency-cruiser.cjs`** (or a
shared root config that also scans it):

```js
{
  name: 'reviewer-core-is-pure',
  comment: 'The pure engine must not depend on server, a DB/HTTP/FS client, or Fastify.',
  severity: 'error',
  from: { path: '^src/' },
  to: {
    path: [
      'node_modules/(drizzle-orm|postgres|fastify|simple-git|octokit|fs|node:fs)/',
      '/server/',
    ],
  },
}
```

## Run it

```sh
cd server
pnpm exec depcruise --config .dependency-cruiser.cjs src        # text report; exit ≠ 0 on violation

cd ../reviewer-core
pnpm exec depcruise --config .dependency-cruiser.cjs src
```

Wire it into the package's check step (e.g. alongside `pnpm typecheck`) so CI fails on any
inner→outer import. Running it on **existing** code will surface today's violations — that is the
point; treat the first run as the migration backlog (see
[migration-from-current.md](migration-from-current.md)), not a blocker to adopting the rule.

## Note on path patterns

`dependency-cruiser` matches on file paths, so the rules above key off folder names
(`src/domain/…`) and the project's file-suffix convention (`routes.ts`, `service.ts`). If you
introduce the onion folders, keep the suffix rules too — together they catch both "wrong folder"
and "wrong import inside the right folder".
