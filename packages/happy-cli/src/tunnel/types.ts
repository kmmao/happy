/**
 * Tunnel Provider abstraction — unified interface for all tunnel backends.
 *
 * Each provider (Tailscale, UPnP, Cloudflare, FRP, etc.) implements this
 * interface. TunnelManager aggregates all providers and exposes a single API.
 */

import type { TunnelProviderInfo, TunnelEntry } from "@kmmao/happy-wire";

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Operation params & result
// ---------------------------------------------------------------------------

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
