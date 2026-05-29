import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldPublishCountdownRemaining } from "./autoOptionCountdown";
import type { Message } from "./typesMessage";

const applyLocalSettings = vi.fn();
let credentials: { token: string } | null = null;
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
        getCredentials: () => credentials,
    },
}));

vi.mock("react-native-mmkv", () => ({
    MMKV: class {
        getString() { return undefined; }
        set() {}
        delete() {}
        clearAll() {}
    },
}));

vi.mock("react-native", () => ({
    Platform: { OS: "web" },
}));

vi.mock("./serverConfig", () => ({
    getServerUrl: () => "http://localhost:3000",
}));

vi.mock("./apiOptionGenerate", () => ({
    generateOptionsRemote: vi.fn(),
}));

vi.mock("@/log", () => ({
    log: {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
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
        credentials = null;
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

    it("disposes countdown state and clears the session timer", async () => {
        const { createAutoOptionSendServiceForTesting } = await import("./autoOptionSendService");
        const service = createAutoOptionSendServiceForTesting();
        const internals = service as unknown as { activeSessionId: string | null };
        service.init(sendMessage);

        service.toggle("session-1", true);
        internals.activeSessionId = "session-1";
        expect(service.getState("session-1").status).toBe("armed");
        expect(vi.getTimerCount()).toBeGreaterThan(0);

        service.disposeSession("session-1");

        expect(vi.getTimerCount()).toBe(0);
        expect(service.getState("session-1").status).toBe("off");
        expect(internals.activeSessionId).toBeNull();
    });

    it("aborts and removes session controllers", async () => {
        const { createAutoOptionSendServiceForTesting } = await import("./autoOptionSendService");
        const service = createAutoOptionSendServiceForTesting();
        const abortSpy = vi.spyOn(AbortController.prototype, "abort");
        const semanticController = new AbortController();
        const passiveController = new AbortController();
        const generationController = new AbortController();
        const autoGenerationController = new AbortController();
        const internals = service as unknown as {
            semanticControllers: Map<string, AbortController>;
            passiveScoringControllers: Map<string, AbortController>;
            generationControllers: Map<string, AbortController>;
            autoGenerationControllers: Map<string, AbortController>;
        };

        internals.semanticControllers.set("session-1", semanticController);
        internals.passiveScoringControllers.set("session-1", passiveController);
        internals.generationControllers.set("session-1", generationController);
        internals.autoGenerationControllers.set("session-1", autoGenerationController);

        service.disposeSession("session-1");

        expect(semanticController.signal.aborted).toBe(true);
        expect(passiveController.signal.aborted).toBe(true);
        expect(generationController.signal.aborted).toBe(true);
        expect(autoGenerationController.signal.aborted).toBe(true);
        expect(abortSpy).toHaveBeenCalledTimes(4);
        expect(internals.semanticControllers.has("session-1")).toBe(false);
        expect(internals.passiveScoringControllers.has("session-1")).toBe(false);
        expect(internals.generationControllers.has("session-1")).toBe(false);
        expect(internals.autoGenerationControllers.has("session-1")).toBe(false);
    });
});
