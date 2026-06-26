---
status: accepted
---

# Tunnel provider capabilities live in the TunnelProvider interface

## Rule

A capability that only some tunnel providers support is expressed as an
**optional method on the `TunnelProvider` interface**
(`packages/happy-cli/src/tunnel/types.ts`), and `TunnelManager` discovers it
structurally (`typeof p.cap === "function"`). `TunnelManager` must NOT match a
provider by `name` and cast to a concrete provider class to reach a capability.

The interface already follows this for `toggleAccess?`. Lease renewal now joins
it as `renewLeases?(): Promise<void>`.

## Trigger

`TunnelManager.startRefresh` reached past the seam to start UPnP lease renewal:

```ts
const upnp = this.providers.find((p) => p.name === "upnp") as UpnpProvider | undefined;
if (upnp && typeof upnp.renewLeases === "function") { ... }
```

`renewLeases` lived only on the concrete `UpnpProvider`, not on the interface, so
the manager imported the concrete type, hard-coded the name `"upnp"`, and cast.
That is a leaky seam: one adapter (UPnP) with the capability made it a
*hypothetical* seam, and the leak meant adding lease renewal to a second provider
(Cloudflare, FRP, a future Tailscale-serve lease) would force editing the
manager's main loop rather than just adding an adapter.

## Decision

- Add `renewLeases?(): Promise<void>` to `TunnelProvider`.
- `startRefresh` renews **every** provider that declares `renewLeases`, on a
  single shared timer (`LEASE_RENEWAL_INTERVAL_MS`, unchanged 30 min), isolating
  each provider's failure with a debug log.
- Drop the `import type { UpnpProvider }` and the name match + cast from
  `tunnelManager.ts`.

Behavior is identical today (UPnP is the only provider declaring the capability),
but a second leased provider now participates with zero manager changes.

## Considered alternatives

- **Keep the name match + cast.** Rejected — couples the manager to one concrete
  provider and blocks a second leased provider without editing the loop.
- **A separate `LeasedTunnelProvider` sub-interface + `instanceof`.** Rejected —
  heavier than the existing optional-method idiom (`toggleAccess?`) and adds a
  second way to express "not all providers support this".

## Consequences

- The seam is now real: `tunnelManager.test.ts` proves the manager renews a
  differently-named leased provider and arms no renewal timer when none declares
  the capability — the test could not be written against the old name-matched
  code without naming a provider `"upnp"`.

## Affected

`packages/happy-cli/src/tunnel/types.ts`,
`packages/happy-cli/src/tunnel/tunnelManager.ts`,
`packages/happy-cli/src/tunnel/tunnelManager.test.ts`.
