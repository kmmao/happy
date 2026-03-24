/**
 * TunnelManager — aggregates all tunnel providers and provides a single API.
 *
 * The daemon creates one TunnelManager instance at startup, which:
 * - Runs detect() on all providers in parallel
 * - Exposes the aggregated TunnelState for DaemonState
 * - Provides add/remove/toggleAccess by routing to the correct provider
 * - Supports periodic refresh with onChange callback
 */

import type { TunnelState, TunnelEntry } from "@kmmao/happy-wire";
import type { TunnelProvider, TunnelAddParams, TunnelRemoveParams, TunnelOpResult } from "./types";
import { logger } from "@/ui/logger";

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const DETECT_TIMEOUT_MS = 5_000;

export class TunnelManager {
  private readonly providers: TunnelProvider[];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastState: TunnelState = { providers: [] };

  constructor(providers: TunnelProvider[]) {
    this.providers = providers;
  }

  /** Detect all providers in parallel. Never throws. */
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

    const providers = results
      .filter((r) => r !== null)
      .map((r) => r!);

    this.lastState = { providers };
    return this.lastState;
  }

  /** Get the last detected state without re-scanning */
  getLastState(): TunnelState {
    return this.lastState;
  }

  /** Get a specific provider by name */
  getProvider(name: string): TunnelProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }

  /** Add a tunnel via a specific provider */
  async add(providerName: string, params: TunnelAddParams): Promise<TunnelOpResult> {
    const provider = this.getProvider(providerName);
    if (!provider) return { success: false, error: `Unknown provider: ${providerName}` };
    return provider.add(params);
  }

  /** Remove a tunnel via a specific provider */
  async remove(providerName: string, params: TunnelRemoveParams): Promise<TunnelOpResult> {
    const provider = this.getProvider(providerName);
    if (!provider) return { success: false, error: `Unknown provider: ${providerName}` };
    return provider.remove(params);
  }

  /** Toggle public/private access */
  async toggleAccess(providerName: string, entry: TunnelEntry, publicAccess: boolean): Promise<TunnelOpResult> {
    const provider = this.getProvider(providerName);
    if (!provider) return { success: false, error: `Unknown provider: ${providerName}` };
    if (!provider.toggleAccess) return { success: false, error: `${providerName} does not support access toggling` };
    return provider.toggleAccess(entry, publicAccess);
  }

  /** Start periodic refresh. Calls onChange when state changes. */
  startRefresh(onChange: (state: TunnelState) => void, intervalMs = DEFAULT_REFRESH_INTERVAL_MS): void {
    this.stopRefresh();
    this.refreshTimer = setInterval(async () => {
      const prev = JSON.stringify(this.lastState);
      const next = await this.detectAll();
      if (JSON.stringify(next) !== prev) {
        onChange(next);
      }
    }, intervalMs);
  }

  /** Stop periodic refresh */
  stopRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
