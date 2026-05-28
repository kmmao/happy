import { AsyncLock } from "@/utils/lock";
import type { NormalizedMessage } from "./typesRaw";

// ---------------------------------------------------------------------------
// SessionMessageProcessor
// ---------------------------------------------------------------------------
//
// Owns every piece of per-session state involved in turning a stream of
// incoming messages into ordered, batched applications:
//
//   • a FIFO queue of pending messages,
//   • a re-entrancy flag marking an in-flight drain,
//   • an AsyncLock serializing application (shared with history fetch so the
//     live drain and a backfill never interleave),
//   • a pending animation-frame handle used to coalesce text-delta bursts.
//
// Before this module these four maps lived as separate fields on the Sync
// class and were mutated from three files (sync.ts, syncMessageFetch.ts,
// syncUpdateHandlers.ts) with no single owner — every cleanup/eviction path
// had to remember which subset to clear and in what order. Concentrating them
// here gives the queue/lock/frame invariants one home and makes the
// concurrency (rAF batching, drain loop, race-close microtask) testable in
// isolation through this interface.

export interface SessionMessageProcessorDeps {
  /**
   * Apply a drained batch of messages for a session. Invoked inside the
   * per-session lock, batches delivered in FIFO order. Must be synchronous-ish
   * (its return value is ignored); throwing aborts the current drain.
   */
  applyMessages: (sessionId: string, messages: NormalizedMessage[]) => void;
  /**
   * Schedule a callback for the next animation frame. Defaults to the global
   * requestAnimationFrame; injectable so tests can drive frames deterministically.
   */
  requestFrame?: (cb: () => void) => number;
  /** Cancel a frame scheduled by requestFrame. Defaults to cancelAnimationFrame. */
  cancelFrame?: (handle: number) => void;
}

export interface SessionMessageProcessor {
  /**
   * Queue messages for a session. A batch consisting solely of pure text-deltas
   * (streaming chunks) is coalesced to the next animation frame so updates align
   * with the display refresh rate; any other message flushes immediately and
   * cancels a pending delta frame.
   */
  enqueue(sessionId: string, messages: NormalizedMessage[]): void;
  /**
   * The per-session serialization lock, created lazily. Shared with the history
   * fetch path so a live drain and a backfill of the same session never run
   * concurrently.
   */
  getLock(sessionId: string): AsyncLock;
  /**
   * Drop the queue, processing flag, and any pending frame for a session, but
   * KEEP its lock. Safe to call from inside that lock (e.g. a 404 cleanup that
   * fires mid-drain).
   */
  forget(sessionId: string): void;
  /**
   * Fully release every resource for a session, including its lock. For LRU
   * eviction and hard deletion, when no caller can still be holding the lock.
   */
  release(sessionId: string): void;
}

/**
 * Returns true when every message in the batch is a pure text-delta (streaming
 * chunk). Used to decide whether to throttle the queue flush to an animation
 * frame.
 */
function isAllTextDeltas(messages: NormalizedMessage[]): boolean {
  return (
    messages.length > 0 &&
    messages.every(
      (m) =>
        m.role === "agent" &&
        m.content.length === 1 &&
        m.content[0]?.type === "text-delta",
    )
  );
}

export function createSessionMessageProcessor(
  deps: SessionMessageProcessorDeps,
): SessionMessageProcessor {
  const requestFrame =
    deps.requestFrame ?? ((cb: () => void) => requestAnimationFrame(cb));
  const cancelFrame =
    deps.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));

  const queues = new Map<string, NormalizedMessage[]>();
  const processing = new Set<string>();
  const locks = new Map<string, AsyncLock>();
  // Pending rAF handles for text-delta batching — one per session. Using
  // requestAnimationFrame instead of a fixed timeout aligns delta flushes with
  // the display refresh rate (~16ms @60Hz, ~8ms @120Hz ProMotion), producing
  // smooth character-by-character streaming instead of fixed-interval chunks.
  const deltaFrames = new Map<string, number>();

  function getLock(sessionId: string): AsyncLock {
    let lock = locks.get(sessionId);
    if (!lock) {
      lock = new AsyncLock();
      locks.set(sessionId, lock);
    }
    return lock;
  }

  function cancelDeltaFrame(sessionId: string): void {
    const handle = deltaFrames.get(sessionId);
    if (handle != null) {
      cancelFrame(handle);
      deltaFrames.delete(sessionId);
    }
  }

  function schedule(sessionId: string): void {
    if (processing.has(sessionId)) {
      return;
    }

    processing.add(sessionId);
    const lock = getLock(sessionId);
    void lock
      .inLock(() => {
        while (true) {
          const pending = queues.get(sessionId);
          if (!pending || pending.length === 0) {
            break;
          }
          const batch = pending.splice(0, pending.length);
          deps.applyMessages(sessionId, batch);
        }
      })
      .finally(() => {
        processing.delete(sessionId);
        // Re-check on a microtask immediately after clearing the flag. This
        // closes the race window where messages arrive between the while-loop
        // exit and the delete above.
        queueMicrotask(() => {
          const pending = queues.get(sessionId);
          if (pending && pending.length > 0) {
            schedule(sessionId);
          }
        });
      });
  }

  function enqueue(sessionId: string, messages: NormalizedMessage[]): void {
    if (messages.length === 0) {
      return;
    }

    let queue = queues.get(sessionId);
    if (!queue) {
      queue = [];
      queues.set(sessionId, queue);
    }
    queue.push(...messages);

    // Batch text-deltas to the next animation frame so multiple deltas arriving
    // within the same frame merge into a single store update. Non-delta messages
    // (tool calls, events, user messages) bypass the batch and flush immediately —
    // they must never be delayed.
    if (isAllTextDeltas(messages)) {
      if (!deltaFrames.has(sessionId)) {
        const handle = requestFrame(() => {
          deltaFrames.delete(sessionId);
          schedule(sessionId);
        });
        deltaFrames.set(sessionId, handle);
      }
      // A frame is already scheduled — this delta will be picked up when it fires.
    } else {
      cancelDeltaFrame(sessionId);
      schedule(sessionId);
    }
  }

  function forget(sessionId: string): void {
    cancelDeltaFrame(sessionId);
    queues.delete(sessionId);
    processing.delete(sessionId);
  }

  function release(sessionId: string): void {
    forget(sessionId);
    locks.delete(sessionId);
  }

  return { enqueue, getLock, forget, release };
}
