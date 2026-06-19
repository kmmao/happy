import { logger } from "@/ui/logger";

export type QueuePriority = "urgent" | "user" | "background";
export type QueueKind =
  | "prompt"
  | "continue"
  | "shell"
  | "isolated"
  | "notification"
  | "automation";

export interface QueueMetadata {
  priority?: QueuePriority;
  kind?: QueueKind;
  source?: string;
  socketToQueueMs?: number;
}

interface QueueItem<T> {
  message: string;
  mode: T;
  modeHash: string;
  isolate?: boolean;
  localKey?: string;
  _perfPushTime?: number;
  _perfSocketToQueueMs?: number;
  priority: QueuePriority;
  kind?: QueueKind;
  source?: string;
}

/**
 * Outcome of {@link MessageQueue2.tryTakeForMidTurn}. The queue knows exactly
 * why a head item cannot be injected mid-turn, so it reports that reason rather
 * than collapsing every rejection to `null` and forcing the caller to re-probe:
 *
 *   - `taken`         — the head item was removed and can be pushed mid-turn.
 *   - `isolate`       — the head is an isolate command (`/compact`, `/clear`);
 *                       the caller must interrupt the turn so it runs cleanly.
 *   - `cold-mismatch` — the head needs a fresh process (its cold hash differs
 *                       from the running one); defer to the post-turn path.
 *   - `empty`         — nothing is queued.
 *
 * `cold-mismatch` and `empty` share the same caller response (let the turn end,
 * then `nextMessage()` handles it); they stay distinct so the reason is legible
 * in logs and tests.
 */
export type MidTurnTake<T> =
  | { status: "taken"; message: string; mode: T; modeHash: string; priority: QueuePriority }
  | { status: "isolate" }
  | { status: "cold-mismatch" }
  | { status: "empty" };

const PRIORITY_ORDER: Record<QueuePriority, number> = {
  urgent: 0,
  user: 1,
  background: 2,
};

/**
 * A mode-aware message queue that stores messages with their modes.
 * Returns consistent batches of messages with the same mode.
 *
 * Stall watchdog:
 *   The queue self-monitors for a stuck consumer. If messages sit unread for
 *   `stallThresholdMs` (queue non-empty + no successful collectBatch in that
 *   window), a `[STALLED]` line is emitted to the logger. This covers the
 *   偶发 "Web sent message, Claude/Codex never responds" symptom whose two
 *   most likely upstream causes — child process died, or the consumer loop
 *   is wedged inside an SDK call that never returns — both manifest the same
 *   way at this layer: the queue has work, nobody collects it.
 *
 *   The threshold (default 5 min) is intentionally generous: a long Claude
 *   turn legitimately pins the consumer in `await claudeRemote(...)` for
 *   several minutes, during which `collectBatch` is not called. We only
 *   complain after that window AND if the queue actually contains work.
 *   Each stall fires exactly one log line; the next successful consume
 *   re-arms the alarm. Empty queue never triggers — that's just idle.
 */
const DEFAULT_STALL_THRESHOLD_MS = 5 * 60_000;
const DEFAULT_WATCHDOG_INTERVAL_MS = 60_000;

export class MessageQueue2<T> {
  public queue: QueueItem<T>[] = [];
  private waiter: ((hasMessages: boolean) => void) | null = null;
  private newMessageWaiters: Array<(hasMessages: boolean) => void> = [];
  private closed = false;
  private onMessageHandler: ((message: string, mode: T) => void) | null = null;
  modeHasher: (mode: T) => string;

