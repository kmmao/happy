import { describe, it, expect, vi } from "vitest";
import { MessageQueue2 } from "@/utils/MessageQueue2";
import { PushableAsyncIterable } from "@/utils/PushableAsyncIterable";
import { drainMidTurnMessages, MidTurnDrainCallbacks } from "./midTurnDrain";
import { hashObject } from "@/utils/deterministicJson";

interface TestMode {
  permissionMode: string;
  model?: string;
  thinking?: string;
  effort?: string;
}

const modeHasher = (mode: TestMode) => hashObject(mode);
// Mirror the real coldModeHash from claudeRemoteLauncher:
// only isPlan, isBypass, thinking, effort trigger cold restarts.
// permissionMode changes between non-plan/non-bypass modes are hot-swappable.
const coldHasher = (mode: TestMode) =>
  hashObject({
    isPlan: mode.permissionMode === "plan",
    isBypass: mode.permissionMode === "bypassPermissions",
    thinking: mode.thinking,
    effort: mode.effort,
  });

function makeCallbacks(overrides?: Partial<MidTurnDrainCallbacks<TestMode>>) {
  const pushed: Array<{ message: string; mode: TestMode }> = [];
  const shellResults: string[] = [];
  let currentMode: TestMode | null = null;

  const callbacks: MidTurnDrainCallbacks<TestMode> = {
    onInterrupt: overrides?.onInterrupt ?? vi.fn(async () => {}),
    onPush:
      overrides?.onPush ?? ((msg, mode) => pushed.push({ message: msg, mode })),
    onShellResult:
      overrides?.onShellResult ?? ((output) => shellResults.push(output)),
    onModelSwap: overrides?.onModelSwap ?? vi.fn(async () => {}),
    onPermissionModeSwap:
      overrides?.onPermissionModeSwap ?? vi.fn(async () => {}),
    getCurrentMode: overrides?.getCurrentMode ?? (() => currentMode),
    setCurrentMode:
      overrides?.setCurrentMode ??
      ((mode) => {
        currentMode = mode;
      }),
    cwd: overrides?.cwd ?? "/tmp",
  };

  return { callbacks, pushed, shellResults, getCurrentMode: () => currentMode };
}

