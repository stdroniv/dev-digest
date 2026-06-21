# Infrastructure layer (adapters & persistence)

The outer ring that talks to the real world: databases, external HTTP APIs, the filesystem, LLMs.
It **implements the ports** declared by inner layers. In DevDigest this is
`server/src/modules/*/repository.ts`, `server/src/adapters/*`, and `server/src/db/*`.

This layer is the **only** place `drizzle-orm`, the `postgres` driver, `octokit`, `simple-git`,
and the OpenAI/Anthropic SDKs may be imported.

## What lives here

- **Repository implementations** — `DrizzleReviewRepository implements IReviewRepository`. Drizzle
  queries live here and nowhere else.
- **Adapters** — concrete `LLMProvider` / `GitClient` / `GitHubClient` / `Embedder` /
  `SecretsProvider` implementations behind ports defined in `@devdigest/shared`.
- **Mappers** — translate `typeof table.$inferSelect` rows into domain entities (and back).

## Hard rules

- **Implement an inner interface; don't invent the contract here.** The port is owned by the
  domain/application; infrastructure only fulfils it.
- **Map at the boundary.** Convert Drizzle rows to domain entities with a private `toDomain()`;
  never return a raw row outward. A leaked `$inferSelect` row couples every caller to the DB
  schema ([leaky abstraction](https://en.wikipedia.org/wiki/Leaky_abstraction)).
- **No business rules.** Repositories persist and fetch; they don't decide blocker thresholds or
  workflow. Logic like that belongs on the entity or in a use-case.
- **Honour tenancy.** Every query scopes by `workspaceId` (project convention), e.g.
  `and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.id, id))`.

## Drizzle repository (good)

```typescript
// infrastructure/review/drizzle-review.repository.ts
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { IReviewRepository } from '../../domain/review/review.repository.js';
import { Review } from '../../domain/review/review.js';

export class DrizzleReviewRepository implements IReviewRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Review | null> {
    const [row] = await this.db.select().from(t.reviews).where(eq(t.reviews.id, id));
    return row ? this.toDomain(row) : null;
  }

  async save(review: Review): Promise<void> {
    await this.db
      .insert(t.reviews)
      .values({ id: review.id, pullId: review.pullId, title: review.title, status: review.status })
      .onConflictDoUpdate({ target: t.reviews.id, set: { status: review.status } });
  }

  /** The mapping boundary: a Drizzle row never escapes this file. */
  private toDomain(row: typeof t.reviews.$inferSelect): Review {
    return Review.rehydrate(row.id, row.pullId, row.title, row.status);
  }
}
```

Use the `drizzle-orm-patterns` skill for query/transaction syntax and `postgresql-table-design`
for schema decisions — this skill governs only *where* that code lives and *which way* it may
depend.

## Adapters behind ports

The existing adapter set already follows this pattern: ports such as `LLMProvider`, `GitClient`,
`GitHubClient`, `Embedder`, `SecretsProvider` are declared in `@devdigest/shared`, and concrete
classes (`OpenAIProvider`, `SimpleGitClient`, `OctokitGitHubClient`, …) live under
`server/src/adapters/*`. A use-case depends on the port; the container injects the adapter.
See [dependency-injection.md](dependency-injection.md).

## Anti-patterns to reject

- A repository method returning `typeof table.$inferSelect` (or `Promise<any>` that is really a
  row) — map to a domain entity instead.
- Importing a domain entity *and* mutating DB state from a route handler (skip the layers).
- Business decisions inside a repository (severity rollups, status transitions).
- Constructing an adapter with `new OpenAIProvider(key)` inside a service instead of resolving it
  from the container.
