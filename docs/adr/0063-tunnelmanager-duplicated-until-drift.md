---
status: accepted
---

# TunnelManager stays duplicated in CLI + Agent until drift, guarded by a parity test

## Context

`TunnelManager` — aggregate-all-providers, parallel `detectAll` with a per-provider
timeout, periodic refresh with `JSON.stringify` change detection, and lease
renewal discovered *structurally* off the `TunnelProvider` interface
(`typeof p.renewLeases === "function"`, per ADR-0045) — is copied into both
`packages/happy-cli/src/tunnel/tunnelManager.ts` and
`packages/happy-agent/src/tunnel/tunnelManager.ts`. The packages cannot import
each other.

This is the same situation ADR-0035 addressed for `RpcHandlerManager`, and the
same reasoning applies: the pure contract (`TunnelProvider`, `TunnelState`, the
op-result types) already lives in `@kmmao/happy-wire` and is shared; only the
*runtime* half — a class owning real `setInterval` timers and provider I/O — is
duplicated. Pulling that into wire would burden wire's pure-types consumers
(Server, App) with a runtime dependency they never use.

When this was reviewed, the two copies had **drifted cosmetically** (the agent
copy had collapsed the `results.filter().map()` chain to one line and dropped the
braces on the `if (changed) onChange()` block) while remaining **logically
identical**. There was no guard preventing further, possibly-logical, drift —
"keep them identical" relied on reviewer memory, exactly the gap ADR-0035 closed
for the RPC lifecycle.

## Decision

Keep the two `TunnelManager` copies identical until they drift; only then extract
a shared `@kmmao/happy-tunnel-runtime`. Do NOT extract now — a new published
package adds to the build/release surface for a benefit (no drift) that is
currently zero.

To make "keep them identical" self-policing rather than memory-dependent, add a
**parity test** (`packages/happy-cli/src/tunnel/tunnelManagerParity.test.ts`,
mirroring `rpcManagerParity.test.ts`) that normalizes both copies — stripping
comments, imports, and whitespace runs — and asserts they are logically
identical. The cosmetic drift found during review was re-synced so the copies
pass the guard; from here, editing one copy without the other fails CI, naming
the file pair to reconcile — or, if the divergence is intentional, that failure
is the documented trigger to do the `@kmmao/happy-tunnel-runtime` extraction.

## Consequences

- The duplication is intentional and now self-policing: drift is caught by CI,
  not by review — the same regime as ADR-0035's RPC lifecycle.
- The parity normalizer collapses whitespace but not brace-vs-no-brace or
  spacing around punctuation, so the two copies must be kept structurally (not
  just logically) aligned. That is a feature: it keeps the copies genuinely
  copy-pasteable, so the eventual extraction is mechanical.
- A future architecture review proposing "DRY up TunnelManager" should read this
  first: like `RpcHandlerManager`, the duplication is a deferred, trigger-gated
  decision, not an oversight.
