# Application layer (use-cases)

Models **what the application does**. It orchestrates domain objects to fulfil one use-case per
operation, depending only on **domain interfaces** — never on Fastify, Drizzle, or a concrete
adapter. In DevDigest this maps to `server/src/modules/*/service.ts`.

## What lives here

- **Use-cases / application services** — one method per business operation
  (`CreateReview.execute`, `ListRepos.execute`). They coordinate; they do not contain
  persistence or transport details.
- **Command / Query DTOs** — the typed input of a use-case (`CreateReviewCommand`). Plain data,
  already validated by the boundary.
- **Result DTOs** — the typed output returned outward (`ReviewDto`). Never a domain entity and
  never a Drizzle row — an explicit contract that outer layers depend on.

## Hard rules

- **Depend on ports, not implementations.** Constructor-inject repository interfaces and adapter
  ports; let the [composition root](dependency-injection.md) supply concrete classes.
- **No transport types.** `FastifyRequest`/`FastifyReply` must not appear here. The use-case takes
  a Command DTO and returns a Result DTO; the route adapts HTTP to those.
- **No Drizzle / SQL.** All persistence goes through the injected repository interface.
- **Map outward.** Convert entities to Result DTOs before returning, so infrastructure shapes
  never leak past this layer.
- **Orchestrate, don't compute business rules.** Invariants belong on the entity (domain). The
  use-case decides *which* operations run and in what order.

## Use-case (good)

```typescript
// application/review/create-review.ts
import type { IReviewRepository } from '../../domain/review/review.repository.js';
import type { ReviewDto } from './review.dto.js';
import { Review } from '../../domain/review/review.js';

export interface CreateReviewCommand {
  workspaceId: string;
  pullId: string;
  title: string;
}

export class CreateReview {
  // Injected as an interface — DrizzleReviewRepository is bound in container.ts.
  constructor(private readonly reviews: IReviewRepository) {}

  async execute(cmd: CreateReviewCommand): Promise<ReviewDto> {
    const review = Review.open(cmd.workspaceId, cmd.pullId, cmd.title); // domain invariants enforced here
    await this.reviews.save(review);
    return toReviewDto(review); // map entity → DTO; never return the entity or a DB row
  }
}
```

```typescript
// application/review/review.dto.ts
export interface ReviewDto {
  id: string;
  pullId: string;
  title: string;
  status: 'open' | 'complete';
}

export function toReviewDto(r: Review): ReviewDto {
  return { id: r.id, pullId: r.pullId, title: r.title, status: r.status };
}
```

## Relationship to today's `service.ts`

Existing module services (e.g. `modules/repos/service.ts`) already orchestrate and depend on the
container — that is the application layer. To reach strict onion, tighten two things:

1. Services accept **domain interfaces**, not the whole `Container`, where practical (clearer
   dependencies, trivially mockable).
2. Services return **Result DTOs** produced from domain entities, not Drizzle rows passed straight
   through. See [migration-from-current.md](migration-from-current.md).

## Anti-patterns to reject

- A use-case that imports `drizzle-orm` or builds a query (push it into the repository).
- A use-case typed against `FastifyRequest` (transport leak).
- Returning the domain entity or a Drizzle row to the caller instead of a Result DTO
  (leaky abstraction — BAD example #3 in [examples.md](../examples.md)).
- A "service" that is just CRUD passthrough *and* re-validates input the boundary already checked.
