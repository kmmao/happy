import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    _emitEphemeralInternal: vi.fn(),
    authCreateSupervisorCallbackToken: vi.fn(),
    resolveSupervisorProfile: vi.fn(),
}));

// PR 1.5.f: build*Ephemeral functions moved into syncEphemeral.ts as private
// helpers. We mock only the transport sink and assert on the wire payload
// that reaches it.
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: {
        _emitEphemeralInternal: mocks._emitEphemeralInternal,
    },
}));

vi.mock("@/app/auth/auth", () => ({
    auth: {
        createSupervisorCallbackToken: mocks.authCreateSupervisorCallbackToken,
    },
}));

vi.mock("@/modules/supervisorProfileResolver", async () => {
    const actual = await vi.importActual<typeof import("./supervisorProfileResolver")>(
        "./supervisorProfileResolver",
    );
    return {
        ...actual,
        resolveSupervisorProfile: mocks.resolveSupervisorProfile,
    };
});

import { emitConfiguredSupervisorRunTrigger } from "./supervisorRunTrigger";

describe("emitConfiguredSupervisorRunTrigger", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.authCreateSupervisorCallbackToken.mockResolvedValue("callback-token");
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

    it("uses explicit trusted built-in runtimeProfile hints for manual runs", async () => {
        const result = await emitConfiguredSupervisorRunTrigger({
            userId: "user-1",
            projectId: "project-1",
            runId: "run-1",
            trigger: "manual",
            machineId: "machine-1",
            repoPath: "/repo",
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

        expect(result).toEqual({ ok: true });
        expect(mocks.resolveSupervisorProfile).toHaveBeenCalledWith(
            "user-1",
            "openai",
        );
        expect(mocks.authCreateSupervisorCallbackToken).toHaveBeenCalledWith({
            userId: "user-1",
            projectId: "project-1",
            machineId: "machine-1",
            purpose: "run-status",
            runId: "run-1",
        });
        expect(mocks._emitEphemeralInternal).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: "user-1",
                recipientFilter: {
                    type: "machine-scoped-only",
                    machineId: "machine-1",
                },
                // PR 1.5.f: wire payload is the assertion target after the
                // build*Ephemeral functions became private to syncEphemeral.ts.
                payload: expect.objectContaining({
                    type: "supervisor-trigger",
                    projectId: "project-1",
                    runId: "run-1",
                    trigger: "manual",
                    callbackToken: "callback-token",
                    runtimeProfile: expect.objectContaining({
                        profileId: "openai",
                    }),
                }),
            }),
        );
    });

    it("rejects untrusted or non-built-in runtimeProfile hints", async () => {
        const result = await emitConfiguredSupervisorRunTrigger({
            userId: "user-1",
            projectId: "project-1",
            runId: "run-1",
            trigger: "manual",
            machineId: "machine-1",
            repoPath: "/repo",
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
        expect(mocks.authCreateSupervisorCallbackToken).not.toHaveBeenCalled();
        expect(mocks._emitEphemeralInternal).not.toHaveBeenCalled();
    });
});
