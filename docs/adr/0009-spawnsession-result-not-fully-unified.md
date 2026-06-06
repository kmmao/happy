---
status: accepted
---

# Only the cross-process SpawnSession result lives in happy-wire; the agent variant and the options types stay local

When spawning a session, three things share the `SpawnSession*` name but are not the same concept. The **app caller** (`happy-app`, `sources/sync/ops.ts`) and the **CLI daemon responder** (`happy-cli`, `registerCommonHandlers.ts` / `apiMachine.ts`) exchange a byte-identical cross-process result over the wire — `{type:"success", sessionId}` | `{type:"requestToApproveDirectoryCreation", directory}` | `{type:"error", errorMessage}` — so that result, and only that result, was moved into `@kmmao/happy-wire` (`spawnSession.ts`, `SpawnSessionResultSchema`) as the single source of truth. We deliberately did **not** unify two other things that look similar:

- **`happy-agent`'s `SpawnSessionResult`** is a different operation. It reports a *locally* spawned process as `{type:"success", pid, directory}` — a PID and working directory, not a remote session id. It never crosses the app↔daemon wire, so merging it would force an artificial union of two unrelated success shapes.
- **The two `SpawnSessionOptions`** (app-side vs. CLI-side) are different *views* of the request, not one contract. Each package keeps the fields it actually needs; there is no shared consumer that would benefit from one merged type.

## Considered options

- *Unify all three under one wire schema* (the obvious "SpawnSession lives in happy-wire" reading). Rejected: it would collapse a genuine cross-process contract (one real two-adapter seam) together with a local-fork operation and two divergent option views (no shared seam), producing a shallow over-abstraction whose union members exist only to satisfy the abstraction.

## Consequences

- The agent's `SpawnSessionResult` and both `SpawnSessionOptions` remain owned by their packages; changing them does not ripple through `happy-wire`.
- Only `SpawnSessionResultSchema` carries the app↔daemon compatibility obligation: changes to it follow the wire publish order (wire → CLI → app) and must stay backward compatible.
- A future architecture review that proposes "merge all the SpawnSession types into wire" should read this first — the non-unification is intentional, not an oversight.
