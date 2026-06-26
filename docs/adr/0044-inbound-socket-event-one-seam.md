---
status: accepted
---

# Inbound fire-and-forget socket events ingest through one seam

## Rule

Every fire-and-forget daemon→server socket signal registers through
`registerSocketEvent` (`packages/happy-server/sources/app/api/socket/registerSocketEvent.ts`)
rather than hand-rolling its own `socket.on` wrapper.

The seam owns the boilerplate that was previously copy-pasted into each handler:

1. `socket.on(event, ...)` registration.
2. `schema.safeParse(rawData)` with the standard warn-and-drop
   (`${event}: invalid data: ${error.message}`) on a malformed payload.
3. The catch-all `${event} handler error: ${error}` log that keeps one throwing
   or malformed payload from taking down the socket.

Each call supplies its own `module` log tag and a typed `handler(data, ctx)` that
receives the validated payload plus `{ userId, socket }`. The business logic —
the leverage — stays in the handler; only the wrapper moves to the seam.

## Trigger

Six handlers (`taskStatusHandler`, `webhookStatusHandler`,
`supervisorRunStatusHandler`, `supervisorFixStatusHandler`, `sessionEventHandler`,
`interAgentMessageHandler`) repeated the identical
`try → safeParse-or-warn → business → catch error-log` shape, differing only in
event name, schema, and log tag. The wrapper passed the deletion test as pure
duplication: removing it from any one handler forced it to reappear verbatim in
the others. ADR-0023 / ADR-0024 had already collapsed the symmetric **outbound**
side (`emitSyncUpdate` / `emitSyncEphemeral`) into one seam each; the inbound
receive path had no equivalent home until now.

## Scope

**Fire-and-forget variant only** — handlers that take no acknowledgement
`callback`. The request/response handlers that reply through a `callback`
(`sessionUpdateHandler`, `sessionAdoptHandler`, `sessionPreferencesHandler`,
`machineUpdateHandler`, `knowledgeHandler`, `previewProxyHandler`,
`rpcHandler`) carry an additional response contract (`callback({ result })`,
versioned optimistic-lock replies) and stay on the RPC path — see ADR-0035
(RPC lifecycle duplicated until drift). They are NOT adapters of this seam.

## Considered alternatives

- **Leave the per-handler wrappers.** Rejected — the duplication is exact and
  grows by one full copy per new daemon signal.
- **Fold the callback handlers in too.** Rejected — the acknowledgement /
  versioned-reply contract is a different interface; merging would force the
  seam to model two response shapes and re-open ADR-0035.
- **A base class / middleware chain.** Rejected — the codebase prefers functional
  composition over classes; a single higher-order registration function is the
  smaller interface.

## Consequences

- One place owns input validation, the ops-error log convention (ADR-0034), and
  the socket-survival guarantee for inbound signals. `registerSocketEvent.spec.ts`
  pins the three invariants (valid → typed handler+ctx; invalid → warn + drop;
  throw → error log, no crash) as the test surface, so individual handler specs
  test business logic only.
- `interAgentMessageHandler`'s invalid-payload log text normalized from
  `invalid payload` to `invalid data` (cosmetic; logs are not a contract).
- New daemon signals add a schema + handler body; the wrapper is no longer
  re-authored.

## Affected

`packages/happy-server/sources/app/api/socket/registerSocketEvent.ts` (new seam),
the six migrated handlers above, and `registerSocketEvent.spec.ts`.
