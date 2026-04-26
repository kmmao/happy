import { storage } from "@/sync/storage";
import { extractLatestOptions } from "@/hooks/useLatestOptions";
import {
    type AutoOptionSendContext,
    type AutoOptionSendEvent,
    type AutoOptionSendState,
    type SessionFollowUpOptionsSnapshot,
    buildAutoSentKey,
    buildOptionsHash,
    createInitialAutoOptionSendState,
    getRecommendedOptionIndex,
    rankAndSelectOptions,
    reduceAutoOptionSendEvent,
} from "@/-session/autoOptionSend";
import { type Message } from "@/sync/typesMessage";
import { getAutoOptionFeedbackStats, recordAutoOptionFeedback } from "./autoOptionFeedback";
import { projectManager } from "./projectManager";
import { log } from "@/log";
import { scoreOptionsRemote } from "./apiOptionScore";
import { buildOptionScoringContext } from "@/-session/buildOptionScoringContext";
import { sync } from "./sync";

const DURATION_MS = 15_000;

/** localStorage key prefix for cross-tab send lock. */
const LOCK_PREFIX = "happy-aos-lock:";
/** BroadcastChannel name for cross-tab coordination. */
const CHANNEL_NAME = "happy-auto-option-send";
/** How long a localStorage lock stays valid (ms). */
const LOCK_TTL_MS = 30_000;

interface CrossTabMessage {
    type: "fired";
    tabId: string;
    sessionId: string;
    optionsHash: string;
}

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

interface UIContext {
    inputText: string;
    hasPendingImages: boolean;
    isSttListening: boolean;
}

const DEFAULT_UI_CONTEXT: UIContext = {
    inputText: "",
    hasPendingImages: false,
    isSttListening: false,
};

class AutoOptionSendService {
    private states = new Map<string, AutoOptionSendState>();
    private timers = new Map<string, ReturnType<typeof setInterval>>();
    private listeners = new Map<string, Set<() => void>>();
    private uiContexts = new Map<string, UIContext>();
    private sendMessageFn:
        | ((
            sessionId: string,
            text: string,
            displayText?: string,
            options?: { source?: "auto-option-send" },
        ) => Promise<void>)
        | null = null;

    /** Unique ID for this tab/instance, used for cross-tab dedup. */
    private readonly tabId = Math.random().toString(36).slice(2, 10);
    /** BroadcastChannel for cross-tab coordination (web only). */
    private channel: BroadcastChannel | null = null;

    private semanticScores = new Map<string, Map<number, number>>();
    private semanticControllers = new Map<string, AbortController>();
    private lastSemanticScoredAt = new Map<string, number>();
    private static readonly SEMANTIC_COOLDOWN_MS = 30_000;
    private static readonly SEMANTIC_SCORE_GAP_THRESHOLD = 15;

