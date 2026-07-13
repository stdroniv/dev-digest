# response-schema

Watch the SHAPE of responses specifically — the part clients deserialize. Compare the
before/after of every changed response schema or returned object literal in the diff.
A response break is invisible to the server's own tests but breaks the client's
parsing or rendering. Cite the exact `file:line`.

Treat each of these as a response-shape break on an existing route:
- a field removed or renamed (the client reads `undefined`);
- a field retyped (`string` → `number`, object → array, scalar → object);
- a required field made optional/nullable, or a nullable field made required;
- the envelope or pagination shape changed (`{ items, nextCursor }` →
  `{ data, page }`), or a bare array wrapped/unwrapped;
- a date/number serialization format changed (ISO string → epoch millis).

Adding a NEW optional field to a response is NOT a break — skip it.

## Bad — nullability flip + envelope change
```ts
// was: { items: Item[]; nextCursor: string | null }
- return { items, nextCursor };
+ return { data: items, page: { next } };   // client reads `items`/`nextCursor` → both gone
```
```ts
// field was always present; now sometimes omitted → client must handle undefined
- return { id, email, verifiedAt };
+ return { id, email, ...(verifiedAt ? { verifiedAt } : {}) };
```

## Good — stable shape, additive only
```ts
return { items, nextCursor, totalCount };   // new field added, old keys untouched
```

Report a confirmed response-shape break as **CRITICAL**; a soft change with a
plausible client migration as **WARNING**. Name the exact field and how the client
parses it today.
