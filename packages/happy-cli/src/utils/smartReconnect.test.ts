import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSmartReconnect } from "./smartReconnect";

describe("createSmartReconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reconnects after the short delay once the gate is met", async () => {
    const connect = vi.fn();
    const gate = vi.fn(async () => true);
    const handle = createSmartReconnect({
      connect,
      shouldReconnect: gate,
      pollIntervalMs: 5000,
      reconnectDelayMs: 1000,
    });

    handle.schedule();
    await vi.advanceTimersByTimeAsync(1);
    // Gate is met but the short reconnect delay has not elapsed yet.
    expect(connect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("polls at the fixed interval while the gate is unmet, then recovers", async () => {
    const connect = vi.fn();
    let gateValue = false;
    const gate = vi.fn(async () => gateValue);
    const handle = createSmartReconnect({
      connect,
      shouldReconnect: gate,
      pollIntervalMs: 5000,
      reconnectDelayMs: 1000,
    });

    handle.schedule();
    await vi.advanceTimersByTimeAsync(1);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();

    // Still unmet — another poll cycle, still no reconnect.
    await vi.advanceTimersByTimeAsync(5000);
    expect(gate).toHaveBeenCalledTimes(2);
    expect(connect).not.toHaveBeenCalled();

    // Lid reopens: the next poll cycle reconnects.
    gateValue = true;
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("stops polling when cancelled", async () => {
    const connect = vi.fn();
    const gate = vi.fn(async () => false);
    const handle = createSmartReconnect({
      connect,
      shouldReconnect: gate,
      pollIntervalMs: 5000,
      reconnectDelayMs: 1000,
    });

    handle.schedule();
    await vi.advanceTimersByTimeAsync(1);
    expect(gate).toHaveBeenCalledTimes(1);

    handle.cancel();
    await vi.advanceTimersByTimeAsync(60_000);
    // No further polls or reconnects after cancel (mirrors a successful connect).
    expect(gate).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
  });

  it("re-arms after a reconnect attempt so the next disconnect reconnects again", async () => {
    const connect = vi.fn();
    const gate = vi.fn(async () => true);
    const handle = createSmartReconnect({
      connect,
      shouldReconnect: gate,
      pollIntervalMs: 5000,
      reconnectDelayMs: 1000,
    });

    handle.schedule();
    await vi.advanceTimersByTimeAsync(1001);
    expect(connect).toHaveBeenCalledTimes(1);

    // A later disconnect must be able to start a fresh cycle.
    handle.schedule();
    await vi.advanceTimersByTimeAsync(1001);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("never reconnects again after shutdown", async () => {
    const connect = vi.fn();
    const gate = vi.fn(async () => true);
    const handle = createSmartReconnect({
      connect,
      shouldReconnect: gate,
      reconnectDelayMs: 1000,
    });

    handle.shutdown();
    handle.schedule();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(connect).not.toHaveBeenCalled();
  });

  it("ignores duplicate schedule calls while a cycle is already running", async () => {
    const connect = vi.fn();
    const gate = vi.fn(async () => false);
    const handle = createSmartReconnect({
      connect,
      shouldReconnect: gate,
      pollIntervalMs: 5000,
    });

    handle.schedule();
    handle.schedule();
    handle.schedule();
    await vi.advanceTimersByTimeAsync(1);
    // Only a single cycle runs despite repeated schedule() calls.
    expect(gate).toHaveBeenCalledTimes(1);
  });
});
