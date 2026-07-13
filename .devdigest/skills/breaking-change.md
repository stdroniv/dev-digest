# breaking-change

Flag any change that removes or alters a part of a PUBLIC HTTP contract an existing
client already depends on. A break is anything that makes a request that worked
before this PR now fail, or makes a response the client parsed before now parse
differently. Cite the exact `file:line` and name the field/param/route that breaks.

A change is breaking when it does ANY of these to an EXISTING route:
- removes or renames a route path, method, or `:param`;
- removes, renames, or retypes a request or response field;
- makes a previously-optional request field required, or adds a new required field;
- narrows an enum, tightens validation, or flips a field's nullability;
- changes the status code a client branches on for the same logical outcome.

Purely ADDITIVE changes are NOT breaking: a new optional request field, a new
response field, a brand-new route, or an internal refactor that leaves the wire
shape byte-identical. Do not flag those.

## Bad — silently breaks every caller
```ts
// route: GET /users/:id  — response field renamed
- return { id: user.id, fullName: user.fullName };
+ return { id: user.id, name: user.fullName };   // clients reading `fullName` now get undefined
```
```ts
// request body — a new REQUIRED field rejects every old client
const Body = z.object({
  email: z.string(),
+ tenantId: z.string(),        // old clients omit it → 422
});
```

## Good — additive, backward-compatible
```ts
// new field is OPTIONAL → old clients keep working
const Body = z.object({
  email: z.string(),
+ tenantId: z.string().optional(),
});
```
```ts
// keep the old field, add the new one alongside it
return { id: user.id, fullName: user.fullName, name: user.fullName };
```

When you find a break, report it as **CRITICAL** and state the concrete caller
request that would now fail.
