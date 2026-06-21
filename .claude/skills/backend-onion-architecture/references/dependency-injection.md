# Dependency injection (ports, adapters & the composition root)

Dependency injection is the mechanism that lets every source arrow point inward. Inner layers
declare **ports** (interfaces); outer layers provide **adapters** (implementations); a single
**composition root** binds them. This is the Dependency Inversion Principle applied
([Fowler on DI](https://martinfowler.com/articles/injection.html)).

DevDigest already does this well — the goal is to keep doing it and extend it to use-cases.

## Ports live in the inner layer

Port interfaces are framework-free and owned by the code that *needs* the capability, not the code
that provides it. In this repo the cross-cutting ports live in `@devdigest/shared` (vendored), so
they carry no infrastructure imports:

```typescript
// @devdigest/shared — a port, framework-free
export interface LLMProvider {
  complete(input: CompletionInput): Promise<CompletionResult>;
}
```

Repository ports are owned per domain (e.g. `IReviewRepository` in
[domain-layer.md](domain-layer.md)).

## Adapters implement ports (infrastructure)

`OpenAIProvider`, `AnthropicProvider`, `SimpleGitClient`, `OctokitGitHubClient`,
`DrizzleReviewRepository`, … each `implements` a port and live under `server/src/adapters/*` or a
module's `repository.ts`. Nothing inward imports these classes.

## The single composition root

`server/src/platform/container.ts` is the one place concrete classes are constructed and bound to
ports. Consumers receive abstractions:

```typescript
// platform/container.ts (shape — see the real file)
export class Container {
  // lazily constructed, cached, swappable via overrides
  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    return (this._git ??= new SimpleGitClient(this.config.cloneDir));
  }

  get reviewRepo(): ReviewRepository {
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    /* resolves the secret key, constructs the adapter, caches it */
  }
}
```

To add a use-case to the container, construct it from already-bound ports — keep all wiring here:

```typescript
get createReview(): CreateReview {
  return (this._createReview ??= new CreateReview(this.reviewRepo));
}
```

## Constructor injection is the default

Prefer constructor injection (testable, explicit) over reaching into the container mid-method or
using setter/property injection. A use-case lists exactly what it needs as constructor params,
all of them interfaces.

## Testing: swap adapters, not internals

`ContainerOverrides` injects mocks (`server/src/adapters/mocks.ts`) so a service or use-case can be
unit-tested with **zero** DB/HTTP/LLM calls. Because services depend on *interfaces*, the mock is a
trivial object that satisfies the port. (This is exactly why the layering pays off — see the
`.it.test.ts` vs hermetic split in `TESTING.md`.)

## Anti-patterns to reject

- Constructing a concrete adapter (`new OpenAIProvider(key)`, `new SimpleGitClient(...)`) anywhere
  except the container.
- A use-case depending on the whole `Container` when it needs one repository — inject the
  interface instead, so the dependency is explicit and mockable.
- A handler resolving services via `request.server.…` framework internals instead of the
  container wired at registration (BAD example #6 in [examples.md](../examples.md)).
- A port interface that imports `drizzle-orm`/`fastify` — that defeats the inversion.
