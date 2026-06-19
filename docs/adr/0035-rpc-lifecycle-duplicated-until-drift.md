---
status: accepted
---

# RPC handler lifecycle stays duplicated in CLI + Agent until drift, guarded by a parity test

## Context

The socket.io RPC lifecycle — `RpcHandlerManager` (ack-based registration with retry, a 5s fast-retry timer, a 30s periodic re-register safety net) plus its `types.ts` — is copied byte-for-byte, modulo import paths and a doc comment, into `packages/happy-cli/src/api/rpc/` and `packages/happy-agent/src/api/rpc/`. The packages cannot import each other.

The *pure* half of RPC — `dispatchRpcMethod` (plaintext routing, total: returns `{ error }` rather than throwing) and the type contract — already lives in `@kmmao/happy-wire` and is shared (see wire's `rpcDispatch.ts`). The *lifecycle* half is deliberately NOT in wire: it touches real timers and a live `Socket`, and pulling `socket.io-client` into wire would burden wire's other consumers (Server, App) that never speak this protocol. Wire keeps a pure-types invariant.

## Decision

**Keep the two `RpcHandlerManager` copies identical until they drift; only then extract a shared `@kmmao/happy-rpc-runtime` package.** The lifecycle is not pure (timers + Socket), so it does not belong in wire; and a separate published package is overhead that the current zero-drift state does not justify. The duplication is the smell that signals when the cost has actually arrived.

To stop "keep them identical" from depending on reviewer memory, a **parity test** (`packages/happy-cli/src/api/rpc/rpcManagerParity.test.ts`) normalizes both copies (stripping comments, imports, and whitespace) and asserts they are logically identical. Editing one copy without the other fails the test, naming the exact file pair to reconcile — or, if the divergence is intentional, that failure is the documented trigger to do the `@kmmao/happy-rpc-runtime` extraction.

## Considered options

- *Move the lifecycle into `@kmmao/happy-wire` now.* Rejected: it would pull `socket.io-client` and stateful timer/socket lifecycle into a package whose value is being pure types + pure dispatch consumed by four packages including Server and App. Contradicts wire's pure-types invariant.
- *Extract `@kmmao/happy-rpc-runtime` now.* Rejected (premature): a new published package adds to the publish chain and build/release surface for a benefit (no drift) that is currently zero because the copies are in sync. The parity test makes the right moment self-announcing.

## Consequences

- The duplication is intentional and now self-policing: drift is caught by CI, not by review.
- When the parity test legitimately needs to diverge (a package-specific lifecycle change), that is the signal to extract `@kmmao/happy-rpc-runtime` and delete the duplication — the test documents this in its own failure path.
- A future architecture review proposing "DRY up RpcHandlerManager" should read this first: the duplication is a deferred, trigger-gated decision, not an oversight.
