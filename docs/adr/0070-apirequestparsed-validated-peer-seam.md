---
status: accepted
---

# apiRequestParsed is the runtime-validated peer of apiRequest

## Context

`apiRequest.ts` already concentrates HTTP machinery (auth, retry, URL, error) as
a deep seam, exposing `apiRequest<T>` (cast JSON to `T`, unchecked) and
`apiRequestVoid`. A survey flagged the endpoint wrappers as repeating a
`schema.safeParse(json)` + `throw` envelope "~30 times". On inspection that count
was wrong: the app has three response-handling styles —

1. `apiRequest<Typed>` — unchecked cast, the majority (~40 calls);
2. `apiRequest<unknown>` + `safeParse(json)` + `throw` — the uniform validated
   envelope, but only THREE sites (`apiInbox` ×2, `apiProjects` ×1);
3. raw `fetch` + `safeParse` with **divergent** failure modes (`apiFriends`
   returns `[]`, `apiFeed` throws) — legacy, predating `apiRequest`.

So the genuinely-uniform envelope is 3 sites, not 30 — a small but real
(≥2-adapter) seam.

## Decision

Add `apiRequestParsed<T>(credentials, path, schema, options)` as the
runtime-validated peer of `apiRequest`: it performs the request and validates the
JSON against a Zod schema, returning the parsed value or throwing
`Invalid response from <path>: <first zod issue>`. The three uniform sites migrate
to it; the "how a malformed response fails" invariant now has one owner and one
test surface.

Deliberately NOT migrated:
- The ~40 unchecked `apiRequest<Typed>` calls — they perform no runtime
  validation today; routing them through `apiRequestParsed` would require schemas
  they lack and would change behavior. They can opt in incrementally.
- `apiFriends` / `apiFeed` raw-`fetch` sites — they don't use `apiRequest` and
  have genuinely different failure contracts (soft `[]` vs throw); folding them in
  would collapse distinct failure modes, so they stay until separately reworked.

## Consequences

- Validated requests are now a first-class option alongside `apiRequest` /
  `apiRequestVoid`; new endpoints with a response schema use `apiRequestParsed`
  instead of hand-rolling safeParse+throw.
- The validation-failure path is tested once (`apiRequest.test.ts`): success,
  path-tagged validation error, and HTTP-error-still-surfaces — via the existing
  fetch-mock harness.
- The error message is path-tagged (`Invalid response from /v1/inbox`) rather
  than per-entity (`Invalid inbox response`) — more precise and free of a
  per-caller label.
- The seam is intentionally small; the ADR records that the "~30 duplications"
  finding was really 3 uniform sites plus divergent legacy code, so a future
  review does not re-scope it as a mass migration.
