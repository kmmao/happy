import { logger } from "@/ui/logger";

interface QueueItem<T> {
  message: string;
  mode: T;
  modeHash: string;
  isolate?: boolean; // If true, this message must be processed alone
  localKey?: string; // App-assigned ID for targeted cancellation
}

/**
 * A mode-aware message queue that stores messages with their modes.
 * Returns consistent batches of messages with the same mode.
 */
export class MessageQueue2<T> {
  public queue: QueueItem<T>[] = []; // Made public for testing
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

  /**
   * Set a handler that will be called when a message arrives
   */
  setOnMessage(handler: ((message: string, mode: T) => void) | null): void {
    this.onMessageHandler = handler;
  }

  /**
   * Push a message to the queue with a mode.
   */
  push(message: string, mode: T, localKey?: string): void {
    if (this.closed) {
      throw new Error("Cannot push to closed queue");
    }

    const modeHash = this.modeHasher(mode);
    logger.debug(`[MessageQueue2] push() called with mode hash: ${modeHash}${localKey ? `, localKey: ${localKey}` : ""}`);

    this.queue.push({
      message,
      mode,
      modeHash,
      isolate: false,
      localKey,
    });

    // Trigger message handler if set
    if (this.onMessageHandler) {
      this.onMessageHandler(message, mode);
    }

    // Notify waiter if any
    if (this.waiter) {
      logger.debug(`[MessageQueue2] Notifying waiter`);
      const waiter = this.waiter;
      this.waiter = null;
      waiter(true);
    }

    this.notifyNewMessageWaiters();

    logger.debug(
      `[MessageQueue2] push() completed. Queue size: ${this.queue.length}`,
    );
  }

