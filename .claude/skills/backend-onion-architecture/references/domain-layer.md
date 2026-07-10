# Domain layer (the core)

The innermost layer. It models **what the business is** — independent of how it is stored, served,
or called. It is the only layer with *zero* outward dependencies.

In DevDigest, `reviewer-core/src/*` is the living exemplar: pure TypeScript, side effects only
through an injected `LLMProvider`. New `server/` domain types follow the same purity rule.

## What lives here

- **Entities** — objects with identity and a lifecycle (`Review`, `Finding`, `Repo`). They carry
  behavior and enforce their own invariants.
- **Value objects** — immutable, identity-less concepts compared by value (`Severity`,
  `RepoSlug`, `CommitSha`). Construction validates; an instance is always valid.
- **Domain services** — stateless operations that span multiple entities and don't naturally
  belong to one (e.g. grounding/severity-rollup rules).
- **Repository interfaces (ports)** — the *contract* for persistence (`IReviewRepository`). The
  interface is owned by the domain; the **implementation lives in infrastructure**. This is the
  inversion that keeps the domain ignorant of Drizzle.

## Hard rules

- **No framework / IO imports.** A domain file must never import `drizzle-orm`, `fastify`, `zod`,
  `openai`, `@anthropic-ai/sdk`, `../db`, or any adapter. If you reach for one, the logic belongs
  in an outer layer.
- **Rich, not anemic.** Put invariants *inside* the entity, not in a separate validator service.
  An entity that is only public fields with logic elsewhere is the [anemic domain model
  anti-pattern](https://en.wikipedia.org/wiki/Anemic_domain_model).
- **Validate at construction.** A constructed entity/value-object is always in a valid state;
  throw on invalid input rather than letting callers create broken objects.
- **No Zod here.** Zod validates *external* input at the boundary. The domain expresses invariants
  in plain TypeScript so it has no dependency on a validation library.

## Rich entity (good)

```typescript
// domain/review/finding.ts
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
const SEVERITIES: readonly Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

export class Finding {
  constructor(
    readonly id: string,
    readonly path: string,
    readonly line: number,
    readonly severity: Severity,
    readonly message: string,
  ) {
    if (!path) throw new Error('Finding.path is required');
    if (line < 1) throw new Error('Finding.line must be 1-based');
    if (!message.trim()) throw new Error('Finding.message is required');
  }

  /** Business rule lives WITH the data, not in a service. */
  isBlocker(): boolean {
    return SEVERITIES.indexOf(this.severity) >= SEVERITIES.indexOf('high');
  }
}
```

## Repository interface = a domain-owned port (good)

```typescript
// domain/review/review.repository.ts
import type { Review } from './review.js';

export interface IReviewRepository {
  findById(id: string): Promise<Review | null>;
  save(review: Review): Promise<void>;
}
```

The domain depends only on this interface. `DrizzleReviewRepository` (infrastructure) implements
it — see [infrastructure-layer.md](infrastructure-layer.md). This means the domain (and its unit
tests) never touch a database.

## Anti-patterns to reject

- Importing the DB client or Drizzle schema into a domain file (see BAD example #2 in
  [examples.md](../examples.md)).
- **Defining a domain entity/type as an alias of a Drizzle row** — `InferSelectModel<typeof table>`
  or `typeof table.$inferSelect` — *even as a `import type`*. This is the quietest form of the same
  leak: the DB shape becomes the domain shape, so a column rename or a `NOT NULL` change silently
  rewrites your domain type, and nothing ever maps rows to a stable entity. The `import type` is
  erased at compile time so `depcruise` may not flag it — but the coupling is real. Declare a
  standalone domain type (plain `interface`/`class`, no `db/schema` import) and let the repository
  `toDomain()`-map onto it. See BAD example #2 in [examples.md](../examples.md).
- A `*ValidationService` that holds rules an entity should own (anemic domain).
- A value object whose constructor accepts already-invalid state and is "validated later".
- Putting a Zod schema on a domain type — that couples the core to a boundary library.
