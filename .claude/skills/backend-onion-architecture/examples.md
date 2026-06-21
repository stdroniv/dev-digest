# Good vs. Bad — backend onion patterns (DevDigest stack)

Short, stack-specific pairs for each rule. The ❌ versions all violate the **inward-only
dependency rule**; the ✅ versions keep Fastify/Drizzle/Zod/SDKs in their layer.

---

## 1. Route handler hitting the DB directly

**❌ BAD — presentation queries Drizzle; untestable without a DB; schema coupling**

```typescript
// modules/reviews/routes.ts
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';

router.get('/reviews/:id', async (req, reply) => {
  const [row] = await req.server.db.select().from(t.reviews).where(eq(t.reviews.id, req.params.id));
  return row; // raw Drizzle row straight to the client
});
```

**✅ GOOD — handler → use-case → repository interface; returns a DTO**

```typescript
// modules/reviews/routes.ts
router.get('/reviews/:id', { schema: { params: IdParams } }, async (req, reply) => {
  const dto = await app.container.getReview.execute(req.params.id); // application service
  if (!dto) return reply.status(404).send({ error: { code: 'not_found', message: 'Review not found' } });
  return dto; // ReviewDto — no Drizzle, no entity
});
```

---

## 2. Domain importing infrastructure

**❌ BAD — entity reaches into the DB; can't exist without Postgres**

```typescript
// domain/review/review.ts
import { db } from '../../db/client.js'; // domain importing infrastructure 🚫
import * as t from '../../db/schema.js';

export class Review {
  async save() {
    await db.insert(t.reviews).values(this); // active-record leak
  }
}
```

**✅ GOOD — domain declares a port; infrastructure implements it (DIP)**

```typescript
// domain/review/review.repository.ts  (interface owned by the domain)
export interface IReviewRepository {
  save(review: Review): Promise<void>;
}

// infrastructure/review/drizzle-review.repository.ts  (Drizzle stays out here)
export class DrizzleReviewRepository implements IReviewRepository {
  constructor(private db: Db) {}
  async save(review: Review) {
    await this.db.insert(t.reviews).values({ id: review.id, title: review.title, status: review.status });
  }
}
```

---

## 3. Leaking a Drizzle row outward

**❌ BAD — `$inferSelect` row escapes; API shape is now bound to DB columns**

```typescript
// application/review/get-review.ts
async execute(id: string) {
  return this.reviews.findRowById(id); // returns typeof t.reviews.$inferSelect
}
```

**✅ GOOD — map row → entity in the repo, entity → DTO in the use-case**

```typescript
// infrastructure: toDomain(row) → Review     (see infrastructure-layer.md)
// application/review/get-review.ts
async execute(id: string): Promise<ReviewDto | null> {
  const review = await this.reviews.findById(id); // domain entity
  return review ? toReviewDto(review) : null;     // explicit, stable DTO
}
```

---

## 4. Zod inside the core

**❌ BAD — validation library pulled into an application/domain service**

```typescript
// application/review/create-review.ts
import { z } from 'zod';
const Schema = z.object({ title: z.string().min(1) });

async execute(input: unknown) {
  const { title } = Schema.parse(input); // re-validating already-validated input, inside the core
}
```

**✅ GOOD — Zod only at the Fastify boundary; the use-case takes a typed Command DTO**

```typescript
// presentation: schema-first route validated by fastify-type-provider-zod (422 before handler)
const CreateReviewBody = z.object({ pullId: z.string().uuid(), title: z.string().min(1) });

// application/review/create-review.ts — no Zod import
async execute(cmd: CreateReviewCommand): Promise<ReviewDto> { /* cmd is already valid */ }
```

---

## 5. Anemic domain vs. rich entity

**❌ BAD — entity is a data bag; the rule lives in a separate service**

```typescript
// domain/review/finding.ts
export class Finding { constructor(public severity: string) {} }

// application/finding-rules.service.ts
export class FindingRules {
  isBlocker(f: Finding) { return f.severity === 'high' || f.severity === 'critical'; }
}
```

**✅ GOOD — invariant + behavior live on the entity**

```typescript
// domain/review/finding.ts
export class Finding {
  constructor(readonly severity: Severity) {
    if (!SEVERITIES.includes(severity)) throw new Error('invalid severity');
  }
  isBlocker() { return SEVERITIES.indexOf(this.severity) >= SEVERITIES.indexOf('high'); }
}
```

---

## 6. Framework leak via container internals

**❌ BAD — handler reaches through Fastify internals to resolve a service**

```typescript
router.post('/reviews', async (req, reply) => {
  const svc = (req.server as any).diContainer.get('createReview'); // framework-coupled, untyped
  return svc.execute(req.body);
});
```

**✅ GOOD — services resolved from the typed container wired at registration**

```typescript
export async function reviewRoutes(app: FastifyInstance) {
  const createReview = app.container.createReview; // resolved once, at registration
  router.post('/reviews', { schema: { body: CreateReviewBody } }, async (req) =>
    createReview.execute({ workspaceId: (await getContext(app.container, req)).workspaceId, ...req.body }),
  );
}
```

---

## 7. reviewer-core staying pure

**❌ BAD — the pure engine imports a DB/HTTP side effect**

```typescript
// reviewer-core/src/review/run.ts
import { db } from '../../../server/src/db/client.js'; // engine now needs a database 🚫
```

**✅ GOOD — side effects enter only through an injected port**

```typescript
// reviewer-core/src/review/run.ts
export async function reviewPullRequest(inputs: ReviewInputs, llm: LLMProvider): Promise<Review> {
  // all IO goes through the injected LLMProvider; no DB/HTTP/FS imports
}
```
