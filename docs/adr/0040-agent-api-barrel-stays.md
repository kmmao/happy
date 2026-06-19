---
status: accepted
---

# `happy-agent/src/api.ts` stays as the package's API barrel

## Context

`packages/happy-agent/src/api.ts` re-exports ~10 functions and 6 types from
`./api/httpClient`. An architecture review flagged it as a shallow pass-through:
deleting it would not concentrate any complexity, so by the deletion test it "earns
nothing."

That reading undercounted its importers. The barrel is imported across the package —
`src/index.ts`, `src/daemon/run.ts`, `src/output.ts`, and the test suites all import
from `@/api` / `./api`, not from `./api/httpClient` directly. It is the package's single,
stable import path for its API surface, exactly the role a barrel plays.

## Decision

**Keep the barrel.** It is a deliberate convention, not friction. Removing it would
repoint every importer to `./api/httpClient` — pure churn with no architectural gain, and
it would couple every call site to the current internal file layout (so a later split of
`httpClient.ts` would touch every importer instead of just the barrel).

## Consequences

- A future review re-applying the deletion test to `api.ts` should read this first: the
  pass-through is an intentional barrel with many importers, and the indirection is the
  point (it decouples callers from the `api/` internal layout).
- If the barrel ever grows logic beyond re-exports, revisit — at that point it is no longer
  a barrel and the trade-offs change.
