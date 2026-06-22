# semver-discipline

Map each contract change to the version bump it demands, and flag when a breaking
change ships WITHOUT the major bump (or new versioned path) that should carry it.
This is the policy layer on top of `breaking-change`: a break is only safe when it
rides a new version, not the existing one.

Rules:
- A backward-INCOMPATIBLE change to an existing versioned path (`/v1/...`) requires a
  NEW path (`/v2/...`) — the `/v1` shape must keep working. Mutating `/v1` in place is
  the violation.
- A package/library that exports the changed contract must get a MAJOR bump in
  `package.json` when the export changes incompatibly; a MINOR bump for additive-only.
- Additive changes (new optional field, new route, new enum member that clients can
  ignore) are MINOR — do not demand a major bump for them.

## Bad — breaking change mutates the existing version
```ts
// /v1/orders previously returned `total: number`; this retypes it in place
- app.get('/v1/orders/:id', () => ({ total: cents }));
+ app.get('/v1/orders/:id', () => ({ total: { amount: cents, currency } }));  // /v1 contract broken
```
```jsonc
// package.json — exported response type changed incompatibly but only a patch bump
- "version": "2.4.1",
+ "version": "2.4.2",     // should be 3.0.0
```

## Good — break carried on a new version, old one preserved
```ts
app.get('/v1/orders/:id', () => ({ total: cents }));            // unchanged
app.get('/v2/orders/:id', () => ({ total: { amount, currency } })); // new shape on /v2
```

Flag an in-place break on a versioned path as **CRITICAL**, and a missing/incorrect
version bump as **WARNING**. Name the path or package and the bump it needs.