  /**
   * Push a message immediately without batching delay.
   * Does not clear the queue or enforce isolation.
   */
  pushImmediate(message: string, mode: T): void {
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
    });

    // Trigger message handler if set
    if (this.onMessageHandler) {
      this.onMessageHandler(message, mode);
    }

    // Notify waiter if any
    if (this.waiter) {
      logger.debug(`[MessageQueue2] Notifying waiter for immediate message`);
      const waiter = this.waiter;
      this.waiter = null;
      waiter(true);
    }

    this.notifyNewMessageWaiters();

    logger.debug(
      `[MessageQueue2] pushImmediate() completed. Queue size: ${this.queue.length}`,
    );
  }

  /**
   * Push a message that must be processed in complete isolation.
   * Clears any pending messages and ensures this message is never batched with others.
   * Used for special commands that require dedicated processing.
   */
  pushIsolateAndClear(message: string, mode: T): void {
    if (this.closed) {
      throw new Error("Cannot push to closed queue");
    }

    const modeHash = this.modeHasher(mode);
    logger.debug(
      `[MessageQueue2] pushIsolateAndClear() called with mode hash: ${modeHash} - clearing ${this.queue.length} pending messages`,
    );

    // Clear any pending messages to ensure this message is processed in complete isolation
    this.queue = [];

    this.queue.push({
      message,
      mode,
      modeHash,
      isolate: true,
    });

    // Trigger message handler if set
    if (this.onMessageHandler) {
      this.onMessageHandler(message, mode);
    }

    // Notify waiter if any
    if (this.waiter) {
      logger.debug(`[MessageQueue2] Notifying waiter for isolated message`);
      const waiter = this.waiter;
      this.waiter = null;
      waiter(true);
    }

    this.notifyNewMessageWaiters();

    logger.debug(
      `[MessageQueue2] pushIsolateAndClear() completed. Queue size: ${this.queue.length}`,
    );
  }

  /**
   * Push a message to the beginning of the queue with a mode.
   */
  unshift(message: string, mode: T): void {
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
    });

    // Trigger message handler if set
    if (this.onMessageHandler) {
      this.onMessageHandler(message, mode);
    }

    // Notify waiter if any
    if (this.waiter) {
      logger.debug(`[MessageQueue2] Notifying waiter`);
      const waiter = this.waiter;
      this.waiter = null;
      waiter(true);
    }

    this.notifyNewMessageWaiters();

    logger.debug(
      `[MessageQueue2] unshift() completed. Queue size: ${this.queue.length}`,
    );
  }

  /**
   * Reset the queue - clears all messages and resets to empty state
   */
  reset(): void {
    logger.debug(
      `[MessageQueue2] reset() called. Clearing ${this.queue.length} messages`,
    );
    this.queue = [];
    this.closed = false;

    // Clear waiter without calling it since we're not closing
    this.waiter = null;
  }

  /**
   * Cancel a queued message by its localKey.
   * Returns true if the message was found and removed.
   */
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

  /**
   * Close the queue - no more messages can be pushed
   */
  close(): void {
    logger.debug(`[MessageQueue2] close() called`);
    this.closed = true;

    // Notify any waiting caller
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(false);
    }

    // Notify new-message waiters that no more messages will arrive
    for (const waiter of this.newMessageWaiters) {
      waiter(false);
    }
    this.newMessageWaiters = [];
  }

  /**
   * Check if the queue is closed
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Get the current queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Wait for messages and return all messages with the same mode as a single string
   * Returns { message: string, mode: T } or null if aborted/closed
   */
  async waitForMessagesAndGetAsString(abortSignal?: AbortSignal): Promise<{
    message: string;
    mode: T;
    isolate: boolean;
    hash: string;
  } | null> {
    // If we have messages, return them immediately
    if (this.queue.length > 0) {
      return this.collectBatch();
    }

    // If closed or already aborted, return null
    if (this.closed || abortSignal?.aborted) {
      return null;
    }

    // Wait for messages to arrive
    const hasMessages = await this.waitForMessages(abortSignal);

    if (!hasMessages) {
      return null;
    }

    return this.collectBatch();
  }

  /**
   * Collect a batch of messages with the same mode, respecting isolation requirements
   */
  private collectBatch(): {
    message: string;
    mode: T;
    hash: string;
    isolate: boolean;
  } | null {
    if (this.queue.length === 0) {
      return null;
    }

    const firstItem = this.queue[0];
    const sameModeMessages: string[] = [];
    let mode = firstItem.mode;
    let isolate = firstItem.isolate ?? false;
    const targetModeHash = firstItem.modeHash;

    // If the first message requires isolation, only process it alone
    if (firstItem.isolate) {
      const item = this.queue.shift()!;
      sameModeMessages.push(item.message);
      logger.debug(
        `[MessageQueue2] Collected isolated message with mode hash: ${targetModeHash}`,
      );
    } else {
      // Collect all messages with the same mode until we hit an isolated message
      while (
        this.queue.length > 0 &&
        this.queue[0].modeHash === targetModeHash &&
        !this.queue[0].isolate
      ) {
        const item = this.queue.shift()!;
        sameModeMessages.push(item.message);
      }
      logger.debug(
        `[MessageQueue2] Collected batch of ${sameModeMessages.length} messages with mode hash: ${targetModeHash}`,
      );
    }

    // Join all messages with newlines
    const combinedMessage = sameModeMessages.join("\n");

    return {
      message: combinedMessage,
      mode,
      hash: targetModeHash,
      isolate,
    };
  }

  /**
   * Wait for messages to arrive
   */
  private waitForMessages(abortSignal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      let abortHandler: (() => void) | null = null;

      // Set up abort handler
      if (abortSignal) {
        abortHandler = () => {
          logger.debug("[MessageQueue2] Wait aborted");
          // Clear waiter if it's still set
          if (this.waiter === waiterFunc) {
            this.waiter = null;
          }
          resolve(false);
        };
        abortSignal.addEventListener("abort", abortHandler);
      }

      const waiterFunc = (hasMessages: boolean) => {
        // Clean up abort handler
        if (abortHandler && abortSignal) {
          abortSignal.removeEventListener("abort", abortHandler);
        }
        resolve(hasMessages);
      };

      // Check again in case messages arrived or queue closed while setting up
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

      // Set the waiter
      this.waiter = waiterFunc;
      logger.debug("[MessageQueue2] Waiting for messages...");
    });
  }

  /**
   * Notify all new-message waiters that a message has arrived.
   */
  private notifyNewMessageWaiters(): void {
    if (this.newMessageWaiters.length > 0) {
      const waiters = this.newMessageWaiters;
      this.newMessageWaiters = [];
      for (const waiter of waiters) {
        waiter(true);
      }
    }
  }

  /**
   * Wait for a new message to arrive without consuming it.
   * Returns true when a new message arrives, false if aborted/closed.
   * Used by mid-turn drain loops to react to new messages during a turn.
   */
  waitForNewMessage(abortSignal?: AbortSignal): Promise<boolean> {
    // If we already have messages, return immediately
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
        // Remove self from waiters list
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
   * Try to take the first message for mid-turn injection.
   * Only takes if the message is safe to inject mid-turn:
   * - Not isolated (/compact, /clear)
   * - Same cold mode hash (no process restart needed)
   * Returns the queue item or null if not eligible.
   */
  tryTakeForMidTurn(
    currentColdHash: string,
    coldHasher: (mode: T) => string,
  ): { message: string; mode: T; modeHash: string } | null {
    if (this.queue.length === 0) {
      return null;
    }

    const first = this.queue[0];

    // Isolated messages must never be mid-turn pushed
    if (first.isolate) {
      logger.debug(
        "[MessageQueue2] tryTakeForMidTurn: rejected — isolate message",
      );
      return null;
    }

    // Cold hash mismatch means process restart is needed
    const msgColdHash = coldHasher(first.mode);
    if (msgColdHash !== currentColdHash) {
      logger.debug(
        "[MessageQueue2] tryTakeForMidTurn: rejected — cold hash mismatch",
      );
      return null;
    }

    // Safe to take
    const item = this.queue.shift()!;
    logger.debug(
      `[MessageQueue2] tryTakeForMidTurn: took message, remaining: ${this.queue.length}`,
    );
    return { message: item.message, mode: item.mode, modeHash: item.modeHash };
  }

  /**
   * Peek at whether the first message in the queue is an isolate message.
   */
  peekIsolate(): boolean {
    return this.queue.length > 0 && (this.queue[0].isolate ?? false);
  }
}