  // Stall watchdog state. lastConsumedAt is the wall-clock time of the most
  // recent successful collectBatch / tryTakeForMidTurn; stallReported is the
  // single-shot latch that prevents log spam — cleared on every consume.
  private lastConsumedAt: number = Date.now();
  private stallReported = false;
  private readonly stallThresholdMs: number;
  private readonly watchdogIntervalMs: number;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    modeHasher: (mode: T) => string,
    onMessageHandler: ((message: string, mode: T) => void) | null = null,
    options?: { stallThresholdMs?: number; watchdogIntervalMs?: number },
  ) {
    this.modeHasher = modeHasher;
    this.onMessageHandler = onMessageHandler;
    this.stallThresholdMs =
      options?.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
    this.watchdogIntervalMs =
      options?.watchdogIntervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS;
    this.ensureWatchdogRunning();
    logger.debug(`[MessageQueue2] Initialized`);
  }

  setOnMessage(handler: ((message: string, mode: T) => void) | null): void {
    this.onMessageHandler = handler;
  }

  push(
    message: string,
    mode: T,
    localKey?: string,
    metadata?: QueueMetadata,
  ): void {
    if (this.closed) {
      throw new Error("Cannot push to closed queue");
    }

    const modeHash = this.modeHasher(mode);
    const pushTime = Date.now();
    logger.debug(
      `[MessageQueue2] push() called with mode hash: ${modeHash}${localKey ? `, localKey: ${localKey}` : ""}`,
    );

    this.queue.push({
      message,
      mode,
      modeHash,
      isolate: false,
      localKey,
      _perfPushTime: pushTime,
      _perfSocketToQueueMs: metadata?.socketToQueueMs,
      priority: metadata?.priority ?? "user",
      kind: metadata?.kind ?? "prompt",
      source: metadata?.source,
    });

    this.afterPush(message, mode);

    logger.debug(
      `[MessageQueue2] push() completed. Queue size: ${this.queue.length}`,
    );
  }

  pushImmediate(message: string, mode: T, metadata?: QueueMetadata): void {
    if (this.closed) {
      throw new Error("Cannot push to closed queue");
    }

    const modeHash = this.modeHasher(mode);
    logger.debug(
      `[MessageQueue2] pushImmediate() called with mode hash: ${modeHash}`,
    );

    this.queue.push({
      message,
      mode,
      modeHash,
      isolate: false,
      _perfSocketToQueueMs: metadata?.socketToQueueMs,
      priority: metadata?.priority ?? "user",
      kind: metadata?.kind ?? "prompt",
      source: metadata?.source,
    });

    this.afterPush(message, mode, true);

    logger.debug(
      `[MessageQueue2] pushImmediate() completed. Queue size: ${this.queue.length}`,
    );
  }

  pushIsolateAndClear(message: string, mode: T, metadata?: QueueMetadata): void {
    if (this.closed) {
      throw new Error("Cannot push to closed queue");
    }

    const modeHash = this.modeHasher(mode);
    logger.debug(
      `[MessageQueue2] pushIsolateAndClear() called with mode hash: ${modeHash} - clearing ${this.queue.length} pending messages`,
    );

    this.queue = [];
    this.queue.push({
      message,
      mode,
      modeHash,
      isolate: true,
      _perfSocketToQueueMs: metadata?.socketToQueueMs,
      priority: metadata?.priority ?? "urgent",
      kind: metadata?.kind ?? "isolated",
      source: metadata?.source,
    });

    this.afterPush(message, mode, true);

    logger.debug(
      `[MessageQueue2] pushIsolateAndClear() completed. Queue size: ${this.queue.length}`,
    );
  }

  unshift(message: string, mode: T, metadata?: QueueMetadata): void {
    if (this.closed) {
      throw new Error("Cannot unshift to closed queue");
    }

    const modeHash = this.modeHasher(mode);
    logger.debug(
      `[MessageQueue2] unshift() called with mode hash: ${modeHash}`,
    );

    this.queue.unshift({
      message,
      mode,
      modeHash,
      isolate: false,
      _perfSocketToQueueMs: metadata?.socketToQueueMs,
      priority: metadata?.priority ?? "urgent",
      kind: metadata?.kind ?? "notification",
      source: metadata?.source,
    });

    this.afterPush(message, mode);

    logger.debug(
      `[MessageQueue2] unshift() completed. Queue size: ${this.queue.length}`,
    );
  }

  reset(): void {
    logger.debug(
      `[MessageQueue2] reset() called. Clearing ${this.queue.length} messages`,
    );
    this.queue = [];
    this.closed = false;
    this.waiter = null;
    // Fresh slate for the watchdog too: any prior stall report no longer
    // applies, and if a previous close() killed the timer, revive it so a
    // reopened queue keeps its diagnostic.
    this.lastConsumedAt = Date.now();
    this.stallReported = false;
    this.ensureWatchdogRunning();
  }

  cancelByLocalKey(localKey: string): boolean {
    const idx = this.queue.findIndex((item) => item.localKey === localKey);
    if (idx === -1) {
      logger.debug(
        `[MessageQueue2] cancelByLocalKey: localKey ${localKey} not found`,
      );
      return false;
    }
    this.queue = [...this.queue.slice(0, idx), ...this.queue.slice(idx + 1)];
    logger.debug(
      `[MessageQueue2] cancelByLocalKey: removed localKey ${localKey}, remaining: ${this.queue.length}`,
    );
    return true;
  }

  close(): void {
    logger.debug(`[MessageQueue2] close() called`);
    this.closed = true;

    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(false);
    }

    for (const waiter of this.newMessageWaiters) {
      waiter(false);
    }
    this.newMessageWaiters = [];
  }

  isClosed(): boolean {
    return this.closed;
  }

  size(): number {
    return this.queue.length;
  }

  async waitForMessagesAndGetAsString(abortSignal?: AbortSignal): Promise<{
    message: string;
    mode: T;
    isolate: boolean;
    hash: string;
    priority: QueuePriority;
    kind?: QueueKind;
    source?: string;
    requestIds: string[];
    queueWaitMs?: number;
    socketToQueueMs?: number;
  } | null> {
    if (this.queue.length > 0) {
      return this.collectBatch();
    }

    if (this.closed || abortSignal?.aborted) {
      return null;
    }

    const hasMessages = await this.waitForMessages(abortSignal);

    if (!hasMessages) {
      return null;
    }

    return this.collectBatch();
  }

  private collectBatch(): {
    message: string;
    mode: T;
    hash: string;
    isolate: boolean;
    priority: QueuePriority;
    kind?: QueueKind;
    source?: string;
    requestIds: string[];
    queueWaitMs?: number;
    socketToQueueMs?: number;
  } | null {
    const firstIdx = this.findHighestPriorityIndex();
    if (firstIdx === -1) {
      return null;
    }

    const firstItem = this.queue[firstIdx]!;
    const sameModeMessages: string[] = [];
    let mode = firstItem.mode;
    const isolate = firstItem.isolate ?? false;
    const targetModeHash = firstItem.modeHash;
    const targetPriority = firstItem.priority;
    let kind = firstItem.kind;
    let source = firstItem.source;
    const requestIds: string[] = [];

    let earliestPushTime: number | undefined;
    let socketToQueueMs: number | undefined;
    if (firstItem.isolate) {
      const [item] = this.queue.splice(firstIdx, 1);
      sameModeMessages.push(item!.message);
      earliestPushTime = item!._perfPushTime;
      if (item?.localKey) {
        requestIds.push(item.localKey);
      }
      if (item?._perfSocketToQueueMs !== undefined) {
        socketToQueueMs = item._perfSocketToQueueMs;
      }
      logger.debug(
        `[MessageQueue2] Collected isolated message with mode hash: ${targetModeHash}`,
      );
    } else {
      let started = false;
      for (let i = firstIdx; i < this.queue.length; ) {
        const item = this.queue[i]!;
        if (item.priority !== targetPriority) {
          i++;
          continue;
        }
        if (item.isolate) {
          if (started) break;
          i++;
          continue;
        }
        if (item.modeHash === targetModeHash) {
          started = true;
          sameModeMessages.push(item.message);
          mode = item.mode;
          kind = kind ?? item.kind;
          source = source ?? item.source;
          if (
            item._perfPushTime &&
            (!earliestPushTime || item._perfPushTime < earliestPushTime)
          ) {
            earliestPushTime = item._perfPushTime;
          }
          if (item.localKey) {
            requestIds.push(item.localKey);
          }
          if (
            item._perfSocketToQueueMs !== undefined &&
            (socketToQueueMs === undefined ||
              item._perfSocketToQueueMs < socketToQueueMs)
          ) {
            socketToQueueMs = item._perfSocketToQueueMs;
          }
          this.queue.splice(i, 1);
          continue;
        }
        if (started) {
          break;
        }
        i++;
      }
      logger.debug(
        `[MessageQueue2] Collected batch of ${sameModeMessages.length} messages with mode hash: ${targetModeHash} at priority ${targetPriority}`,
      );
    }
    if (earliestPushTime) {
      logger.debug(
        `[perf] queue_wait: ${Date.now() - earliestPushTime}ms (push → collectBatch, batch=${sameModeMessages.length})`,
      );
    }
    const queueWaitMs = earliestPushTime
      ? Date.now() - earliestPushTime
      : undefined;

    // Consumer is alive — refresh the stall watchdog. The next push won't
    // arm an alarm until this timestamp goes stale again.
    this.markConsumed();

    return {
      message: sameModeMessages.join("\n"),
      mode,
      hash: targetModeHash,
      isolate,
      priority: targetPriority,
      kind,
      source,
      requestIds,
      queueWaitMs,
      ...(socketToQueueMs !== undefined ? { socketToQueueMs } : {}),
    };
  }

  private waitForMessages(abortSignal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      let abortHandler: (() => void) | null = null;

      if (abortSignal) {
        abortHandler = () => {
          logger.debug("[MessageQueue2] Wait aborted");
          if (this.waiter === waiterFunc) {
            this.waiter = null;
          }
          resolve(false);
        };
        abortSignal.addEventListener("abort", abortHandler);
      }

      const waiterFunc = (hasMessages: boolean) => {
        if (abortHandler && abortSignal) {
          abortSignal.removeEventListener("abort", abortHandler);
        }
        resolve(hasMessages);
      };

      if (this.queue.length > 0) {
        if (abortHandler && abortSignal) {
          abortSignal.removeEventListener("abort", abortHandler);
        }
        resolve(true);
        return;
      }

      if (this.closed || abortSignal?.aborted) {
        if (abortHandler && abortSignal) {
          abortSignal.removeEventListener("abort", abortHandler);
        }
        resolve(false);
        return;
      }

      this.waiter = waiterFunc;
      logger.debug("[MessageQueue2] Waiting for messages...");
    });
  }

  private notifyNewMessageWaiters(): void {
    if (this.newMessageWaiters.length > 0) {
      const waiters = this.newMessageWaiters;
      this.newMessageWaiters = [];
      for (const waiter of waiters) {
        waiter(true);
      }
    }
  }

  waitForNewMessage(abortSignal?: AbortSignal): Promise<boolean> {
    if (this.queue.length > 0) {
      return Promise.resolve(true);
    }

    if (this.closed || abortSignal?.aborted) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      let resolved = false;

      const done = (value: boolean) => {
        if (resolved) return;
        resolved = true;
        if (abortHandler && abortSignal) {
          abortSignal.removeEventListener("abort", abortHandler);
        }
        const idx = this.newMessageWaiters.indexOf(waiterFn);
        if (idx !== -1) {
          this.newMessageWaiters.splice(idx, 1);
        }
        resolve(value);
      };

      const abortHandler = abortSignal ? () => done(false) : null;
      if (abortHandler && abortSignal) {
        abortSignal.addEventListener("abort", abortHandler);
      }

      const waiterFn = (hasMessages: boolean) => done(hasMessages);
      this.newMessageWaiters.push(waiterFn);
    });
  }

  /**
   * Attempt to remove the highest-priority item for mid-turn injection.
   * Returns a {@link MidTurnTake} that names the outcome — the head's
   * isolate flag and cold-hash comparison are computed here and reported
   * directly, so callers never re-inspect queue state to learn why a take
   * was rejected.
   */
  tryTakeForMidTurn(
    currentColdHash: string,
    coldHasher: (mode: T) => string,
  ): MidTurnTake<T> {
    const firstIdx = this.findHighestPriorityIndex();
    if (firstIdx === -1) {
      return { status: "empty" };
    }

    const first = this.queue[firstIdx]!;

    if (first.isolate) {
      logger.debug(
        "[MessageQueue2] tryTakeForMidTurn: rejected — isolate message",
      );
      return { status: "isolate" };
    }

    const msgColdHash = coldHasher(first.mode);
    if (msgColdHash !== currentColdHash) {
      logger.debug(
        "[MessageQueue2] tryTakeForMidTurn: rejected — cold hash mismatch",
      );
      return { status: "cold-mismatch" };
    }

    const [item] = this.queue.splice(firstIdx, 1);
    logger.debug(
      `[MessageQueue2] tryTakeForMidTurn: took message, remaining: ${this.queue.length}`,
    );
    // Mid-turn pickup counts as the consumer being alive — refresh watchdog.
    this.markConsumed();
    return {
      status: "taken",
      message: item!.message,
      mode: item!.mode,
      modeHash: item!.modeHash,
      priority: item!.priority,
    };
  }

  private afterPush(message: string, mode: T, immediate = false): void {
    if (this.onMessageHandler) {
      this.onMessageHandler(message, mode);
    }

    if (this.waiter) {
      logger.debug(
        immediate
          ? `[MessageQueue2] Notifying waiter for immediate message`
          : `[MessageQueue2] Notifying waiter`,
      );
      const waiter = this.waiter;
      this.waiter = null;
      waiter(true);
    }

    this.notifyNewMessageWaiters();
  }

  private findHighestPriorityIndex(): number {
    if (this.queue.length === 0) {
      return -1;
    }
    let bestIdx = -1;
    let bestPriority = Infinity;
    for (let i = 0; i < this.queue.length; i++) {
      const item = this.queue[i]!;
      const rank = PRIORITY_ORDER[item.priority ?? "user"];
      if (rank < bestPriority) {
        bestPriority = rank;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /**
   * Mark a successful consume event. Updates the watchdog reference timestamp
   * and clears any latched stall report so the next legitimate stall can fire.
   * Cheap enough to call on every batch/mid-turn pickup without measurement.
   */
  private markConsumed(): void {
    this.lastConsumedAt = Date.now();
    this.stallReported = false;
  }

  /**
   * Idempotent watchdog starter. Safe to call from constructor and from
   * `reset()` (which may resurrect a previously-closed queue). The interval
   * is `.unref()`d so a forgotten queue never blocks Node from exiting —
   * this is diagnostic infrastructure, not a load-bearing schedule.
   */
  private ensureWatchdogRunning(): void {
    if (this.watchdogTimer) {
      return;
    }
    const timer = setInterval(
      () => this.watchdogCheck(),
      this.watchdogIntervalMs,
    );
    // `unref` is present on Node's Timeout but not in all fake-timer shims;
    // guard so tests using vitest fake timers don't crash.
    const maybeUnref = (timer as unknown as { unref?: () => void }).unref;
    if (typeof maybeUnref === "function") {
      maybeUnref.call(timer);
    }
    this.watchdogTimer = timer;
  }

  /**
   * One scan of the queue/consumer state. Emits exactly one `[STALLED]` log
   * per stall episode (latch cleared on next `markConsumed`).
   *
   * Trigger conditions, ALL required:
   *   1. queue not closed (a closed queue is intentionally drained)
   *   2. queue.length > 0 (empty queue = idle, not stalled)
   *   3. now - lastConsumedAt > stallThresholdMs (long enough since any consume)
   *   4. !stallReported (don't spam — wait for re-arm)
   *
   * The log line carries enough breadcrumbs (queue depth, idle duration,
   * oldest message age, up to 5 sample localKeys) to correlate with the
   * server-side message audit when triaging.
   */
  private watchdogCheck(): void {
    if (this.closed) {
      return;
    }
    if (this.queue.length === 0) {
      return;
    }
    const now = Date.now();
    const idleMs = now - this.lastConsumedAt;
    if (idleMs < this.stallThresholdMs) {
      return;
    }
    if (this.stallReported) {
      return;
    }
    this.stallReported = true;

    const oldest = this.queue[0];
    const oldestAgeMs = oldest?._perfPushTime
      ? now - oldest._perfPushTime
      : undefined;
    const sampleLocalKeys = this.queue
      .map((item) => item.localKey)
      .filter((k): k is string => !!k)
      .slice(0, 5);

    logger.debug(
      `[STALLED] [MessageQueue2] Queue has ${this.queue.length} message(s) waiting, ` +
        `no successful collectBatch for ${Math.round(idleMs / 1000)}s ` +
        `(threshold: ${Math.round(this.stallThresholdMs / 1000)}s). ` +
        `Oldest message age: ${oldestAgeMs !== undefined ? Math.round(oldestAgeMs / 1000) + "s" : "unknown"}. ` +
        `Sample localKeys: ${sampleLocalKeys.length > 0 ? sampleLocalKeys.join(", ") : "(none)"}. ` +
        `Likely causes: consumer loop wedged in an SDK call, child agent process died, or onUserMessage callback never dispatched.`,
    );
  }
}
