/**
 * SessionController hook layer (see CONTEXT.md "SessionController").
 *
 * Hybrid shape: BOTTOM hooks give subscription-grained reads over the narrow
 * SessionStorageOps / AutoOptionSend faces (useSyncExternalStore — same
 * pattern as appLockState.ts); the TOP hook `useSessionController(sessionId)`
 * exposes ONLY the cross-domain atoms — it is never a data aggregator.
 * Components needing reads use the bottom hooks directly.
 */

import * as React from "react";
import { randomUUID } from "expo-crypto";
import { storage } from "@/sync/storage";
import { pendingQueueDispatcher } from "@/sync/pendingQueueDispatcher";
import { autoOptionSendService } from "@/sync/autoOptionSendService";
import { sessionInterrupt } from "@/sync/ops";
import { trackMessageSent } from "@/track";
import { adaptStorage, type PendingQueueItem, type SessionStorageOps } from "./sessionStorageOps";
import { createSessionController, type SessionController } from "./sessionController";

// Production SessionStorageOps — one adapter instance over the app store.
let productionOps: SessionStorageOps | null = null;
function getProductionOps(): SessionStorageOps {
    if (!productionOps) {
        productionOps = adaptStorage(storage);
    }
    return productionOps;
}

/** Subscription-grained read of a session's pending queue. */
export function useSessionPendingQueue(sessionId: string): readonly PendingQueueItem[] {
    const ops = getProductionOps();
    return React.useSyncExternalStore(
        ops.subscribe,
        () => ops.getQueue(sessionId),
        () => ops.getQueue(sessionId),
    );
}

/** Subscription-grained read of a session's queue-paused flag. */
export function useSessionQueuePaused(sessionId: string): boolean {
    const ops = getProductionOps();
    return React.useSyncExternalStore(
        ops.subscribe,
        () => ops.getPaused(sessionId),
        () => ops.getPaused(sessionId),
    );
}

/**
 * Read-only AutoOptionSend face for a session — state machine snapshot plus
 * the generated options, subscription-grained on the service's own emitter.
 */
export function useSessionAutoOptionState(sessionId: string) {
    const subscribe = React.useCallback(
        (cb: () => void) => autoOptionSendService.subscribe(sessionId, cb),
        [sessionId],
    );
    const state = React.useSyncExternalStore(
        subscribe,
        () => autoOptionSendService.getState(sessionId),
        () => autoOptionSendService.getState(sessionId),
    );
    const generatedOptions = autoOptionSendService.getGeneratedOptions(sessionId);
    return { state, generatedOptions };
}

/**
 * Write-only AutoOptionSend face for a session. Stable identity per
 * sessionId; components pass these down without re-render coupling to the
 * read side.
 */
export function useSessionAutoOptionActions(sessionId: string) {
    return React.useMemo(
        () => ({
            toggle: (enabled: boolean) => autoOptionSendService.toggle(sessionId, enabled),
            dispatch: (event: Parameters<typeof autoOptionSendService.dispatch>[1]) =>
                autoOptionSendService.dispatch(sessionId, event),
            recordManualSend: (
                optionText: string,
                optionsHash: string,
                edited: boolean,
                source: "auto" | "manual",
            ) => autoOptionSendService.recordManualSend(sessionId, optionText, optionsHash, edited, source),
            recordDismiss: (optionText: string | null, optionsHash: string | null) =>
                autoOptionSendService.recordDismiss(sessionId, optionText, optionsHash),
            triggerScoringIfNeeded: (items: string[], optionsHash: string) =>
                autoOptionSendService.triggerScoringIfNeeded(sessionId, items, optionsHash),
            triggerGenerationIfNeeded: () =>
                autoOptionSendService.triggerGenerationIfNeeded(sessionId),
            updateUIContext: (
                ctx: Parameters<typeof autoOptionSendService.updateUIContext>[1],
            ) => autoOptionSendService.updateUIContext(sessionId, ctx),
        }),
        [sessionId],
    );
}

/**
 * The cross-domain atoms for one session. ONLY atoms — reads live in the
 * bottom hooks above. Stable identity per sessionId.
 */
export function useSessionController(sessionId: string): SessionController {
    return React.useMemo(
        () =>
            createSessionController({
                sessionId,
                deps: {
                    dispatcher: pendingQueueDispatcher,
                    autoOption: autoOptionSendService,
                    storage: getProductionOps(),
                    interruptSession: sessionInterrupt,
                    trackMessageSent,
                    generateLocalId: randomUUID,
                },
            }),
        [sessionId],
    );
}
