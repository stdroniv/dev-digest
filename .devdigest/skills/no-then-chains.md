# Convention — no .then() chains

Our codebase standard is `async/await`, never `.then()/.catch()` chains.

Flag as a finding when the diff introduces:
- A `.then(...)` or `.catch(...)` chain on a promise that could be awaited.
- `Promise.then` used for control flow inside an `async` function.

Do NOT flag `Promise.all([...])`, `.finally()` for cleanup, or `.catch()` attached
to a fire-and-forget background task that is intentionally not awaited.