import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { log } from "@/log";
import { randomUUID } from "expo-crypto";
import type { NormalizedMessage } from "./typesRaw";

/**
 * State for background send watchdog, owned by Sync but operated on
 * by these standalone helper functions.
 */
export type BackgroundSendState = {
    backgroundSendTimeout: ReturnType<typeof setTimeout> | null;
    backgroundSendNotificationId: string | null;
    backgroundSendStartedAt: number | null;
    appState: string;
    sendAbortControllers: Map<string, AbortController>;
    pendingOutbox: Map<string, { localId: string; content: string }[]>;
    BACKGROUND_SEND_TIMEOUT_MS: number;
};

export function hasPendingOutboxMessages(state: BackgroundSendState): boolean {
    if (state.sendAbortControllers.size > 0) {
        return true;
    }
    for (const messages of state.pendingOutbox.values()) {
        if (messages.length > 0) {
            return true;
        }
    }
    return false;
}

export function maybeStartBackgroundSendWatchdog(
    state: BackgroundSendState,
    onTimeout: () => Promise<void>,
    scheduleNotification: () => Promise<void>,
): void {
    if (Platform.OS === "web" || state.appState === "active") {
        return;
    }
    if (!hasPendingOutboxMessages(state) || state.backgroundSendTimeout) {
        return;
    }

    log.log(
        "📨 Pending messages detected in background. Starting 30s send watchdog.",
    );
    state.backgroundSendStartedAt = Date.now();
    state.backgroundSendTimeout = setTimeout(() => {
        state.backgroundSendTimeout = null;
        void onTimeout();
    }, state.BACKGROUND_SEND_TIMEOUT_MS);
    void scheduleNotification();
}

export function clearBackgroundSendWatchdog(state: BackgroundSendState): void {
    if (state.backgroundSendTimeout) {
        clearTimeout(state.backgroundSendTimeout);
        state.backgroundSendTimeout = null;
    }
    state.backgroundSendStartedAt = null;
}

export async function scheduleBackgroundSendTimeoutNotification(
    state: BackgroundSendState,
): Promise<void> {
    if (Platform.OS === "web" || state.backgroundSendNotificationId) {
        return;
    }
    try {
        state.backgroundSendNotificationId =
            await Notifications.scheduleNotificationAsync({
                content: {
                    title: "Message not sent",
                    body: "A message is still sending in the background. It will fail in 30 seconds if not delivered.",
                    sound: true,
                },
                trigger: {
                    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
                    seconds: Math.ceil(state.BACKGROUND_SEND_TIMEOUT_MS / 1000),
                },
            });
    } catch (error) {
        log.log(
            `Failed to schedule background send timeout notification: ${error}`,
        );
    }
}

export async function cancelBackgroundSendTimeoutNotification(
    state: BackgroundSendState,
): Promise<void> {
    if (!state.backgroundSendNotificationId) {
        return;
    }
    try {
        await Notifications.cancelScheduledNotificationAsync(
            state.backgroundSendNotificationId,
        );
    } catch (error) {
        log.log(
            `Failed to cancel background send timeout notification: ${error}`,
        );
    } finally {
        state.backgroundSendNotificationId = null;
    }
}

export async function notifyMessageSendFailed(): Promise<void> {
    if (Platform.OS === "web") {
        return;
    }
    try {
        await Notifications.scheduleNotificationAsync({
            content: {
                title: "Message failed",
                body: "A message failed to send while the app was in background. Open Happy and retry.",
                sound: true,
            },
            trigger: null,
        });
    } catch (error) {
        log.log(`Failed to schedule message failure notification: ${error}`);
    }
}

export function failPendingOutboxMessages(
    state: BackgroundSendState,
    reasonText: string,
    enqueueMessages: (sessionId: string, messages: NormalizedMessage[]) => void,
): void {
    for (const controller of state.sendAbortControllers.values()) {
        controller.abort();
    }
    state.sendAbortControllers.clear();

    const now = Date.now();
    const sessionIds: string[] = [];
    for (const [sessionId, pending] of state.pendingOutbox) {
        if (pending.length === 0) {
            continue;
        }
        pending.length = 0;
        state.pendingOutbox.delete(sessionId);
        sessionIds.push(sessionId);
    }

    for (const sessionId of sessionIds) {
        enqueueMessages(sessionId, [
            {
                id: randomUUID(),
                localId: null,
                createdAt: now,
                role: "event",
                isSidechain: false,
                content: {
                    type: "message",
                    message: reasonText,
                },
            },
        ]);
    }
}

export async function handleBackgroundSendTimeout(
    state: BackgroundSendState,
    enqueueMessages: (sessionId: string, messages: NormalizedMessage[]) => void,
): Promise<void> {
    if (!hasPendingOutboxMessages(state)) {
        await cancelBackgroundSendTimeoutNotification(state);
        state.backgroundSendStartedAt = null;
        return;
    }

    await cancelBackgroundSendTimeoutNotification(state);
    await notifyMessageSendFailed();
    failPendingOutboxMessages(
        state,
        "Message failed to send in background after 30s. Please retry.",
        enqueueMessages,
    );
    state.backgroundSendStartedAt = null;
}
