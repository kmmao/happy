import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  appLockController,
  appLockTimeoutMs,
  shouldLockOnColdStart,
  shouldRelockOnForeground,
} from "./appLockState";

describe("appLockTimeoutMs", () => {
  it("maps each timeout option to its background grace period", () => {
    expect(appLockTimeoutMs("immediate")).toBe(0);
    expect(appLockTimeoutMs("30s")).toBe(30_000);
    expect(appLockTimeoutMs("1m")).toBe(60_000);
    expect(appLockTimeoutMs("5m")).toBe(300_000);
    expect(appLockTimeoutMs("never")).toBe(Infinity);
  });
});

describe("shouldLockOnColdStart", () => {
  it("locks when the guard is active and the lock was enabled at launch", () => {
    expect(
      shouldLockOnColdStart({ guardActive: true, enabledAtMount: true }),
    ).toBe(true);
  });

  it("does not lock when enabled mid-session (off at launch)", () => {
    // Enabling right after setting a PIN must not instantly lock the user out.
    expect(
      shouldLockOnColdStart({ guardActive: true, enabledAtMount: false }),
    ).toBe(false);
  });

  it("does not lock while the guard is inactive (web / logged out / no PIN)", () => {
    expect(
      shouldLockOnColdStart({ guardActive: false, enabledAtMount: true }),
    ).toBe(false);
  });
});

describe("shouldRelockOnForeground", () => {
  const base = {
    guardActive: true as boolean,
    backgroundedAt: 1_000_000 as number | null,
    now: 1_000_000,
    timeout: "30s" as const,
  };

  it("does not lock when no background timestamp was recorded", () => {
    expect(
      shouldRelockOnForeground({ ...base, backgroundedAt: null }),
    ).toBe(false);
  });

  it("does not lock when the guard is inactive", () => {
    expect(
      shouldRelockOnForeground({
        ...base,
        guardActive: false,
        now: base.backgroundedAt! + 60_000,
      }),
    ).toBe(false);
  });

  it("immediate: locks even with zero elapsed background time", () => {
    expect(
      shouldRelockOnForeground({
        ...base,
        timeout: "immediate",
        now: base.backgroundedAt!,
      }),
    ).toBe(true);
  });

  it("30s: stays unlocked just below the threshold", () => {
    expect(
      shouldRelockOnForeground({
        ...base,
        now: base.backgroundedAt! + 29_999,
      }),
    ).toBe(false);
  });

  it("30s: re-locks exactly at the threshold (>=)", () => {
    expect(
      shouldRelockOnForeground({
        ...base,
        now: base.backgroundedAt! + 30_000,
      }),
    ).toBe(true);
  });

  it("30s: re-locks past the threshold", () => {
    expect(
      shouldRelockOnForeground({
        ...base,
        now: base.backgroundedAt! + 30_001,
      }),
    ).toBe(true);
  });

  it("never: never re-locks from the background, even after a long absence", () => {
    expect(
      shouldRelockOnForeground({
        ...base,
        timeout: "never",
        now: base.backgroundedAt! + 24 * 60 * 60 * 1000,
      }),
    ).toBe(false);
  });
});

describe("appLockController", () => {
  beforeEach(() => {
    appLockController.unlock();
  });

  it("starts unlocked", () => {
    expect(appLockController.isLocked()).toBe(false);
  });

  it("lock() / unlock() flip the state", () => {
    appLockController.lock();
    expect(appLockController.isLocked()).toBe(true);
    appLockController.unlock();
    expect(appLockController.isLocked()).toBe(false);
  });

  it("notifies subscribers only on an actual state change", () => {
    const listener = vi.fn();
    const unsub = appLockController.subscribe(listener);

    appLockController.lock();
    expect(listener).toHaveBeenCalledTimes(1);

    // Idempotent: locking again while locked must not emit.
    appLockController.lock();
    expect(listener).toHaveBeenCalledTimes(1);

    appLockController.unlock();
    expect(listener).toHaveBeenCalledTimes(2);

    // Idempotent: unlocking again while unlocked must not emit.
    appLockController.unlock();
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsub = appLockController.subscribe(listener);
    unsub();

    appLockController.lock();
    expect(listener).not.toHaveBeenCalled();
  });
});
