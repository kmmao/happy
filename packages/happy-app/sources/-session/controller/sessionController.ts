/**
 * SessionController — the App-side seam bundling every Session-scoped
 * read+write face behind one injection-friendly factory (see CONTEXT.md
 * "SessionController" for the frozen design).
 *
 * Curried by sessionId: each call returns a controller whose methods close
 * over the sessionId (zero-arg atoms). The atom catalog below is a CLOSED
 * set derived from the component call sites — new atoms require updating the
 * CONTEXT.md list. Atoms accept BUSINESS inputs only: Modal confirmations,
 * Keyboard.dismiss, composer field resets, and image-state clearing all stay
 * in the component.
 *
 * Every explicit user send action schedules the dispatcher with
 * `ignorePaused: true` — a user pressing "send now" overrides a paused
 * queue by definition; only the background auto-drain respects the pause.
 * That coupling is protocol invariant #1 and is pinned by the tests.
 */

import type { SessionStorageOps } from "./sessionStorageOps";

/** The AutoOptionSend face the controller needs (autoOptionSendService). */
export interface AutoOptionOps {
    recordManualSend(
        sessionId: string,
        optionText: string,
        optionsHash: string,
        edited: boolean,
        source: "auto" | "manual",
    ): void;
    dispatch(
        sessionId: string,
        event: { type: "context-invalidated"; reason: string },
    ): void;
}

export interface SessionControllerDeps {
    dispatcher: {
        schedule(sessionId: string, options?: { ignorePaused?: boolean }): void;
    };
    autoOption: AutoOptionOps;
    storage: SessionStorageOps;
    interruptSession(sessionId: string): Promise<void>;
    trackMessageSent(): void;
    /** localId allocator — injectable so tests are deterministic. */
    generateLocalId(): string;
}

export interface ComposerSendInput {
    /** The full message that goes on the wire (text + image refs + pastes). */
    finalMessage: string;
    /** What the queue chip displays; undefined falls back to the message. */
    displayText?: string;
    /**
     * When the composer text was seeded from an AI-generated option, the
     * option identity for AutoOptionSend feedback (turn-dedup invariant #2).
     */
    selectedOption?: { text: string; optionsHash: string; edited: boolean };
    /**
     * A follow-up message enqueued right behind the main one (e.g. /caveman
     * chained after /clear); the one-at-a-time drain guarantees ordering.
     */
    chainAfter?: string;
}

export interface SessionController {
    /** Micro-atom: interrupt the running turn, then force a queue drain. */
    interruptAndDispatch(): void;
    /** Send the queue head immediately (alias of interruptAndDispatch). */
    sendHeadNow(): void;
    /** Move an item to the queue head and send it immediately. */
    sendItemNow(localId: string): void;
    /**
     * Save an edited queue item and send it immediately. Returns false when
     * the item no longer exists (already drained) — the caller keeps its
     * overlay open in that case.
     */
    editSaveAndSendImmediately(
        localId: string,
        message: string,
        displayText: string | undefined,
    ): boolean;
    /** Send an AI-generated option tapped in the options popover. */
    sendOptionFromPopover(option: string, optionsHash: string): void;
    /** Send a composed message (the composer's onSend path). */
    sendComposerMessage(input: ComposerSendInput): { localId: string };
}

export function createSessionController(options: {
    deps: SessionControllerDeps;
    sessionId: string;
}): SessionController {
    const { deps, sessionId } = options;
    const { dispatcher, autoOption, storage } = deps;

    // Every atom that fires a send goes through here: interrupt whatever is
    // running, and once the interrupt settles (success OR failure — .finally)
    // force a drain that overrides a paused queue. Invariant #1. The trailing
    // catch is load-bearing: .finally re-throws the interrupt's rejection, and
    // without the catch a failed interrupt becomes an unhandled rejection —
    // the drain already happened, the error carries no further action.
    const interruptAndDispatch = (): void => {
        void deps.interruptSession(sessionId)
            .finally(() => {
                dispatcher.schedule(sessionId, { ignorePaused: true });
            })
            .catch(() => {});
    };

    return {
        interruptAndDispatch,

        sendHeadNow: interruptAndDispatch,

        sendItemNow(localId) {
            storage.reorderPendingQueueItemToFront(sessionId, localId);
            interruptAndDispatch();
        },

        editSaveAndSendImmediately(localId, message, displayText) {
            const ok = storage.updatePendingQueueItem(sessionId, localId, {
                message,
                displayText,
            });
            if (!ok) return false;
            storage.reorderPendingQueueItemToFront(sessionId, localId);
            interruptAndDispatch();
            return true;
        },

        sendOptionFromPopover(option, optionsHash) {
            // Order is load-bearing (invariant #2): record the manual send
            // FIRST so the feedback row captures the live candidate's score,
            // then invalidate the AutoOptionSend context so the auto-send
            // timer cannot double-fire the same option, then enqueue.
            autoOption.recordManualSend(sessionId, option, optionsHash, false, "manual");
            autoOption.dispatch(sessionId, {
                type: "context-invalidated",
                reason: "manual-send",
            });
            storage.appendToPendingQueue(sessionId, {
                localId: deps.generateLocalId(),
                message: option,
            });
            deps.trackMessageSent();
        },

        sendComposerMessage(input) {
            // A composer send seeded from an option records feedback (with
            // edited=true when the user changed the text) but deliberately
            // does NOT dispatch context-invalidated: the composed message may
            // extend the option, and the turn advancing is what clears the
            // AutoOptionSend candidate — mirrors the pre-seam component
            // behavior verbatim.
            if (input.selectedOption) {
                autoOption.recordManualSend(
                    sessionId,
                    input.selectedOption.text,
                    input.selectedOption.optionsHash,
                    input.selectedOption.edited,
                    "manual",
                );
            }
            const localId = deps.generateLocalId();
            // Always enqueue — never send directly. The dual-path "if running
            // enqueue else send" raced: two rapid sends before isRunning
            // round-tripped both took the direct branch and burst onto the
            // wire past every queue/pause guard. The queue makes that race
            // unrepresentable.
            storage.appendToPendingQueue(sessionId, {
                localId,
                message: input.finalMessage,
                displayText: input.displayText,
            });
            if (input.chainAfter) {
                storage.appendToPendingQueue(sessionId, {
                    localId: deps.generateLocalId(),
                    message: input.chainAfter,
                });
            }
            deps.trackMessageSent();
            return { localId };
        },
    };
}
