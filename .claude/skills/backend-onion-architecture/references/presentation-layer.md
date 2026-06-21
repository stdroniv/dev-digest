# Presentation layer (Fastify + Zod at the edge)

The outermost ring for inbound traffic. It adapts HTTP to use-cases and back. In DevDigest this is
`server/src/modules/*/routes.ts` and `server/src/app.ts`. Handlers stay **thin**: validate →
resolve a service → return a DTO.

## What lives here

- **Fastify routes / plugins** — schema-first, registered as self-contained module plugins.
- **Zod boundary schemas** — `params` / `body` / `querystring` validated via
  `fastify-type-provider-zod`, rejecting bad input with `422` *before* the handler runs.
- **HTTP concerns** — status codes, headers, SSE streaming, mapping `AppError` → response shape.

## Hard rules

- **No DB / Drizzle in a handler.** A route must go through an application service; it never runs
  a query. (This is the rule the dependency-cruiser config hard-blocks.)
- **No business logic in a handler.** Decisions live in the domain/use-case. The handler only
  translates between HTTP and a Command/Result DTO.
- **Zod stays here.** Validate at the edge; inner layers receive already-valid data. Derive types
  with `z.infer` and pass plain DTOs inward.
- **Resolve services from the container at registration**, not by reaching through framework
  internals inside the handler body (avoid `request.server.diContainer.…` framework leak).

## Thin handler (good)

```typescript
// presentation/review/routes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';

const CreateReviewBody = z.object({ pullId: z.string().uuid(), title: z.string().min(1) });

export async function reviewRoutes(app: FastifyInstance) {
  const router = app.withTypeProvider<ZodTypeProvider>();
  const createReview = app.container.createReview; // application service, wired at startup

  router.post('/reviews', { schema: { body: CreateReviewBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const dto = await createReview.execute({ workspaceId, ...req.body }); // Command DTO in, Result DTO out
    reply.status(201);
    return dto; // a ReviewDto — never an entity, never a Drizzle row
  });
}
```

The handler never sees `drizzle-orm` or a domain entity directly; it speaks DTOs. See
`fastify-best-practices` for plugin/lifecycle/error-handler syntax and the `zod` skill for schema
authoring — this skill only governs the layering.

## Where validation belongs

- **Boundary (here):** shape/format/range of untrusted input — Zod. Reject early with `422`.
- **Domain (core):** business invariants — enforced in entity/value-object constructors, in plain
  TypeScript, with no Zod dependency.

These are different jobs; do not move Zod inward or push business invariants out to the route.

## Anti-patterns to reject

- A handler that imports `../db` or `drizzle-orm` and queries directly (BAD example #1 in
  [examples.md](../examples.md)).
- Business rules (severity rollups, status transitions) computed in the route body.
- Hand-rolled `Schema.parse(req.body)` inside the handler instead of the schema-first
  `fastify-type-provider-zod` declaration (project convention).
- Returning a domain entity or Drizzle row straight to the client.
