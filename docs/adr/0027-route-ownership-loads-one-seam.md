# 0027 — Route ownership loads go through one seam

## Decision

Routes that load an Account-owned entity by id use the `owned<Entity>(accountId, id)`
loaders in `sources/app/api/ownership.ts` instead of hand-rolling
`findFirst({ where: { id, accountId } })` + 404. A missing or foreign row throws
`OwnedEntityNotFound`, which `enableErrorHandlers` maps to the legacy flat body
`{ error: "<Entity> not found" }` (clients and specs assert that shape; the
`apiError` envelope is NOT used for this case).

The seam has two call forms:

- **`owned<Entity>(accountId, id)`** — returns the full row. Use when the
  handler reads the row.
- **`assertOwned<Entity>(accountId, id)`** — existence-only guard, queries
  with `select: { id: true }` and returns void. Use when the handler only
  needs the 404 check; the full-row form would ship large encrypted columns
  (Session.metadata/agentState, Project.metadata/supervisorConfig) the
  handler never reads — measurable on hot paths like message pagination.

## Scope

Only the plain load-by-id-with-ownership pattern. A pure existence check that
narrows with `select: { id: true }` counts as the plain pattern (loading the
full row is equivalent) and migrates. What stays hand-rolled: loads whose
`select`/`include` feeds data the loader's full row can't replace cheaply
(`_count`), extra `where` keys (e.g. SupervisorDimension's `projectId`
scoping, status filters), a different error body (combined messages like
"Session or machine not found", apiError envelopes), absence-tolerant lookups,
and anything on a transaction client — widening the loader interface to cover
them would make the seam shallow again.

## Status

96 call sites migrated across two passes (2026-06); 15 entity loaders plus 5
existence asserters (Project, Session, Machine, Artifact, ProvisionToken —
add more only when a bare existence check appears for that entity). 57 of the
migrated sites are existence-only and use `assertOwned*`. The remaining
`findFirst` ownership checks in routes were each reviewed and fall into the
stays-hand-rolled categories above. New routes must use the seam when the
pattern fits.
