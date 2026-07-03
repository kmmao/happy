/**
 * TunnelManager for happy-agent — aggregates all tunnel providers.
 */

import type { TunnelState, TunnelEntry } from "@kmmao/happy-wire";
import type { TunnelProvider, TunnelAddParams, TunnelRemoveParams, TunnelOpResult } from "./types";
import { logger } from "@/logger";

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const LEASE_RENEWAL_INTERVAL_MS = 30 * 60 * 1000;
const DETECT_TIMEOUT_MS = 5_000;

export class TunnelManager {
  private readonly providers: TunnelProvider[];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private leaseRenewalTimer: ReturnType<typeof setInterval> | null = null;
  private lastState: TunnelState = { providers: [] };

  constructor(providers: TunnelProvider[]) {
    this.providers = providers;
  }

  async detectAll(): Promise<TunnelState> {
    const results = await Promise.all(
      this.providers.map((p) =>
        Promise.race([
          p.detect(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), DETECT_TIMEOUT_MS)),
        ]).catch((err) => {
          logger.debug(`[TUNNEL] detect failed for ${p.name}: ${String(err)}`);
          return null;
        }),
      ),
    );
    const providers = results.filter((r) => r !== null).map((r) => r!);
    this.lastState = { providers };
    return this.lastState;
  }

  getLastState(): TunnelState { return this.lastState; }
  getProvider(name: string): TunnelProvider | undefined { return this.providers.find((p) => p.name === name); }

  async add(providerName: string, params: TunnelAddParams): Promise<TunnelOpResult> {
    const provider = this.getProvider(providerName);
    if (!provider) return { success: false, error: `Unknown provider: ${providerName}` };
    return provider.add(params);
  }

  async remove(providerName: string, params: TunnelRemoveParams): Promise<TunnelOpResult> {
    const provider = this.getProvider(providerName);
    if (!provider) return { success: false, error: `Unknown provider: ${providerName}` };
    return provider.remove(params);
  }

  async toggleAccess(providerName: string, entry: TunnelEntry, publicAccess: boolean): Promise<TunnelOpResult> {
    const provider = this.getProvider(providerName);
    if (!provider) return { success: false, error: `Unknown provider: ${providerName}` };
    if (!provider.toggleAccess) return { success: false, error: `${providerName} does not support access toggling` };
    return provider.toggleAccess(entry, publicAccess);
  }

  startRefresh(onChange: (state: TunnelState) => void, intervalMs = DEFAULT_REFRESH_INTERVAL_MS): void {
    this.stopRefresh();
    this.refreshTimer = setInterval(async () => {
      const prev = JSON.stringify(this.lastState);
      const next = await this.detectAll();
      if (JSON.stringify(next) !== prev) onChange(next);
    }, intervalMs);

    // Renew time-limited leases for any provider that declares the capability
    // (e.g. UPnP port mappings). ADR-0045: capabilities are discovered
    // structurally off the TunnelProvider interface — no provider-name match
    // or concrete-class cast.
    const renewables = this.providers.filter((p) => typeof p.renewLeases === "function");
    if (renewables.length > 0) {
      this.leaseRenewalTimer = setInterval(async () => {
        for (const provider of renewables) {
          try {
            await provider.renewLeases!();
          } catch (err) {
            logger.debug(`[TUNNEL] lease renewal failed for ${provider.name}: ${String(err)}`);
          }
        }
      }, LEASE_RENEWAL_INTERVAL_MS);
    }
  }

  stopRefresh(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    if (this.leaseRenewalTimer) { clearInterval(this.leaseRenewalTimer); this.leaseRenewalTimer = null; }
  }
}
