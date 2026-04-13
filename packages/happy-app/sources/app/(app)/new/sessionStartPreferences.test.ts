import { describe, expect, it, vi } from "vitest";
import { applySessionStartPreferences } from "./sessionStartPreferences";

describe("applySessionStartPreferences", () => {
    it("hydrates session SDK settings before the first message is sent", () => {
        const storage = {
            updateSessionPermissionMode: vi.fn(),
            updateSessionModelMode: vi.fn(),
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
    });
});
