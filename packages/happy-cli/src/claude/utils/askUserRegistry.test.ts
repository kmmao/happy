import { describe, it, expect, vi, afterEach } from "vitest";
import { createAskUserRegistry } from "./askUserRegistry";

afterEach(() => {
  vi.useRealTimers();
});

describe("askUserRegistry", () => {
  it("resolve() settles the awaited promise with the answers and clears the entry", async () => {
    const r = createAskUserRegistry();
    const p = r.register("a1", 60_000);
    expect(r.size).toBe(1);

    expect(r.resolve("a1", { q: "yes" })).toBe(true);
    await expect(p).resolves.toEqual({ q: "yes" });
    expect(r.size).toBe(0);
  });

  it("reject() settles the awaited promise as a rejection", async () => {
    const r = createAskUserRegistry();
    const p = r.register("a1", 60_000);

    expect(r.reject("a1", "User declined to answer this question")).toBe(true);
    await expect(p).rejects.toThrow("User declined to answer this question");
    expect(r.size).toBe(0);
  });

  it("resolve/reject on an unknown or already-settled id returns false", async () => {
    const r = createAskUserRegistry();
    expect(r.resolve("nope", {})).toBe(false);
    expect(r.reject("nope", "x")).toBe(false);

    const p = r.register("a1", 60_000);
    expect(r.resolve("a1", {})).toBe(true);
    await p;
    // Second settle is a no-op.
    expect(r.resolve("a1", {})).toBe(false);
    expect(r.reject("a1", "late")).toBe(false);
  });

  it("rejects with a minutes-formatted timeout message after timeoutMs", async () => {
    vi.useFakeTimers();
    const r = createAskUserRegistry();
    const p = r.register("a1", 30 * 60 * 1000);
    const assertion = expect(p).rejects.toThrow(
      "ask_user timed out after 30 minutes with no response from user",
    );
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    await assertion;
    expect(r.size).toBe(0);
  });

  it("resolving before the timeout cancels the timer (no late rejection)", async () => {
    vi.useFakeTimers();
    const r = createAskUserRegistry();
    const p = r.register("a1", 60_000);
    r.resolve("a1", { q: "answered" });
    await expect(p).resolves.toEqual({ q: "answered" });
    // Advancing past the timeout must not throw (timer was cleared).
    await vi.advanceTimersByTimeAsync(120_000);
    expect(r.size).toBe(0);
  });

  it("rejectAll() rejects every surviving entry", async () => {
    const r = createAskUserRegistry();
    const p1 = r.register("a1", 60_000);
    const p2 = r.register("a2", 60_000);
    expect(r.size).toBe(2);

    r.rejectAll("Happy MCP server stopped");
    await expect(p1).rejects.toThrow("Happy MCP server stopped");
    await expect(p2).rejects.toThrow("Happy MCP server stopped");
    expect(r.size).toBe(0);
  });
});
