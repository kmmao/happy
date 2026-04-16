import { describe, expect, it } from "vitest";

import { createResolvedRuntimeProfile } from "@kmmao/happy-wire";
import { getBuiltInProfile } from "@/sync/profileUtils";
import { buildSessionRespawnProfile } from "./sessionUpgradeProfile";

describe("buildSessionRespawnProfile", () => {
    it("rebuilds runtime profile for custom session profile during CLI upgrade", () => {
        const customProfile = {
            id: "custom-openai",
            name: "Custom OpenAI",
            version: "1.0.0",
            environmentVariables: [
                { name: "OPENAI_API_KEY", value: "sk-test" },
                { name: "OPENAI_BASE_URL", value: "https://example.com/v1" },
            ],
            compatibility: { claude: true, codex: true, gemini: false },
            isBuiltIn: false,
            createdAt: 1,
            updatedAt: 1,
        } as const;

        const result = buildSessionRespawnProfile(
            {
                id: "session-1",
                profileId: "custom-openai",
                profileName: "Custom OpenAI",
            } as any,
            [customProfile as any],
        );

        expect(result.profileId).toBe("custom-openai");
        expect(result.environmentVariables).toEqual({
            OPENAI_API_KEY: "sk-test",
            OPENAI_BASE_URL: "https://example.com/v1",
        });
        expect(result.runtimeProfile).toEqual(
            createResolvedRuntimeProfile(customProfile as any, {
                source: "account-profile",
                trust: "trusted",
                environmentVariables: {
                    OPENAI_API_KEY: "sk-test",
                    OPENAI_BASE_URL: "https://example.com/v1",
                },
            }),
        );
    });

    it("rebuilds runtime profile for built-in session profile during CLI upgrade", () => {
        const builtInProfile = getBuiltInProfile("openai");
        expect(builtInProfile).not.toBeNull();

        const result = buildSessionRespawnProfile(
            {
                id: "session-1",
                profileId: "openai",
                profileName: builtInProfile!.name,
            } as any,
            [],
        );

        expect(result.profileId).toBe("openai");
        expect(result.environmentVariables).toMatchObject({
            OPENAI_BASE_URL: "https://api.openai.com/v1",
            OPENAI_MODEL: "gpt-5.4",
        });
        expect(result.runtimeProfile).toEqual(
            createResolvedRuntimeProfile(builtInProfile!, {
                source: "built-in-profile",
                trust: "trusted",
                environmentVariables: result.environmentVariables,
            }),
        );
    });

    it("falls back to legacy profileId-only behavior when profile can no longer be resolved", () => {
        const result = buildSessionRespawnProfile(
            {
                id: "session-1",
                profileId: "missing-profile",
                profileName: "Missing Profile",
            } as any,
            [],
        );

        expect(result).toEqual({
            profileId: "missing-profile",
        });
    });
});
