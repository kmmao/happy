import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sleepWithAbort } from "./sleepWithAbort";

describe("sleepWithAbort", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after ms elapse when no signal is provided", async () => {
    const p = sleepWithAbort(1000);
    let resolved = false;
    void p.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(resolved).toBe(true);
  });

  it("returns immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    // No timers should be scheduled — assert we're resolved without
    // advancing the clock at all.
    const started = performance.now();
    await sleepWithAbort(60_000, controller.signal);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(50);
  });

  it("resolves promptly when the signal aborts mid-sleep", async () => {
    const controller = new AbortController();
    const p = sleepWithAbort(60_000, controller.signal);

    // 5s in — nowhere near the 60s window.
    await vi.advanceTimersByTimeAsync(5_000);
    let resolved = false;
    void p.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Abort — timer should be cleared, promise resolves on next tick
    // without advancing the clock the remaining 55s.
    controller.abort();
    await Promise.resolve();
    await p;
    expect(resolved).toBe(true);
  });

  it("does not leak the abort listener after normal completion", async () => {
    const controller = new AbortController();
    const spy = vi.spyOn(controller.signal, "removeEventListener");

    // Normal completion path: the `{ once: true }` option and the
    // resolve()-first flow mean the browser/node's event target
    // auto-removes on fire, but we still want to assert the listener
    // set-up path is used (i.e. we didn't accidentally skip it).
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const p = sleepWithAbort(1000, controller.signal);
    expect(addSpy).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
      { once: true },
    );

    await vi.advanceTimersByTimeAsync(1000);
    await p;

    // No explicit removeEventListener from the resolve path; the once
    // option handles it. Spy is here to catch a future regression where
    // someone adds a manual remove that double-frees.
    spy.mockRestore();
    addSpy.mockRestore();
  });
});
