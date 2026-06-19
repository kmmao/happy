import { storage } from "@/sync/storage";
import { log } from "@/log";
import { isSessionRunning } from "@/utils/sessionUtils";
import { checkSendEligibility } from "@/sync/sendGate";

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

    // Eligibility lives behind a pure gate — see sendGate.ts. The
    // dispatcher only owns the side effects each blocker reason maps to
    // (dispose / clear in-flight latch / clear override). The five-arm
    // cascade that used to live inline (with implicit precedence) is now
    // a typed switch.
    const verdict = checkSendEligibility({
      sessionExists: !!session,
      isSessionRunning: !!session && isSessionRunning(session),
      isInFlight: this.inFlight.has(sessionId),
      isPaused: !!state.sessionPendingQueuePaused[sessionId],
      hasOverride: this.forceUnpaused.has(sessionId),
      queueLength: state.sessionPendingQueues[sessionId]?.length ?? 0,
    });
    if (!verdict.eligible) {
      switch (verdict.reason) {
        case "no-session":
          this.disposeSession(sessionId);
          return;
        case "session-running":
          // A running session will deliver its own ack — drop any held
          // in-flight latch so the next idle transition can schedule.
          if (this.inFlight.has(sessionId)) {
            this.inFlight.delete(sessionId);
            this.clearFallback(sessionId);
          }
          return;
        case "in-flight":
          // Another dispatch is already mid-flight; it will re-schedule.
          return;
        case "paused":
          // No override yet — a future `schedule({ ignorePaused: true })`
          // will lift it.
          return;
        case "empty-queue":
          // Clear standing override so the next paused schedule doesn't
          // auto-bypass.
          this.forceUnpaused.delete(sessionId);
          return;
        default: {
          // Exhaustiveness guard: a new SendBlockReason added to sendGate.ts
          // fails typecheck HERE, forcing its side-effect contract to be
          // handled. At runtime we fail safe — return without sending, never
          // fall through to the dispatch below (a blocked verdict must block).
          const _exhaustive: never = verdict.reason;
          log.error(`pending-queue: unhandled send block reason '${String(_exhaustive)}' for session=${sessionId}; not sending`);
          return;
        }
      }
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
