# API Contract Guard

Flag a CRITICAL finding when the diff makes a backward-incompatible change to an
existing HTTP endpoint that a current client depends on:
- A route path, method, or `:param` renamed, retyped, or removed.
- A request field made required, renamed, removed, or retyped (Zod schema tightened).
- A response field renamed, removed, retyped, or its nullability flipped.
- A status code changed for the same logical outcome (e.g. 200 → 204).

Additive changes (a new optional field, a brand-new route) are NOT breaking — do not
flag them. Internal refactors that leave the wire shape identical are NOT breaking.