import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    resolveSupervisorProfile: vi.fn(),
}));

vi.mock("@/modules/supervisorProfileResolver", async () => {
    const actual =
        await vi.importActual<typeof import("./supervisorProfileResolver")>(
            "./supervisorProfileResolver",
        );
    return {
        ...actual,
        resolveSupervisorProfile: mocks.resolveSupervisorProfile,
    };
});

import { resolveConfiguredSupervisorProfile } from "./supervisorConfiguredProfile";

describe("resolveConfiguredSupervisorProfile", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveSupervisorProfile.mockResolvedValue({
            runtimeProfile: {
                schemaVersion: 1,
                profileId: "openai",
                profileName: "OpenAI (GPT-5.4)",
                source: "built-in-profile",
                trust: "trusted",
                environmentVariables: {
                    OPENAI_BASE_URL: "https://api.openai.com/v1",
                },
            },
        });
    });

    it("prefers an explicit trusted built-in runtimeProfile over config defaults", async () => {
        const result = await resolveConfiguredSupervisorProfile({
            userId: "user-1",
            supervisorConfig: JSON.stringify({ defaultProfileId: "anthropic" }),
            runtimeProfile: {
                profileId: "openai",
                profileName: "OpenAI (GPT-5.4)",
                source: "built-in-profile",
                trust: "trusted",
                isBuiltIn: true,
                environmentVariables: {
                    OPENAI_BASE_URL: "https://api.openai.com/v1",
                },
            },
        });

        expect(result).toEqual({
            ok: true,
            resolvedProfile: expect.objectContaining({
                runtimeProfile: expect.objectContaining({
                    profileId: "openai",
                }),
            }),
        });
        expect(mocks.resolveSupervisorProfile).toHaveBeenCalledWith(
            "user-1",
            "openai",
        );
    });

    it("falls back to defaultProfileId from supervisorConfig when no explicit request profile exists", async () => {
        const result = await resolveConfiguredSupervisorProfile({
            userId: "user-1",
            supervisorConfig: JSON.stringify({ defaultProfileId: "openai" }),
        });

        expect(result).toEqual({
            ok: true,
            resolvedProfile: expect.objectContaining({
                runtimeProfile: expect.objectContaining({
                    profileId: "openai",
                }),
            }),
        });
        expect(mocks.resolveSupervisorProfile).toHaveBeenCalledWith(
            "user-1",
            "openai",
        );
    });

    it("rejects invalid runtimeProfile payloads", async () => {
        const result = await resolveConfiguredSupervisorProfile({
            userId: "user-1",
            supervisorConfig: JSON.stringify({ defaultProfileId: "anthropic" }),
            runtimeProfile: {
                profileId: "profile-1",
                profileName: "Profile 1",
                source: "account-profile",
                trust: "trusted",
                environmentVariables: {},
            },
        });

        expect(result).toEqual({
            ok: false,
            error: "Supervisor runtime profile payload is invalid or unsupported",
        });
        expect(mocks.resolveSupervisorProfile).not.toHaveBeenCalled();
    });
});
