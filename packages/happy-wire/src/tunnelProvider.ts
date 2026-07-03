/**
 * Tunnel Provider contract — the single interface every tunnel backend
 * (Tailscale, UPnP, Cloudflare, FRP, …) implements, shared by happy-cli and
 * happy-agent so the two TunnelManagers type-check against the SAME contract.
 *
 * History: both packages used to hand-copy this interface. The copies
 * drifted — the CLI added `renewLeases?` (ADR-0045: capabilities live in the
 * interface, discovered structurally) while the agent's copy did not, so the
 * agent's UPnP lease renewal compiled only via a name-match + cast, exactly
 * the leaky seam ADR-0045 forbids. Per ADR-0035's rule ("keep copies until
 * they drift; drift is the trigger to extract"), the drift moved the
 * contract here. Pure types only — no timers, no sockets — so it respects
 * wire's pure-types invariant.
 *
 * ADR-0045 rule (restated): a capability only some providers support is an
 * OPTIONAL METHOD on this interface; managers discover it structurally
 * (`typeof p.cap === "function"`) and must never match a provider by name
 * and cast to a concrete class.
 */

import type { TunnelProviderInfo, TunnelEntry } from "./machineTypes";

export interface TunnelProvider {
  /** Unique provider name: "tailscale" | "upnp" | "cloudflare" | "frp" */
  readonly name: string;

  /** Detect provider availability and list current tunnel entries. Never throws. */
  detect(): Promise<TunnelProviderInfo>;

  /** Add a tunnel mapping */
  add(params: TunnelAddParams): Promise<TunnelOpResult>;

  /** Remove a tunnel mapping */
  remove(params: TunnelRemoveParams): Promise<TunnelOpResult>;

  /** Toggle public/private access (not all providers support this) */
  toggleAccess?(entry: TunnelEntry, publicAccess: boolean): Promise<TunnelOpResult>;

  /**
   * Renew time-limited tunnel leases (not all providers support this).
   * Providers whose mappings expire — e.g. UPnP port mappings — declare this
   * so TunnelManager renews them periodically. Providers with permanent
   * mappings omit it. Should never throw; the manager logs and continues.
   */
  renewLeases?(): Promise<void>;
}

export interface TunnelAddParams {
  localPort: number;
  remotePort?: number;
  protocol?: string;
  path?: string;
  publicAccess?: boolean;
  hostname?: string;
}

export interface TunnelRemoveParams {
  localPort?: number;
  remotePort?: number;
  path?: string;
  hostname?: string;
  /** Remove entire site (all routes for this hostname) */
  removeEntireSite?: boolean;
}

export interface TunnelOpResult {
  success: boolean;
  error?: string;
}
