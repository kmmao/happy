import { describe, expect, it, vi } from "vitest";
import {
    applySessionStartPreferences,
    buildForkSessionStartPreferences,
} from "./sessionStartPreferences";

describe("applySessionStartPreferences", () => {
    it("hydrates session SDK settings before the first message is sent", () => {
        const storage = {
            updateSessionPermissionMode: vi.fn(),
            updateSessionModelMode: vi.fn(),
            updateSessionPinnedModelId: vi.fn(),
            updateSessionSdkSettings: vi.fn(),
            updateSessionCustomModels: vi.fn(),
            updateSessionModelMappings: vi.fn(),
            updateSessionProfile: vi.fn(),
        };

        applySessionStartPreferences(storage, {
            sessionId: "session-1",
            permissionModeKey: "yolo",
            modelModeKey: "default",
            sdkSettings: {
                effortLevel: "high",
            },
            profile: {
                id: "openai",
                name: "OpenAI (GPT-4/Codex)",
            },
        });

        expect(storage.updateSessionPermissionMode).toHaveBeenCalledWith(
            "session-1",
            "yolo",
        );
        expect(storage.updateSessionModelMode).toHaveBeenCalledWith(
            "session-1",
            "default",
        );
        expect(storage.updateSessionPinnedModelId).toHaveBeenCalledWith(
            "session-1",
            null,
        );
        expect(storage.updateSessionSdkSettings).toHaveBeenCalledWith(
            "session-1",
            {
                effortLevel: "high",
            },
        );
        expect(storage.updateSessionProfile).toHaveBeenCalledWith("session-1", {
            profileId: "openai",
            profileName: "OpenAI (GPT-4/Codex)",
        });
    });

    it("skips the SDK update when there is no session-level runtime preference", () => {
        const storage = {
            updateSessionPermissionMode: vi.fn(),
            updateSessionModelMode: vi.fn(),
            updateSessionPinnedModelId: vi.fn(),
            updateSessionSdkSettings: vi.fn(),
            updateSessionCustomModels: vi.fn(),
            updateSessionModelMappings: vi.fn(),
            updateSessionProfile: vi.fn(),
        };

        applySessionStartPreferences(storage, {
            sessionId: "session-1",
            permissionModeKey: "default",
            modelModeKey: null,
            sdkSettings: {},
        });

        expect(storage.updateSessionSdkSettings).not.toHaveBeenCalled();
        expect(storage.updateSessionPinnedModelId).toHaveBeenCalledWith(
            "session-1",
            null,
        );
    });

    it("builds forked session preferences by copying the source session model and profile settings", () => {
        expect(
            buildForkSessionStartPreferences(
                {
                    id: "source-session",
                    permissionMode: "plan",
                    modelMode: "gpt-5.4-pro",
                    pinnedModelId: "gpt-5.4-pro",
                    customModels: [
                        {
                            id: "gpt-5.4-pro",
                            name: "GPT-5.4 Pro",
                        },
                    ],
                    modelMappings: {
                        sonnet: "gpt-5.4-pro",
                    },
                    profileId: "custom-openai",
                    profileName: "Custom OpenAI",
                    thinkingMode: "enabled",
                    thinkingBudget: 4096,
                    effortLevel: "high",
                    maxBudgetUsd: 2.5,
                    taskBudgetTokens: 12000,
                } as any,
                "fork-session",
            ),
        ).toEqual({
            sessionId: "fork-session",
            permissionModeKey: "plan",
            modelModeKey: "gpt-5.4-pro",
            pinnedModelId: "gpt-5.4-pro",
            sdkSettings: {
                thinkingMode: "enabled",
                thinkingBudget: 4096,
                effortLevel: "high",
                maxBudgetUsd: 2.5,
                taskBudgetTokens: 12000,
            },
            customModels: [
                {
                    id: "gpt-5.4-pro",
                    name: "GPT-5.4 Pro",
                },
            ],
            modelMappings: {
                sonnet: "gpt-5.4-pro",
            },
            profile: {
                id: "custom-openai",
                name: "Custom OpenAI",
            },
        });
    });
});
