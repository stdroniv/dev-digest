# Test Coverage Nudge

When the diff adds or changes non-test code, check that its new behaviour is tested:
- Every new `if`/`else`, `switch` arm, `try/catch`, and early-return guard should have
  at least one test input that reaches it.
- A function with an error path tested only for success is a gap — flag the
  uncovered failure branch and the input that triggers it.
- A happy-path-only test for code with a meaningful boundary (empty list, null,
  limit edge) is incomplete — name the missing corner case.

Do not demand tests for trivial getters or chase 100% coverage as a goal in itself.