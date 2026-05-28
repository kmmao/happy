import { describe, expect, it } from "vitest";
import { createSessionMessageProcessor } from "./sessionMessageProcessor";
import type { NormalizedMessage } from "./typesRaw";

// Drain the microtask queue and the AsyncLock's setTimeout(0) handoff.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let counter = 0;

function delta(text: string): NormalizedMessage {
  const id = `d${counter++}`;
  return {
    role: "agent",
    content: [
      {
        type: "text-delta",
        delta: text,
        streamId: "stream",
        uuid: id,
        parentUUID: null,
      },
    ],
    id,
    localId: null,
    createdAt: 0,
    isSidechain: false,
  };
}

function userText(text: string): NormalizedMessage {
  const id = `u${counter++}`;
  return {
    role: "user",
    content: { type: "text", text },
    id,
    localId: null,
    createdAt: 0,
    isSidechain: false,
  };
}

function makeHarness() {
  const applied: Array<{ sessionId: string; messages: NormalizedMessage[] }> =
    [];
  const liveFrames = new Map<number, () => void>();
  let nextHandle = 1;
  let requestFrameCalls = 0;
  let cancelFrameCalls = 0;

  const processor = createSessionMessageProcessor({
    applyMessages: (sessionId, messages) => {
      applied.push({ sessionId, messages });
    },
    requestFrame: (cb) => {
      requestFrameCalls++;
      const handle = nextHandle++;
      liveFrames.set(handle, cb);
      return handle;
    },
    cancelFrame: (handle) => {
      cancelFrameCalls++;
      liveFrames.delete(handle);
    },
  });

  return {
    processor,
    applied,
    get requestFrameCalls() {
      return requestFrameCalls;
    },
    get cancelFrameCalls() {
      return cancelFrameCalls;
    },
    liveFrameCount: () => liveFrames.size,
    fireFrames: () => {
      const cbs = [...liveFrames.values()];
      liveFrames.clear();
      for (const cb of cbs) cb();
    },
  };
}

// Flatten every applied batch into a single id sequence for ordering assertions.
const appliedIds = (
  applied: Array<{ sessionId: string; messages: NormalizedMessage[] }>,
) => applied.flatMap((b) => b.messages.map((m) => m.id));

describe("createSessionMessageProcessor", () => {
  it("flushes a non-delta message immediately without scheduling a frame", async () => {
    const h = makeHarness();
    const msg = userText("hi");

    h.processor.enqueue("s1", [msg]);
    expect(h.requestFrameCalls).toBe(0);

    await flush();
    expect(appliedIds(h.applied)).toEqual([msg.id]);
  });

  it("defers a pure text-delta batch to the next frame", async () => {
    const h = makeHarness();
    const d = delta("a");

    h.processor.enqueue("s1", [d]);
    // Nothing applied yet — waiting on the frame.
    await flush();
    expect(h.applied).toEqual([]);
    expect(h.liveFrameCount()).toBe(1);

    h.fireFrames();
    await flush();
    expect(appliedIds(h.applied)).toEqual([d.id]);
  });

  it("coalesces multiple delta enqueues into a single frame and batch", async () => {
    const h = makeHarness();
    const d1 = delta("a");
    const d2 = delta("b");

    h.processor.enqueue("s1", [d1]);
    h.processor.enqueue("s1", [d2]);
    // Only one frame scheduled for both deltas.
    expect(h.requestFrameCalls).toBe(1);
    expect(h.liveFrameCount()).toBe(1);

    h.fireFrames();
    await flush();
    // Both deltas drained together, in order, in one apply call.
    expect(h.applied).toHaveLength(1);
    expect(appliedIds(h.applied)).toEqual([d1.id, d2.id]);
  });

  it("a non-delta cancels the pending delta frame and drains both in FIFO order", async () => {
    const h = makeHarness();
    const d = delta("a");
    const u = userText("hi");

    h.processor.enqueue("s1", [d]); // schedules a frame
    expect(h.liveFrameCount()).toBe(1);

    h.processor.enqueue("s1", [u]); // cancels the frame, flushes now
    expect(h.cancelFrameCalls).toBe(1);
    expect(h.liveFrameCount()).toBe(0);

    await flush();
    // Queued delta + the non-delta drained together, delta first.
    expect(appliedIds(h.applied)).toEqual([d.id, u.id]);
  });

  it("ignores empty batches", async () => {
    const h = makeHarness();
    h.processor.enqueue("s1", []);
    await flush();
    expect(h.applied).toEqual([]);
    expect(h.requestFrameCalls).toBe(0);
  });

  it("preserves order and loses nothing across back-to-back enqueues", async () => {
    const h = makeHarness();
    const a = userText("a");
    const b = userText("b");
    const c = userText("c");

    h.processor.enqueue("s1", [a]);
    h.processor.enqueue("s1", [b]);
    h.processor.enqueue("s1", [c]);

    await flush();
    await flush();
    expect(appliedIds(h.applied)).toEqual([a.id, b.id, c.id]);
  });

  it("keeps batches isolated per session", async () => {
    const h = makeHarness();
    const a = userText("a");
    const b = userText("b");

    h.processor.enqueue("s1", [a]);
    h.processor.enqueue("s2", [b]);

    await flush();
    const s1 = h.applied.filter((x) => x.sessionId === "s1");
    const s2 = h.applied.filter((x) => x.sessionId === "s2");
    expect(appliedIds(s1)).toEqual([a.id]);
    expect(appliedIds(s2)).toEqual([b.id]);
  });

  describe("locks", () => {
    it("returns a stable lock per session and distinct locks across sessions", () => {
      const h = makeHarness();
      const l1 = h.processor.getLock("s1");
      expect(h.processor.getLock("s1")).toBe(l1);
      expect(h.processor.getLock("s2")).not.toBe(l1);
    });

    it("forget keeps the lock but drops the queue and pending frame", async () => {
      const h = makeHarness();
      const lock = h.processor.getLock("s1");
      h.processor.enqueue("s1", [delta("a")]); // schedules a frame
      expect(h.liveFrameCount()).toBe(1);

      h.processor.forget("s1");
      // Lock instance preserved (a caller may still be inside it).
      expect(h.processor.getLock("s1")).toBe(lock);
      // Frame cancelled, queue cleared — firing a stale frame applies nothing.
      expect(h.cancelFrameCalls).toBe(1);
      h.fireFrames();
      await flush();
      expect(h.applied).toEqual([]);
    });

    it("release drops the lock as well as the queue", () => {
      const h = makeHarness();
      const lock = h.processor.getLock("s1");
      h.processor.enqueue("s1", [delta("a")]);

      h.processor.release("s1");
      // Lock dropped — a fresh one is minted on next access.
      expect(h.processor.getLock("s1")).not.toBe(lock);
      expect(h.cancelFrameCalls).toBe(1);
    });
  });
});