    /** Called once by sync.ts during init. */
    init(
        sendMessage: (
            sessionId: string,
            text: string,
            displayText?: string,
            options?: { source?: "auto-option-send" },
        ) => Promise<void>,
    ): void {
        this.sendMessageFn = sendMessage;
        const sessions =
            storage.getState().localSettings.autoOptionSendSessions ?? {};
        for (const [sessionId, enabled] of Object.entries(sessions)) {
            // Skip sessions already tracked in memory — a reconnect/restore call
            // must not clobber in-memory state (e.g. user toggled off via
            // context-invalidated but storage still shows enabled).
            if (enabled && !this.states.has(sessionId)) {
                this.states.set(sessionId, {
                    ...createInitialAutoOptionSendState(),
                    enabled: true,
                    status: "idle",
                });
            }
        }

        // Cross-tab coordination (web only, no-op on React Native)
        if (typeof BroadcastChannel !== "undefined") {
            try {
                this.channel = new BroadcastChannel(CHANNEL_NAME);
                this.channel.onmessage = (event: MessageEvent) => {
                    this.handleCrossTabMessage(event.data);
                };
            } catch {
                // BroadcastChannel not supported or blocked
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

    /** Called by SessionView to keep the service aware of current UI state. */
    updateUIContext(sessionId: string, ctx: Partial<UIContext>): void {
        const prev = this.uiContexts.get(sessionId) ?? DEFAULT_UI_CONTEXT;
        this.uiContexts.set(sessionId, { ...prev, ...ctx });
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

        if (event.type === "context-invalidated" && event.reason === "options-missing" && state.candidate) {
            this.recordFeedbackFromCandidate(
                sessionId,
                state.candidate.optionsHash,
                state.candidate.recommendedText,
                "timeout_ignore",
                false,
                "auto",
                state.candidate.qualityScore,
                Date.now() - state.candidate.startedAt,
            );
        }

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

    recordManualSend(
        sessionId: string,
        optionText: string,
        optionsHash: string,
        edited: boolean,
        source: "auto" | "manual",
    ): void {
        const state = this.states.get(sessionId);
        const scoreBefore = state?.candidate?.recommendedText === optionText
            ? state.candidate.qualityScore
            : null;
        const latencyMs = state?.candidate?.recommendedText === optionText
            ? Date.now() - state.candidate.startedAt
            : null;

        this.recordFeedbackFromCandidate(
            sessionId,
            optionsHash,
            optionText,
            edited ? "edit_send" : "send",
            edited,
            source,
            scoreBefore,
            latencyMs,
        );
    }

    recordDismiss(
        sessionId: string,
        optionText: string | null,
        optionsHash: string | null,
    ): void {
        if (!optionText || !optionsHash) return;
        const state = this.states.get(sessionId);
        const scoreBefore = state?.candidate?.recommendedText === optionText
            ? state.candidate.qualityScore
            : null;
        const latencyMs = state?.candidate?.recommendedText === optionText
            ? Date.now() - state.candidate.startedAt
            : null;

        this.recordFeedbackFromCandidate(
            sessionId,
            optionsHash,
            optionText,
            "dismiss",
            false,
            "manual",
            scoreBefore,
            latencyMs,
        );
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
        const project = projectManager.getProjectForSession(sessionId);
        const projectId = project?.id ?? `session:${sessionId}`;
        const ui = this.uiContexts.get(sessionId) ?? DEFAULT_UI_CONTEXT;
        return {
            sessionId,
            currentSessionId: sessionId,
            inputText: ui.inputText,
            hasPendingImages: ui.hasPendingImages,
            isSttListening: ui.isSttListening,
            hasAskUserQuestionVisible: hasPendingAskUserQuestion(messages),
            isCurrentSessionActive: session?.active ?? false,
            now,
            durationMs: DURATION_MS,
            snapshot,
            statsResolver: (optionText: string) =>
                getAutoOptionFeedbackStats(projectId, optionText),
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
            this.triggerSemanticScoring(sessionId);
        } else if (!isArmed && wasArmed) {
            this.clearTimer(sessionId);
            this.cancelSemanticScoring(sessionId);
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
                // Capture the candidate identity so the deferred callback can verify
                // the state hasn't changed (re-armed or toggled off) in the interim.
                const firedHash = state.candidate.optionsHash;
                const firedStartedAt = state.candidate.startedAt;
                // Defer to next macrotask so any pending user events (e.g. toggle-off
                // clicks queued in the same 250 ms window) run first and can cancel.
                setTimeout(() => {
                    const latestState = this.states.get(sessionId);
                    if (
                        !latestState ||
                        latestState.status !== "armed" ||
                        latestState.candidate?.optionsHash !== firedHash ||
                        latestState.candidate?.startedAt !== firedStartedAt
                    ) {
                        return;
                    }
                    this.fireTimerFinished(sessionId);
                }, 0);
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

    private cancelSemanticScoring(sessionId: string): void {
        const controller = this.semanticControllers.get(sessionId);
        if (controller) {
            controller.abort();
            this.semanticControllers.delete(sessionId);
        }
    }

    private triggerSemanticScoring(sessionId: string): void {
        const state = this.states.get(sessionId);
        if (!state?.candidate) return;

        const optionsHash = state.candidate.optionsHash;

        if (this.semanticScores.has(optionsHash)) return;

        const now = Date.now();
        const lastScored = this.lastSemanticScoredAt.get(sessionId) ?? 0;
        if (now - lastScored < AutoOptionSendService.SEMANTIC_COOLDOWN_MS) return;

        const messages =
            storage.getState().sessionMessages[sessionId]?.messages ?? [];
        const result = buildSnapshotFromMessages(messages);
        if (!result?.snapshot) return;

        const items = result.snapshot.items;
        const heuristicResult = rankAndSelectOptions(items);
        const scores = [...heuristicResult.allScores.values()];
        scores.sort((a, b) => b - a);
        if (scores.length >= 2 && scores[0] - scores[1] > AutoOptionSendService.SEMANTIC_SCORE_GAP_THRESHOLD) return;

        const credentials = sync.getCredentials();
        if (!credentials) return;

        const contextSummary = buildOptionScoringContext(messages, null);
        const controller = new AbortController();
        this.cancelSemanticScoring(sessionId);
        this.semanticControllers.set(sessionId, controller);
        this.lastSemanticScoredAt.set(sessionId, now);

        const session = storage.getState().sessions[sessionId];
        const profileId = session?.profileId ?? null;
        const scoringOverrides = storage.getState().localSettings.scoringModelOverride ?? {};
        const modelOverride = Object.keys(scoringOverrides).length > 0
            ? JSON.stringify(scoringOverrides)
            : null;

        scoreOptionsRemote(credentials, items, contextSummary, null, profileId, modelOverride, controller.signal)
            .then((response) => {
                this.semanticControllers.delete(sessionId);

                const current = this.states.get(sessionId);
                if (!current || current.status !== "armed" || !current.candidate) return;
                if (current.candidate.optionsHash !== optionsHash) return;

                const semanticMap = new Map<number, number>();
                response.scores.forEach((s, i) => semanticMap.set(i, s));
                this.semanticScores.set(optionsHash, semanticMap);

                const projectId = this.resolveProjectId(sessionId);
                const statsResolver = (optionText: string) =>
                    getAutoOptionFeedbackStats(projectId, optionText);
                const reranked = rankAndSelectOptions(items, statsResolver, undefined, semanticMap);

                if (reranked.recommendedIndex !== null) {
                    const selected = reranked.ranked.find((item) => item.index === reranked.recommendedIndex);
                    if (selected && selected.text !== current.candidate.recommendedText) {
                        this.setState(sessionId, {
                            ...current,
                            candidate: {
                                ...current.candidate,
                                recommendedText: selected.text,
                                qualityScore: selected.score,
                                qualityReasons: selected.reasons,
                            },
                        });
                    }
                }
            })
            .catch(() => {
                this.semanticControllers.delete(sessionId);
            });
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
        const optionsHash = state.candidate?.optionsHash ?? "";
        this.setState(sessionId, { ...firedState, shouldSendText: null });

        if (textToSend) {
            // Cross-tab dedup: try to acquire localStorage lock
            if (!this.acquireSendLock(sessionId, optionsHash)) {
                return;
            }

            // Notify other tabs to cancel their timers
            this.broadcastFired(sessionId, optionsHash);

            const prevAutoSentKey = firedState.lastAutoSentKey;

            this.sendMessageFn?.(sessionId, textToSend, undefined, {
                source: "auto-option-send",
            }).then(() => {
                this.recordFeedbackFromCandidate(
                    sessionId,
                    optionsHash,
                    textToSend,
                    "send",
                    false,
                    "auto",
                    state.candidate?.qualityScore ?? null,
                    state.candidate ? now - state.candidate.startedAt : null,
                );
            }).catch(() => {
                log.warn("auto-option-send: sendMessage failed, resetting state for retry");
                this.recordFeedbackFromCandidate(
                    sessionId,
                    optionsHash,
                    textToSend,
                    "timeout_ignore",
                    false,
                    "auto",
                    state.candidate?.qualityScore ?? null,
                    state.candidate ? now - state.candidate.startedAt : null,
                );
                const current = this.states.get(sessionId);
                if (current) {
                    this.setState(sessionId, {
                        ...current,
                        lastAutoSentKey: prevAutoSentKey,
                        lastAutoSentText: current.lastAutoSentText,
                    });
                }
            });
        } else if (state.candidate) {
            this.recordFeedbackFromCandidate(
                sessionId,
                state.candidate.optionsHash,
                state.candidate.recommendedText,
                "timeout_ignore",
                false,
                "auto",
                state.candidate.qualityScore,
                now - state.candidate.startedAt,
            );
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Cross-tab coordination
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Handle a message from another tab via BroadcastChannel.
     * If another tab already fired for the same session+options, cancel our timer.
     */
    private handleCrossTabMessage(data: unknown): void {
        if (!data || typeof data !== "object") return;
        const msg = data as CrossTabMessage;
        if (msg.type !== "fired" || msg.tabId === this.tabId) return;

        const state = this.states.get(msg.sessionId);
        if (!state) return;
        if (state.status !== "armed" && state.status !== "ready") return;
        if (state.candidate?.optionsHash !== msg.optionsHash) return;

        // Another tab already sent this option — cancel our countdown
        this.clearTimer(msg.sessionId);
        this.setState(msg.sessionId, {
            ...state,
            status: "idle",
            candidate: null,
            remainingMs: null,
            lastAutoSentKey: state.candidate
                ? buildAutoSentKey(state.candidate)
                : state.lastAutoSentKey,
            lastAutoSentText:
                state.candidate?.recommendedText ?? state.lastAutoSentText,
            lastCancelReason: "sent-by-other-tab",
            shouldSendText: null,
        });
    }

    /** Broadcast to other tabs that we fired for this session+options. */
    private broadcastFired(sessionId: string, optionsHash: string): void {
        try {
            this.channel?.postMessage({
                type: "fired",
                tabId: this.tabId,
                sessionId,
                optionsHash,
            } satisfies CrossTabMessage);
        } catch {
            // Channel closed or unavailable
        }
    }

    /**
     * Try to claim a send lock via localStorage. Returns true if this tab
     * should proceed with sending (no other tab sent the same options recently).
     *
     * localStorage read→write is NOT atomic across tabs. Two tabs reaching
     * countdown zero within the same event-loop tick can both read "no lock"
     * and both write their own lock, causing duplicate sends. The write-then-
     * re-read check below shrinks this window (only a sub-millisecond overlap
     * between setItem calls can bypass it). BroadcastChannel provides an
     * additional async defense layer.
     */
    private acquireSendLock(
        sessionId: string,
        optionsHash: string,
    ): boolean {
        if (typeof localStorage === "undefined") return true; // React Native

        const key = `${LOCK_PREFIX}${sessionId}`;
        const now = Date.now();

        try {
            const raw = localStorage.getItem(key);
            if (raw) {
                const lock = JSON.parse(raw) as {
                    hash: string;
                    ts: number;
                    tabId: string;
                };
                if (
                    lock.hash === optionsHash &&
                    lock.tabId !== this.tabId &&
                    now - lock.ts < LOCK_TTL_MS
                ) {
                    return false;
                }
            }
        } catch {
            // Corrupt data, proceed and overwrite
        }

        // Claim the lock, then re-read to detect concurrent writers
        const lockValue = JSON.stringify({ hash: optionsHash, ts: now, tabId: this.tabId });
        localStorage.setItem(key, lockValue);

        try {
            const reRead = localStorage.getItem(key);
            if (reRead !== lockValue) {
                const winner = JSON.parse(reRead!) as { tabId: string };
                if (winner.tabId !== this.tabId) {
                    return false;
                }
            }
        } catch {
            // Parse failure on re-read — assume we hold the lock
        }

        return true;
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

    getSemanticScores(optionsHash: string): ReadonlyMap<number, number> | null {
        return this.semanticScores.get(optionsHash) ?? null;
    }

    private resolveProjectId(sessionId: string): string {
        const project = projectManager.getProjectForSession(sessionId);
        return project?.id ?? `session:${sessionId}`;
    }

    private recordFeedbackFromCandidate(
        sessionId: string,
        optionsHash: string,
        optionText: string,
        action: "send" | "edit_send" | "timeout_ignore" | "dismiss",
        edited: boolean,
        source: "auto" | "manual",
        scoreBefore: number | null,
        latencyMs: number | null,
    ): void {
        const projectId = this.resolveProjectId(sessionId);
        recordAutoOptionFeedback({
            projectId,
            sessionId,
            optionText,
            optionHash: optionsHash,
            action,
            source,
            scoreBefore,
            latencyMs,
            edited,
            reason: null,
            ts: Date.now(),
        });
    }
}

export const autoOptionSendService = new AutoOptionSendService();
