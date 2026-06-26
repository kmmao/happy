import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TunnelManager } from "./tunnelManager";
import type { TunnelProvider } from "./types";

const LEASE_RENEWAL_INTERVAL_MS = 30 * 60 * 1000;

/** Minimal provider with no expiring leases (omits renewLeases). */
function permanentProvider(name: string): TunnelProvider {
  return {
    name,
    detect: vi.fn(async () => ({ name, available: false, entries: [] }) as any),
    add: vi.fn(async () => ({ success: true })),
    remove: vi.fn(async () => ({ success: true })),
  };
}

/** Provider that declares the lease-renewal capability. */
function leasedProvider(name: string): TunnelProvider & { renewLeases: ReturnType<typeof vi.fn> } {
  return {
    name,
    detect: vi.fn(async () => ({ name, available: false, entries: [] }) as any),
    add: vi.fn(async () => ({ success: true })),
    remove: vi.fn(async () => ({ success: true })),
    renewLeases: vi.fn(async () => {}),
  };
}

describe("TunnelManager lease renewal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renews any provider that declares renewLeases, regardless of its name", async () => {
    // The capability is part of the interface — the manager must not key off
    // a provider name like "upnp". Use a differently-named leased provider.
    const leased = leasedProvider("cloudflare");
    const permanent = permanentProvider("tailscale");
    const manager = new TunnelManager([permanent, leased]);

    manager.startRefresh(() => {});
    await vi.advanceTimersByTimeAsync(LEASE_RENEWAL_INTERVAL_MS + 1);

    expect(leased.renewLeases).toHaveBeenCalledTimes(1);
    manager.stopRefresh();
  });

  it("starts no renewal timer when no provider declares the capability", async () => {
    const manager = new TunnelManager([permanentProvider("tailscale")]);
    const setInterval = vi.spyOn(globalThis, "setInterval");

    manager.startRefresh(() => {});
    // Only the refresh timer should be armed, never a lease-renewal timer.
    expect(setInterval).toHaveBeenCalledTimes(1);
    manager.stopRefresh();
  });

  it("isolates a throwing provider so others still renew", async () => {
    const bad = leasedProvider("bad");
    bad.renewLeases.mockRejectedValue(new Error("boom"));
    const good = leasedProvider("good");
    const manager = new TunnelManager([bad, good]);

    manager.startRefresh(() => {});
    await vi.advanceTimersByTimeAsync(LEASE_RENEWAL_INTERVAL_MS + 1);

    expect(bad.renewLeases).toHaveBeenCalledTimes(1);
    expect(good.renewLeases).toHaveBeenCalledTimes(1);
    manager.stopRefresh();
  });
});
