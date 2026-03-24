/**
 * Tunnel Provider abstraction — unified interface for all tunnel backends.
 */

import type { TunnelProviderInfo, TunnelEntry } from "@kmmao/happy-wire";

export interface TunnelProvider {
  readonly name: string;
  detect(): Promise<TunnelProviderInfo>;
  add(params: TunnelAddParams): Promise<TunnelOpResult>;
  remove(params: TunnelRemoveParams): Promise<TunnelOpResult>;
  toggleAccess?(entry: TunnelEntry, publicAccess: boolean): Promise<TunnelOpResult>;
}

export interface TunnelAddParams {
  localPort: number;
  remotePort?: number;
  protocol?: string;
  path?: string;
  publicAccess?: boolean;
}

export interface TunnelRemoveParams {
  localPort?: number;
  remotePort?: number;
  path?: string;
}

export interface TunnelOpResult {
  success: boolean;
  error?: string;
}
