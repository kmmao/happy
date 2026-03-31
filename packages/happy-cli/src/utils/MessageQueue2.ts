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
}

interface QueueItem<T> {
  message: string;
  mode: T;
  modeHash: string;
  isolate?: boolean;
  localKey?: string;
  _perfPushTime?: number;
  priority: QueuePriority;
  kind?: QueueKind;
  source?: string;
}

const PRIORITY_ORDER: Record<QueuePriority, number> = {
  urgent: 0,
  user: 1,
  background: 2,
};

/**
 * A mode-aware message queue that stores messages with their modes.
 * Returns consistent batches of messages with the same mode.
 */
export class MessageQueue2<T> {
  public queue: QueueItem<T>[] = [];
  private waiter: ((hasMessages: boolean) => void) | null = null;
  private newMessageWaiters: Array<(hasMessages: boolean) => void> = [];
  private closed = false;
  private onMessageHandler: ((message: string, mode: T) => void) | null = null;
  modeHasher: (mode: T) => string;

  constructor(
    modeHasher: (mode: T) => string,
    onMessageHandler: ((message: string, mode: T) => void) | null = null,
  ) {
    this.modeHasher = modeHasher;
    this.onMessageHandler = onMessageHandler;
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

    let earliestPushTime: number | undefined;
    if (firstItem.isolate) {
      const [item] = this.queue.splice(firstIdx, 1);
      sameModeMessages.push(item!.message);
      earliestPushTime = item!._perfPushTime;
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

    return {
      message: sameModeMessages.join("\n"),
      mode,
      hash: targetModeHash,
      isolate,
      priority: targetPriority,
      kind,
      source,
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

  tryTakeForMidTurn(
    currentColdHash: string,
    coldHasher: (mode: T) => string,
  ): { message: string; mode: T; modeHash: string; priority: QueuePriority } | null {
    const firstIdx = this.findHighestPriorityIndex();
    if (firstIdx === -1) {
      return null;
    }

    const first = this.queue[firstIdx]!;

    if (first.isolate) {
      logger.debug(
        "[MessageQueue2] tryTakeForMidTurn: rejected — isolate message",
      );
      return null;
    }

    const msgColdHash = coldHasher(first.mode);
    if (msgColdHash !== currentColdHash) {
      logger.debug(
        "[MessageQueue2] tryTakeForMidTurn: rejected — cold hash mismatch",
      );
      return null;
    }

    const [item] = this.queue.splice(firstIdx, 1);
    logger.debug(
      `[MessageQueue2] tryTakeForMidTurn: took message, remaining: ${this.queue.length}`,
    );
    return {
      message: item!.message,
      mode: item!.mode,
      modeHash: item!.modeHash,
      priority: item!.priority,
    };
  }

  peekIsolate(): boolean {
    const firstIdx = this.findHighestPriorityIndex();
    return firstIdx !== -1 && (this.queue[firstIdx]!.isolate ?? false);
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
}