describe("mid-turn message injection", () => {
  // ─── Test Case 1: Basic mid-turn injection ───
  describe("basic mid-turn injection", () => {
    it("should push message to SDK when cold hash matches", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const { callbacks, pushed } = makeCallbacks();

      const baseMode: TestMode = { permissionMode: "default", model: "opus" };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      // Start drain loop
      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      // Simulate user sending a mid-turn message with same cold hash
      queue.push("Use Express, not Fastify", {
        permissionMode: "default",
        model: "opus",
      });

      // Give the drain loop time to process
      await new Promise((r) => setTimeout(r, 20));

      // Stop the drain
      ac.abort();
      await drainPromise;

      expect(pushed).toHaveLength(1);
      expect(pushed[0].message).toBe("Use Express, not Fastify");
      expect(pushed[0].mode.model).toBe("opus");
    });

    it("should not consume message from queue — it is taken via tryTakeForMidTurn", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const { callbacks, pushed } = makeCallbacks();

      const baseMode: TestMode = { permissionMode: "default" };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      queue.push("hello", { permissionMode: "default" });
      await new Promise((r) => setTimeout(r, 20));

      ac.abort();
      await drainPromise;

      // Message was taken by tryTakeForMidTurn, not left in queue
      expect(queue.size()).toBe(0);
      expect(pushed).toHaveLength(1);
    });
  });

  // ─── Test Case 2: Multiple appended messages ───
  describe("multiple appended messages", () => {
    it("should process multiple messages in order", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const { callbacks, pushed } = makeCallbacks();

      const baseMode: TestMode = { permissionMode: "default" };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      // Push 3 messages in sequence
      queue.push("msg 1", { permissionMode: "default" });
      await new Promise((r) => setTimeout(r, 15));
      queue.push("msg 2", { permissionMode: "default" });
      await new Promise((r) => setTimeout(r, 15));
      queue.push("msg 3", { permissionMode: "default" });
      await new Promise((r) => setTimeout(r, 15));

      ac.abort();
      await drainPromise;

      expect(pushed).toHaveLength(3);
      expect(pushed[0].message).toBe("msg 1");
      expect(pushed[1].message).toBe("msg 2");
      expect(pushed[2].message).toBe("msg 3");
    });
  });

  // ─── Test Case 3: Model hot-swap ───
  describe("model hot-swap during mid-turn", () => {
    it("should call onModelSwap when model changes", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const onModelSwap = vi.fn(async () => {});
      const { callbacks, pushed } = makeCallbacks({ onModelSwap });

      const baseMode: TestMode = { permissionMode: "default", model: "opus" };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      // Push message with different model but same cold hash
      queue.push("switch to sonnet", {
        permissionMode: "default",
        model: "sonnet",
      });
      await new Promise((r) => setTimeout(r, 20));

      ac.abort();
      await drainPromise;

      expect(onModelSwap).toHaveBeenCalledWith("opus", "sonnet");
      expect(pushed).toHaveLength(1);
      expect(pushed[0].message).toBe("switch to sonnet");
    });

    it("should not call onModelSwap when model is the same", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const onModelSwap = vi.fn(async () => {});
      const { callbacks, pushed } = makeCallbacks({ onModelSwap });

      const baseMode: TestMode = { permissionMode: "default", model: "opus" };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      queue.push("same model", { permissionMode: "default", model: "opus" });
      await new Promise((r) => setTimeout(r, 20));

      ac.abort();
      await drainPromise;

      expect(onModelSwap).not.toHaveBeenCalled();
      expect(pushed).toHaveLength(1);
    });
  });

  // ─── Test Case 4: Isolate command triggers interrupt ───
  describe("isolate command interrupt", () => {
    it("should interrupt current turn when isolate message is detected", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const onInterrupt = vi.fn(async () => {});
      const { callbacks, pushed } = makeCallbacks({ onInterrupt });

      const baseMode: TestMode = { permissionMode: "default" };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      // Push an isolate message (like /compact)
      queue.pushIsolateAndClear("/compact", { permissionMode: "default" });
      await new Promise((r) => setTimeout(r, 20));

      ac.abort();
      await drainPromise;

      // Should call interrupt, NOT push
      expect(onInterrupt).toHaveBeenCalledOnce();
      expect(pushed).toHaveLength(0);
      // The isolate message should remain in the queue for nextMessage() to handle
      expect(queue.size()).toBe(1);
    });

    it("should not push isolate messages to SDK", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const { callbacks, pushed } = makeCallbacks();

      const baseMode: TestMode = { permissionMode: "default" };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      queue.pushIsolateAndClear("/clear", { permissionMode: "default" });
      await new Promise((r) => setTimeout(r, 20));

      ac.abort();
      await drainPromise;

      // Isolate message should NOT be pushed
      expect(pushed).toHaveLength(0);
    });
  });

  // ─── Test Case 5: Cold hash mismatch defers to nextMessage() ───
  describe("cold hash mismatch", () => {
    it("should stop draining when cold hash changes", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const onInterrupt = vi.fn(async () => {});
      const { callbacks, pushed } = makeCallbacks({ onInterrupt });

      const baseMode: TestMode = {
        permissionMode: "default",
        thinking: "adaptive",
      };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      // Push message with different cold config (thinking changed)
      queue.push("change thinking", {
        permissionMode: "default",
        thinking: "enabled",
      });
      await new Promise((r) => setTimeout(r, 20));

      ac.abort();
      await drainPromise;

      // Should NOT push — cold hash mismatch means wait for next turn
      expect(pushed).toHaveLength(0);
      // Should NOT interrupt — not an isolate
      expect(onInterrupt).not.toHaveBeenCalled();
      // Message stays in queue for nextMessage()
      expect(queue.size()).toBe(1);
    });

    it("should stop draining when effort level changes", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const { callbacks, pushed } = makeCallbacks();

      const baseMode: TestMode = {
        permissionMode: "default",
        effort: "medium",
      };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      queue.push("max effort please", {
        permissionMode: "default",
        effort: "max",
      });
      await new Promise((r) => setTimeout(r, 20));

      ac.abort();
      await drainPromise;

      expect(pushed).toHaveLength(0);
      expect(queue.size()).toBe(1);
    });
  });

  // ─── PushableAsyncIterable integration ───
  describe("PushableAsyncIterable integration", () => {
    it("should push messages to PushableAsyncIterable for SDK consumption", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const messages = new PushableAsyncIterable<{
        type: string;
        content: string;
      }>();
      const { callbacks } = makeCallbacks({
        onPush: (msg, _mode) => {
          messages.push({ type: "user", content: msg });
        },
      });

      const baseMode: TestMode = { permissionMode: "default" };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      // Push a mid-turn message
      queue.push("inject this", { permissionMode: "default" });
      await new Promise((r) => setTimeout(r, 20));

      ac.abort();
      await drainPromise;

      // Verify the PushableAsyncIterable received the message
      expect(messages.queueSize).toBe(1);
      const result = await messages.next();
      expect(result.done).toBe(false);
      expect(result.value).toEqual({ type: "user", content: "inject this" });
    });
  });

  // ─── Permission mode hot-swap ───
  describe("permission mode hot-swap", () => {
    it("should call onPermissionModeSwap when permission mode changes within same cold hash", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const onPermissionModeSwap = vi.fn(async () => {});
      const { callbacks, pushed } = makeCallbacks({ onPermissionModeSwap });

      // Both "default" and "acceptEdits" are non-plan, non-bypass → same cold hash
      const baseMode: TestMode = { permissionMode: "default" };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      queue.push("accept edits now", { permissionMode: "acceptEdits" });
      await new Promise((r) => setTimeout(r, 20));

      ac.abort();
      await drainPromise;

      expect(onPermissionModeSwap).toHaveBeenCalledWith(
        "default",
        "acceptEdits",
      );
      expect(pushed).toHaveLength(1);
    });
  });

  // ─── Abort signal handling ───
  describe("abort signal handling", () => {
    it("should stop immediately when signal is already aborted", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      ac.abort(); // Pre-abort

      const { callbacks, pushed } = makeCallbacks();
      const coldHash = coldHasher({ permissionMode: "default" });

      queue.push("should not be processed", { permissionMode: "default" });

      await drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      expect(pushed).toHaveLength(0);
    });

    it("should stop processing when aborted mid-drain", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const { callbacks, pushed } = makeCallbacks();

      const baseMode: TestMode = { permissionMode: "default" };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      // Push one message, then abort
      queue.push("first", { permissionMode: "default" });
      await new Promise((r) => setTimeout(r, 15));
      ac.abort();
      await drainPromise;

      // Only the first message should be processed
      expect(pushed).toHaveLength(1);
      expect(pushed[0].message).toBe("first");
    });
  });

  // ─── Mode state tracking ───
  describe("mode state tracking", () => {
    it("should update current mode after each mid-turn push", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const modeUpdates: TestMode[] = [];
      const { callbacks, pushed } = makeCallbacks({
        setCurrentMode: (mode) => {
          modeUpdates.push(mode);
        },
      });

      const baseMode: TestMode = { permissionMode: "default", model: "opus" };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      queue.push("msg1", { permissionMode: "default", model: "sonnet" });
      await new Promise((r) => setTimeout(r, 15));
      queue.push("msg2", { permissionMode: "default", model: "haiku" });
      await new Promise((r) => setTimeout(r, 15));

      ac.abort();
      await drainPromise;

      expect(modeUpdates).toHaveLength(2);
      expect(modeUpdates[0].model).toBe("sonnet");
      expect(modeUpdates[1].model).toBe("haiku");
    });
  });

  // ─── Queue-level tryTakeForMidTurn edge cases ───
  describe("MessageQueue2 mid-turn edge cases", () => {
    it("should handle regular message followed by isolate message", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);
      const ac = new AbortController();
      const onInterrupt = vi.fn(async () => {});
      const { callbacks, pushed } = makeCallbacks({ onInterrupt });

      const baseMode: TestMode = { permissionMode: "default" };
      const coldHash = coldHasher(baseMode);
      callbacks.getCurrentMode = () => baseMode;

      const drainPromise = drainMidTurnMessages(
        queue,
        ac.signal,
        coldHash,
        coldHasher,
        callbacks,
      );

      // Push regular message first, then isolate
      queue.push("regular msg", { permissionMode: "default" });
      await new Promise((r) => setTimeout(r, 15));

      queue.pushIsolateAndClear("/compact", { permissionMode: "default" });
      await new Promise((r) => setTimeout(r, 20));

      ac.abort();
      await drainPromise;

      // Regular message should have been pushed
      expect(pushed).toHaveLength(1);
      expect(pushed[0].message).toBe("regular msg");

      // Isolate should trigger interrupt
      expect(onInterrupt).toHaveBeenCalledOnce();
    });

    it("should take multiple messages with same cold hash sequentially", () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);

      // Same cold hash, different full hash (model differs)
      queue.push("msg1", { permissionMode: "default", model: "opus" });
      queue.push("msg2", { permissionMode: "default", model: "sonnet" });
      queue.push("msg3", { permissionMode: "default", model: "haiku" });

      const coldHash = coldHasher({ permissionMode: "default" });

      const r1 = queue.tryTakeForMidTurn(coldHash, coldHasher);
      expect(r1?.message).toBe("msg1");

      const r2 = queue.tryTakeForMidTurn(coldHash, coldHasher);
      expect(r2?.message).toBe("msg2");

      const r3 = queue.tryTakeForMidTurn(coldHash, coldHasher);
      expect(r3?.message).toBe("msg3");

      expect(queue.size()).toBe(0);
    });

    it("should reject message when plan mode changes (cold hash change)", () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);

      // Plan mode is part of cold hash
      queue.push("enter plan", { permissionMode: "plan" });

      const coldHash = coldHasher({ permissionMode: "default" });
      const result = queue.tryTakeForMidTurn(coldHash, coldHasher);

      expect(result).toBeNull();
      expect(queue.size()).toBe(1);
    });

    it("should waitForNewMessage resolve when message is pushed during wait", async () => {
      const queue = new MessageQueue2<TestMode>(modeHasher);

      const waitPromise = queue.waitForNewMessage();

      // Push after a short delay
      setTimeout(() => {
        queue.push("delayed", { permissionMode: "default" });
      }, 10);

      const result = await waitPromise;
      expect(result).toBe(true);
      // Message is NOT consumed by waitForNewMessage
      expect(queue.size()).toBe(1);
    });
  });
});
