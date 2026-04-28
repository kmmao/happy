import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldPublishCountdownRemaining } from "./autoOptionCountdown";
import type { Message } from "./typesMessage";

const applyLocalSettings = vi.fn();
const sendMessage = vi.fn<(
    sessionId: string,
    text: string,
    displayText?: string,
    options?: { source?: "auto-option-send" },
) => Promise<void>>();

const storageState = {
    sessions: {
        "session-1": { active: true },
    },
    sessionMessages: {} as Record<string, { messages: Message[] }>,
    localSettings: {},
    applyLocalSettings,
};

vi.mock("@/sync/storage", () => ({
    storage: {
        getState: () => storageState,
    },
}));

vi.mock("@/hooks/useLatestOptions", () => ({
    extractLatestOptions: (messages: Message[]) => {
        const source = messages.find((message) => message.kind === "agent-text");
        if (!source || source.kind !== "agent-text") {
            return { items: [], sourceMessageId: null };
        }
        return {
            items: ["修复 autoOptionSendService.ts 的倒计时", "整理检查清单"],
            sourceMessageId: source.id,
        };
    },
}));

vi.mock("./projectManager", () => ({
    projectManager: {
        getProjectForSession: () => null,
    },
}));

vi.mock("./autoOptionFeedback", () => ({
    getAutoOptionFeedbackStats: () => ({
        send: 0,
        editSend: 0,
        timeoutIgnore: 0,
        dismiss: 0,
        total: 0,
    }),
    recordAutoOptionFeedback: vi.fn(),
}));

vi.mock("./apiOptionScore", () => ({
    scoreOptionsRemote: vi.fn(),
}));

vi.mock("./sync", () => ({
    sync: {
        getCredentials: () => null,
    },
}));

describe("shouldPublishCountdownRemaining", () => {
    it("does not publish sub-second countdown changes", () => {
        expect(shouldPublishCountdownRemaining(15_000, 14_750)).toBe(false);
        expect(shouldPublishCountdownRemaining(14_750, 14_500)).toBe(false);
        expect(shouldPublishCountdownRemaining(14_250, 14_001)).toBe(false);
    });

    it("publishes when the displayed countdown second changes", () => {
        expect(shouldPublishCountdownRemaining(15_000, 14_000)).toBe(true);
        expect(shouldPublishCountdownRemaining(14_001, 13_999)).toBe(true);
    });

    it("always publishes countdown completion", () => {
        expect(shouldPublishCountdownRemaining(250, 0)).toBe(true);
        expect(shouldPublishCountdownRemaining(null, 0)).toBe(true);
    });

    it("keeps using the last published value across skipped interval ticks", () => {
        let publishedRemaining = 15_000;

        for (const nextRemaining of [14_750, 14_500, 14_250, 14_001]) {
            if (shouldPublishCountdownRemaining(publishedRemaining, nextRemaining)) {
                publishedRemaining = nextRemaining;
            }
        }

        expect(publishedRemaining).toBe(15_000);
        expect(shouldPublishCountdownRemaining(publishedRemaining, 14_000)).toBe(true);
    });
});

describe("AutoOptionSendService timer", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        const localStorageData = new Map<string, string>();
        vi.stubGlobal("localStorage", {
            getItem: vi.fn((key: string) => localStorageData.get(key) ?? null),
            setItem: vi.fn((key: string, value: string) => {
                localStorageData.set(key, value);
            }),
        });
        sendMessage.mockResolvedValue(undefined);
        applyLocalSettings.mockClear();
        storageState.localSettings = {};
        storageState.sessionMessages = {
            "session-1": {
                messages: [
                    {
                        kind: "agent-text",
                        id: "agent-1",
                        localId: null,
                        createdAt: 1_000,
                        text: "Options:\n- 修复 autoOptionSendService.ts 的倒计时\n- 整理检查清单",
                    },
                ],
            },
        };
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it("fires the recommended option when countdown reaches zero", async () => {
        const { createAutoOptionSendServiceForTesting } = await import("./autoOptionSendService");
        const service = createAutoOptionSendServiceForTesting();
        service.init(sendMessage);

        service.toggle("session-1", true);
        expect(service.getState("session-1").status).toBe("armed");
        await vi.advanceTimersByTimeAsync(15_000);
        await vi.runOnlyPendingTimersAsync();

        expect(sendMessage).toHaveBeenCalledWith(
            "session-1",
            "修复 autoOptionSendService.ts 的倒计时",
            undefined,
            { source: "auto-option-send" },
        );
    });

    it("does not fire when toggled off before countdown reaches zero", async () => {
        const { createAutoOptionSendServiceForTesting } = await import("./autoOptionSendService");
        const service = createAutoOptionSendServiceForTesting();
        service.init(sendMessage);

        service.toggle("session-1", true);
        await vi.advanceTimersByTimeAsync(5_000);
        service.toggle("session-1", false);
        await vi.advanceTimersByTimeAsync(15_000);

        expect(sendMessage).not.toHaveBeenCalled();
        expect(service.getState("session-1").status).toBe("off");
    });
});
