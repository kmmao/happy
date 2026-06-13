import { storage } from "@/sync/storage";
import { log } from "@/log";
import { isSessionRunning } from "@/utils/sessionUtils";

type QueuedMessage = {
  localId: string;
  message: string;
  displayText?: string;
};

type SendMessage = (
  sessionId: string,
  text: string,
  displayText?: string,
  options?: {
    localId?: string;
    bypassRunningCheck?: boolean;
  },
) => Promise<boolean | void>;

const DISPATCH_FALLBACK_MS = 15_000;

export class PendingQueueDispatcher {
  private sendMessage: SendMessage | null = null;
  private scheduled = new Map<string, ReturnType<typeof setTimeout>>();
  private fallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private inFlight = new Set<string>();
  private forceUnpaused = new Set<string>();
  private cancelledInFlight = new Set<string>();

  init(sendMessage: SendMessage): void {
    this.sendMessage = sendMessage;
  }

  schedule(sessionId: string, options?: { ignorePaused?: boolean }): void {
    if (options?.ignorePaused) {
      this.forceUnpaused.add(sessionId);
    }
    if (this.scheduled.has(sessionId)) {
      return;
    }
    const timer = setTimeout(() => {
      this.scheduled.delete(sessionId);
      void this.dispatchIfReady(sessionId);
    }, 0);
    this.scheduled.set(sessionId, timer);
  }

  scheduleAll(): void {
    const queues = storage.getState().sessionPendingQueues;
    for (const [sessionId, queue] of Object.entries(queues)) {
      if (queue.length > 0) {
        this.schedule(sessionId);
      }
    }
  }

  disposeSession(sessionId: string): void {
    const scheduled = this.scheduled.get(sessionId);
    if (scheduled) {
      clearTimeout(scheduled);
      this.scheduled.delete(sessionId);
    }
    this.clearFallback(sessionId);
    this.inFlight.delete(sessionId);
    this.forceUnpaused.delete(sessionId);
    this.cancelledInFlight.add(sessionId);
  }

  private async dispatchIfReady(sessionId: string): Promise<void> {
    const state = storage.getState();
    const session = state.sessions[sessionId];
    if (!session) {
      this.disposeSession(sessionId);
      return;
    }

    if (isSessionRunning(session)) {
      if (this.inFlight.has(sessionId)) {
        this.inFlight.delete(sessionId);
        this.clearFallback(sessionId);
      }
      return;
    }

    if (this.inFlight.has(sessionId)) {
      return;
    }

    const ignorePaused = this.forceUnpaused.has(sessionId);
    if (!ignorePaused && state.sessionPendingQueuePaused[sessionId]) {
      return;
    }

    const queue = state.sessionPendingQueues[sessionId];
    if (!queue || queue.length === 0) {
      this.forceUnpaused.delete(sessionId);
      return;
    }

    const next = storage.getState().shiftPendingQueue(sessionId);
    if (!next) {
      this.forceUnpaused.delete(sessionId);
      return;
    }

    this.cancelledInFlight.delete(sessionId);
    this.inFlight.add(sessionId);
    this.armFallback(sessionId);

    try {
      const accepted = await this.sendMessage?.(sessionId, next.message, next.displayText, {
        localId: next.localId,
        bypassRunningCheck: true,
      });
      if (accepted === false) {
        this.handleSendRejected(sessionId, next);
        return;
      }
      this.forceUnpaused.delete(sessionId);
    } catch (error) {
      log.error(
        `pending-queue: sendMessage failed for session=${sessionId} localId=${next.localId}; item restored`,
        error,
      );
      this.handleSendRejected(sessionId, next);
    }
  }

  private handleSendRejected(sessionId: string, item: QueuedMessage): void {
    const forced = this.forceUnpaused.has(sessionId);
    this.forceUnpaused.delete(sessionId);
    if (!this.cancelledInFlight.has(sessionId)) {
      this.restoreItem(sessionId, item);
    }
    this.releaseGate(sessionId, { retry: !forced });
  }

  private restoreItem(sessionId: string, item: QueuedMessage): void {
    const state = storage.getState();
    if (!state.sessions[sessionId]) {
      return;
    }
    const existingQueue = state.sessionPendingQueues[sessionId] ?? [];
    const existing = existingQueue.some((queued) => queued.localId === item.localId);
    if (!existing && existingQueue.length === 0) {
      return;
    }
    if (!existing) {
      state.appendToPendingQueue(sessionId, item);
    }
    storage.getState().reorderPendingQueueItemToFront(sessionId, item.localId);
  }

  private armFallback(sessionId: string): void {
    this.clearFallback(sessionId);
    const timer = setTimeout(() => {
      this.fallbackTimers.delete(sessionId);
      this.inFlight.delete(sessionId);
      this.forceUnpaused.delete(sessionId);
      this.schedule(sessionId);
    }, DISPATCH_FALLBACK_MS);
    this.fallbackTimers.set(sessionId, timer);
  }

  private clearFallback(sessionId: string): void {
    const timer = this.fallbackTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.fallbackTimers.delete(sessionId);
    }
  }

  private releaseGate(sessionId: string, options?: { retry?: boolean }): void {
    this.inFlight.delete(sessionId);
    this.clearFallback(sessionId);
    if (options?.retry) {
      this.schedule(sessionId);
    }
  }
}

export const pendingQueueDispatcher = new PendingQueueDispatcher();
