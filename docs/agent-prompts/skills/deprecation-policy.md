# deprecation-policy

Prefer SOFT deprecation over silent removal. When a PR deletes a field, param, route,
or enum value that clients may still use, the change should instead mark it deprecated
and keep returning/accepting it for a migration window. Flag silent removals and
point at the soft-deprecation path.

What good deprecation looks like:
- the old field/route keeps working (still returned / still accepted) during the
  window;
- it is annotated as deprecated — a `@deprecated` JSDoc tag, an `x-deprecated` schema
  marker, a `Deprecation` / `Sunset` response header, or a doc note — so callers are
  warned BEFORE it disappears;
- a replacement is offered alongside it; removal happens in a LATER, clearly-versioned
  release, not the same PR that introduces the replacement.

A removal is acceptable without a window ONLY if the surface was never public
(internal route, unreleased feature, or a field added earlier in the same unreleased
version).

## Bad — silent hard removal
```ts
// field clients still read, deleted outright with no warning
- return { id, email, legacyToken };
+ return { id, email };
```
```ts
// route deleted in the same PR that adds its replacement
- app.get('/users/:id/profile', getProfile);   // callers 404 immediately
+ app.get('/users/:id/card', getCard);
```

## Good — deprecate, keep, then remove later
```ts
/** @deprecated use `email`; removed in v3. Still returned through v2.x. */
return { id, email, legacyToken };             // kept during the window
```
```ts
reply.header('Deprecation', 'true');
reply.header('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT');
return getProfile();                            // old route still served, marked sunset
```

Flag a silent removal of a still-public surface as **CRITICAL** (it is also a
`breaking-change`); flag a removal that is missing only the deprecation annotation as
**WARNING**.
