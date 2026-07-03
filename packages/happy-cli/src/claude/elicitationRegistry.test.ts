import { describe, it, expect, vi } from "vitest";
import { createElicitationRegistry } from "./elicitationRegistry";
import type { ElicitationRequest } from "./jsonl/types";

function makeRegistry() {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const log = vi.fn();
  const registry = createElicitationRegistry({ onOpen, onClose, log });
  return { registry, onOpen, onClose, log };
}

const request = {
  mcpServerName: "test-server",
  message: "Need input",
} as ElicitationRequest;

describe("elicitationRegistry", () => {
  it("open surfaces the elicitation with a monotonic id and tracks it as pending", () => {
    const { registry, onOpen } = makeRegistry();
    const controller = new AbortController();

    void registry.open(request, { signal: controller.signal });
    void registry.open(request, { signal: controller.signal });

    expect(onOpen).toHaveBeenNthCalledWith(1, "elicit-1", request);
    expect(onOpen).toHaveBeenNthCalledWith(2, "elicit-2", request);
    expect(registry.size()).toBe(2);
  });

  it("settle resolves the pending promise, clears the banner, and removes the entry", async () => {
    const { registry, onClose } = makeRegistry();
    const controller = new AbortController();

    const result = registry.open(request, { signal: controller.signal });
    const settled = registry.settle({
      id: "elicit-1",
      action: "accept",
      content: { answer: 42 },
    });

    expect(settled).toBe(true);
    await expect(result).resolves.toEqual({ action: "accept", content: { answer: 42 } });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(0);
  });

  it("ignores an unknown id — no banner clear, pending set unchanged", () => {
    const { registry, onClose, log } = makeRegistry();
    const controller = new AbortController();
    void registry.open(request, { signal: controller.signal });

    expect(registry.settle({ id: "elicit-99", action: "accept" })).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(registry.size()).toBe(1);
    expect(log).toHaveBeenCalledWith(
      "[remote]: elicitationResponse for unknown id elicit-99",
    );
  });

  it("ignores an invalid action — the elicitation stays pending and can still settle", async () => {
    const { registry, onClose } = makeRegistry();
    const controller = new AbortController();
    const result = registry.open(request, { signal: controller.signal });

    expect(registry.settle({ id: "elicit-1", action: "explode" })).toBe(false);
    expect(registry.size()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();

    expect(registry.settle({ id: "elicit-1", action: "decline" })).toBe(true);
    await expect(result).resolves.toEqual({ action: "decline", content: undefined });
  });

  it("abort rejects the pending promise, clears the banner, and removes the entry", async () => {
    const { registry, onClose } = makeRegistry();
    const controller = new AbortController();
    const result = registry.open(request, { signal: controller.signal });

    controller.abort();

    await expect(result).rejects.toThrow("Elicitation aborted");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(0);
  });

  it("an abort after settle is a no-op — the listener was removed", async () => {
    const { registry, onClose } = makeRegistry();
    const controller = new AbortController();
    const result = registry.open(request, { signal: controller.signal });

    registry.settle({ id: "elicit-1", action: "cancel" });
    await result;
    controller.abort();

    // Only the settle path fired onClose; the abort path did not double-fire.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(0);
  });

  it("drainAll rejects everything without touching the banner (session teardown)", async () => {
    const { registry, onClose } = makeRegistry();
    const controller = new AbortController();
    const a = registry.open(request, { signal: controller.signal });
    const b = registry.open(request, { signal: controller.signal });

    registry.drainAll(new Error("Session ended"));

    await expect(a).rejects.toThrow("Session ended");
    await expect(b).rejects.toThrow("Session ended");
    expect(onClose).not.toHaveBeenCalled();
    expect(registry.size()).toBe(0);
  });

  it("a settle after drainAll is ignored", async () => {
    const { registry } = makeRegistry();
    const controller = new AbortController();
    const result = registry.open(request, { signal: controller.signal });
    registry.drainAll(new Error("Session ended"));
    await expect(result).rejects.toThrow("Session ended");

    expect(registry.settle({ id: "elicit-1", action: "accept" })).toBe(false);
  });
});
