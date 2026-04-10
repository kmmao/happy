import { storage } from "@/sync/storage";
import { extractLatestOptions } from "@/hooks/useLatestOptions";
import {
    type AutoOptionSendContext,
    type AutoOptionSendEvent,
    type AutoOptionSendState,
    type SessionFollowUpOptionsSnapshot,
    buildOptionsHash,
    createInitialAutoOptionSendState,
    getRecommendedOptionIndex,
    reduceAutoOptionSendEvent,
} from "@/-session/autoOptionSend";
import { type Message } from "@/sync/typesMessage";

const DURATION_MS = 10_000;

interface SnapshotWithFreshness {
    snapshot: SessionFollowUpOptionsSnapshot;
    /** true when options come from the latest agent turn (no user message after). */
    isFresh: boolean;
}

function buildSnapshotFromMessages(
    messages: Message[],
): SnapshotWithFreshness | null {
    const result = extractLatestOptions(messages);
    if (result.items.length < 2) return null;

    // Determine freshness: options are fresh if no user-text appears before
    // the source message in the (newest-first) message list.
    let isFresh = true;
    if (result.sourceMessageId) {
        for (const msg of messages) {
            if (msg.id === result.sourceMessageId) break;
            if (msg.kind === "user-text") {
                isFresh = false;
                break;
            }
        }
    }

    return {
        snapshot: {
            sourceType: "markdown-options",
            sourceMessageId: result.sourceMessageId,
            items: result.items,
            recommendedIndex: getRecommendedOptionIndex(result.items),
            optionsHash: buildOptionsHash(result.items),
        },
        isFresh,
    };
}

function hasPendingAskUserQuestion(messages: readonly Message[]): boolean {
    for (const msg of messages) {
        if (msg.kind === "tool-call") {
            if (
                msg.tool.name === "AskUserQuestion" &&
                msg.tool.state === "running" &&
                msg.tool.permission?.status === "pending"
            ) {
                return true;
            }
            if (
                msg.children.length > 0 &&
                hasPendingAskUserQuestion(msg.children)
            ) {
                return true;
            }
        }
    }
    return false;
}

class AutoOptionSendService {
    private states = new Map<string, AutoOptionSendState>();
    private timers = new Map<string, ReturnType<typeof setInterval>>();
    private listeners = new Map<string, Set<() => void>>();
    private sendMessageFn:
        | ((sessionId: string, text: string) => Promise<void>)
        | null = null;

    /** Called once by sync.ts during init. */
    init(sendMessage: (sessionId: string, text: string) => Promise<void>): void {
        this.sendMessageFn = sendMessage;
        const sessions =
            storage.getState().localSettings.autoOptionSendSessions ?? {};
        for (const [sessionId, enabled] of Object.entries(sessions)) {
            if (enabled) {
                this.states.set(sessionId, {
                    ...createInitialAutoOptionSendState(),
                    enabled: true,
                    status: "idle",
                });
            }
        }
    }

    /** Called by sync.ts after new messages are applied for a session. */
    onMessages(sessionId: string): void {
        const state = this.states.get(sessionId);
        if (!state?.enabled) return;
        this.checkAndDispatch(sessionId);
    }

    /** Called by sync.ts when a session reaches the ready (turn-end) state. */
    onReady(sessionId: string): void {
        const state = this.states.get(sessionId);
        if (!state?.enabled) return;
        this.checkAndDispatch(sessionId);
    }

    /** Toggle auto-send for a session. Called from UI. */
    toggle(sessionId: string, enabled: boolean): void {
        const current =
            this.states.get(sessionId) ?? createInitialAutoOptionSendState();
        const messages =
            storage.getState().sessionMessages[sessionId]?.messages ?? [];
        const result = buildSnapshotFromMessages(messages);
        const context = this.buildContext(sessionId, result?.snapshot ?? null, messages, Date.now());

        const next = reduceAutoOptionSendEvent(
            current,
            { type: "toggle", enabled },
            context,
        );
        // Stale options (previous turn): skip countdown, stay idle
        const final =
            next.status === "armed" && result && !result.isFresh
                ? { ...next, status: "idle" as const, candidate: null, remainingMs: null }
                : next;
        this.applyStateChange(sessionId, current, final);
        this.persistEnabled(sessionId, final.enabled);
    }

    /**
     * Dispatch an arbitrary event from the UI (e.g. context-invalidated when
     * user starts typing while viewing the session).
     */
    dispatch(sessionId: string, event: AutoOptionSendEvent): void {
        const state = this.states.get(sessionId);
        if (!state) return;
        const messages =
            storage.getState().sessionMessages[sessionId]?.messages ?? [];
        const result = buildSnapshotFromMessages(messages);
        const context = this.buildContext(sessionId, result?.snapshot ?? null, messages, Date.now());
        const next = reduceAutoOptionSendEvent(state, event, context);
        this.applyStateChange(sessionId, state, next);
    }

    getState(sessionId: string): AutoOptionSendState {
        return this.states.get(sessionId) ?? createInitialAutoOptionSendState();
    }

