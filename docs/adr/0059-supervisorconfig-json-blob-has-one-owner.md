---
status: accepted
---

# The Project.supervisorConfig JSON blob is parsed by one owning module

## Context

`Project.supervisorConfig` is an opaque JSON string carrying several
independent sub-schemas: `autoApprove.{autoSeverities, semiAutoSeverities}`,
`concurrency.{maxAnalysisSessions, maxFixSessions}`, `maxFindings`,
`defaultProfileId`, and `analyzeAutoFix`. Before this decision, only
`autoApprove` had an owning parser (`supervisorConfig.ts:parseAutoApproveSeverities`).
Every other field was extracted by an inline `JSON.parse` + per-field
`typeof` guard + try/catch at each call site:

- `supervisorLoopEngine.ts` — a private `parseConcurrencyConfig` (concurrency +
  maxFindings), called at three trigger points.
- `supervisorRunRoutes.ts` — exported `parseConcurrencyConfig` / `parseMaxFindings`
  (a second, subtly different concurrency parser without `maxFindings`), imported
  cross-route by `supervisorRoutes.ts`.
- `supervisorAutoApproval.ts` — inline `JSON.parse` into an `any`, then inline
  concurrency extraction inside the per-action loop.
- `supervisorScheduler.ts` — inline `JSON.parse` for `maxFindings`.
- `supervisorActionRoutes.ts` — inline `JSON.parse` for `analyzeAutoFix`.
- `supervisorProfileResolver.ts` — inline `JSON.parse` for `defaultProfileId`.

Each site re-derived the same "parse-once, guard-each-field, default-on-malformed"
rules. The blob's shape lived nowhere; it was reconstructed, differently, in six
places. A new field, or a change to the malformed-input contract, meant editing N
sites, and there was no single test surface for "what does this blob mean".

The CSV column `Project.supervisorEnabledDimensions` (a *different* field, not the
JSON blob) had the same problem in miniature: the `split(",").map(trim).filter`
dance was inlined in the engine, scheduler, and run routes.

## Decision

`modules/supervisorConfig.ts` is the single owner of the `supervisorConfig` blob
shape. `parseSupervisorConfig(raw): SupervisorConfig` parses once and returns the
fully-typed, fully-defaulted object; it never throws. Callers read typed fields
off the result and never run `JSON.parse` against the raw string themselves.

- `SupervisorConfig` is the interface: the exhaustive field set with its
  defaults and its malformed-input contract baked in.
- `resolveAutoApproveSeverities(config, mode)` applies the mode-dependent
  defaults (which cannot be a static field because they depend on the mode).
- `parseAutoApproveSeverities(raw, mode)` stays as a back-compat convenience
  over the two.
- `parseEnabledDimensions(raw)` owns the sibling CSV column.

A behavioral invariant is preserved and pinned by spec: a *configured but
all-invalid* severity list resolves to `[]` (approve nothing), which is distinct
from an *unconfigured* list (`null` → mode defaults).

The three route-local exports (`parseConcurrencyConfig`, `parseMaxFindings`,
`parseDimensions`) and the engine's private `parseConcurrencyConfig` are deleted;
the cross-route import from `supervisorRoutes.ts → supervisorRunRoutes.ts` is
gone (routes now depend on the module, not on each other).

## Consequences

- Adding a field or changing the malformed-input contract is one edit in one
  module + one spec update; the six call sites pick it up by construction.
- The blob has a single test surface (`supervisorConfig.spec.ts`) that exercises
  defaults, type guards, and the `[]`-vs-`null` severity distinction without
  driving Prisma, sockets, or the loop engine.
- Dependency direction is corrected: a route no longer imports a parser from a
  sibling route; both import the module.
- This is the config-parsing analogue of ADR-0054 (fix-status lifecycle owned by
  one pure seam): the *decision/derivation* rules live in one module, callers
  apply the results.
