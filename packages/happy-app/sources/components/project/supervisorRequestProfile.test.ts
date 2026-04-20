import { describe, expect, it } from "vitest";

import { createResolvedRuntimeProfile } from "@kmmao/happy-wire";
import { getBuiltInProfile } from "@/sync/profileUtils";
import {
    buildDefaultSupervisorRequestProfile,
    buildSupervisorRequestProfile,
} from "./supervisorRequestProfile";

describe("buildSupervisorRequestProfile", () => {
    it("builds a trusted runtimeProfile for pure built-in supervisor profiles", () => {
        const builtInProfile = getBuiltInProfile("openai");
        expect(builtInProfile).not.toBeNull();

        const result = buildSupervisorRequestProfile("openai", []);

        expect(result.profileId).toBe("openai");
        expect(result.runtimeProfile).toEqual(
            createResolvedRuntimeProfile(builtInProfile!, {
                source: "built-in-profile",
                trust: "trusted",
                environmentVariables: {
                    OPENAI_BASE_URL: "https://api.openai.com/v1",
                    OPENAI_MODEL: "gpt-5.4",
                    OPENAI_API_TIMEOUT_MS: "600000",
                    OPENAI_SMALL_FAST_MODEL: "gpt-5.4",
                    API_TIMEOUT_MS: "600000",
                    CODEX_SMALL_FAST_MODEL: "gpt-5.4",
                },
            }),
        );
    });

    it("keeps profileId-only behavior when the profile exists in synced account settings", () => {
        const result = buildSupervisorRequestProfile("openai", [
            {
                id: "openai",
                name: "OpenAI Override",
                openaiConfig: {
                    apiKey: "sk-account",
                },
                environmentVariables: [],
                compatibility: { claude: false, codex: true, gemini: false },
                isBuiltIn: true,
                createdAt: 1,
                updatedAt: 1,
                version: "1.0.0",
            } as any,
        ]);

        expect(result).toEqual({
            profileId: "openai",
        });
    });

    it("falls back to profileId-only behavior when the profile cannot be resolved locally", () => {
        expect(buildSupervisorRequestProfile("missing-profile", [])).toEqual({
            profileId: "missing-profile",
        });
    });
});

describe("buildDefaultSupervisorRequestProfile", () => {
    it("resolves a built-in defaultProfileId from supervisor config", () => {
        const builtInProfile = getBuiltInProfile("openai");
        expect(builtInProfile).not.toBeNull();

        expect(
            buildDefaultSupervisorRequestProfile(
                JSON.stringify({ defaultProfileId: "openai" }),
                [],
            ),
        ).toEqual({
            profileId: "openai",
            runtimeProfile: createResolvedRuntimeProfile(builtInProfile!, {
                source: "built-in-profile",
                trust: "trusted",
                environmentVariables: {
                    OPENAI_BASE_URL: "https://api.openai.com/v1",
                    OPENAI_MODEL: "gpt-5.4",
                    OPENAI_API_TIMEOUT_MS: "600000",
                    OPENAI_SMALL_FAST_MODEL: "gpt-5.4",
                    API_TIMEOUT_MS: "600000",
                    CODEX_SMALL_FAST_MODEL: "gpt-5.4",
                },
            }),
        });
    });

    it("returns an empty request when supervisor config has no default profile", () => {
        expect(
            buildDefaultSupervisorRequestProfile(
                JSON.stringify({ mode: "suggest" }),
                [],
            ),
        ).toEqual({});
    });
});