    subscribe(sessionId: string, cb: () => void): () => void {
        if (!this.listeners.has(sessionId)) {
            this.listeners.set(sessionId, new Set());
        }
        this.listeners.get(sessionId)!.add(cb);
        return () => {
            this.listeners.get(sessionId)?.delete(cb);
        };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────────────

    private checkAndDispatch(sessionId: string): void {
        const state = this.states.get(sessionId);
        if (!state?.enabled) return;

        const messages =
            storage.getState().sessionMessages[sessionId]?.messages ?? [];
        const result = buildSnapshotFromMessages(messages);
        const snapshot = result?.snapshot ?? null;
        const context = this.buildContext(sessionId, snapshot, messages, Date.now());

        const event = snapshot
            ? ({ type: "options-updated" } as const)
            : ({ type: "context-invalidated", reason: "options-missing" } as const);

        const next = reduceAutoOptionSendEvent(state, event, context);
        // Stale options (previous turn): skip countdown, stay idle
        const final =
            next.status === "armed" && result && !result.isFresh
                ? { ...next, status: "idle" as const, candidate: null, remainingMs: null }
                : next;
        this.applyStateChange(sessionId, state, final);
    }

    private buildContext(
        sessionId: string,
        snapshot: SessionFollowUpOptionsSnapshot | null,
        messages: Message[],
        now: number,
    ): AutoOptionSendContext {
        const session = storage.getState().sessions[sessionId];
        return {
            sessionId,
            currentSessionId: sessionId,
            inputText: "",
            hasPendingImages: false,
            isSttListening: false,
            hasAskUserQuestionVisible: hasPendingAskUserQuestion(messages),
            isCurrentSessionActive: session?.active ?? false,
            now,
            durationMs: DURATION_MS,
            snapshot,
        };
    }

    /** Apply a state transition and manage timer side-effects. */
    private applyStateChange(
        sessionId: string,
        prev: AutoOptionSendState,
        next: AutoOptionSendState,
    ): void {
        if (next === prev) return;

        const wasArmed = prev.status === "armed";
        const isArmed = next.status === "armed";

        this.setState(sessionId, next);

        if (isArmed && !wasArmed) {
            this.startTimer(sessionId);
        } else if (!isArmed && wasArmed) {
            this.clearTimer(sessionId);
        }
    }

    private startTimer(sessionId: string): void {
        this.clearTimer(sessionId);
        const interval = setInterval(() => {
            const state = this.states.get(sessionId);
            if (!state || state.status !== "armed" || !state.candidate) {
                this.clearTimer(sessionId);
                return;
            }

            const remaining = Math.max(
                0,
                state.candidate.startedAt +
                    state.candidate.durationMs -
                    Date.now(),
            );

            this.setState(sessionId, { ...state, remainingMs: remaining });

            if (remaining <= 0) {
                this.clearTimer(sessionId);
                this.fireTimerFinished(sessionId);
            }
        }, 250);
        this.timers.set(sessionId, interval);
    }

    private clearTimer(sessionId: string): void {
        const timer = this.timers.get(sessionId);
        if (timer != null) {
            clearInterval(timer);
            this.timers.delete(sessionId);
        }
    }

    private fireTimerFinished(sessionId: string): void {
        const state = this.states.get(sessionId);
        if (!state || state.status !== "armed") return;

        const messages =
            storage.getState().sessionMessages[sessionId]?.messages ?? [];
        const result = buildSnapshotFromMessages(messages);
        const now = Date.now();
        const context = this.buildContext(sessionId, result?.snapshot ?? null, messages, now);

        const readyState = reduceAutoOptionSendEvent(
            state,
            { type: "timer-finished" },
            context,
        );
        if (readyState.status !== "ready") {
            this.setState(sessionId, readyState);
            return;
        }

        const firedState = reduceAutoOptionSendEvent(
            readyState,
            { type: "attempt-fire" },
            context,
        );

        // Clear shouldSendText before notifying UI
        const textToSend = firedState.shouldSendText;
        this.setState(sessionId, { ...firedState, shouldSendText: null });

        if (textToSend) {
            this.sendMessageFn?.(sessionId, textToSend).catch(() => {});
        }
    }

    private setState(sessionId: string, state: AutoOptionSendState): void {
        this.states.set(sessionId, state);
        this.notify(sessionId);
    }

    private notify(sessionId: string): void {
        const cbs = this.listeners.get(sessionId);
        if (!cbs || cbs.size === 0) return;
        for (const cb of cbs) {
            cb();
        }
    }

    private persistEnabled(sessionId: string, enabled: boolean): void {
        const current =
            storage.getState().localSettings.autoOptionSendSessions ?? {};
        if (enabled) {
            if (current[sessionId] !== true) {
                storage.getState().applyLocalSettings({
                    autoOptionSendSessions: { ...current, [sessionId]: true },
                });
            }
        } else {
            if (current[sessionId] != null) {
                const { [sessionId]: _, ...rest } = current;
                storage.getState().applyLocalSettings({
                    autoOptionSendSessions: rest,
                });
            }
        }
    }
}

export const autoOptionSendService = new AutoOptionSendService();
