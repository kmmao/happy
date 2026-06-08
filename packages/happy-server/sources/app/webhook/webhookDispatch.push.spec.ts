import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    webhookRouteFindMany: vi.fn(),
    projectFindMany: vi.fn(),
    txRunFindFirst: vi.fn(),
    txRunCreate: vi.fn(),
    txProjectUpdate: vi.fn(),
    inTx: vi.fn(),
    decryptString: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    checkDailyRunLimit: vi.fn(),
    _emitEphemeralInternal: vi.fn(),
    buildSupervisorTriggerEphemeral: vi.fn((payload: unknown) => payload),
    authCreateSupervisorCallbackToken: vi.fn(),
    parseDefaultProfileId: vi.fn(),
    resolveSupervisorProfile: vi.fn(),
    log: vi.fn(),
}));

vi.mock("@/storage/db", () => ({
    db: {
        webhookRoute: {
            findMany: mocks.webhookRouteFindMany,
        },
        project: {
            findMany: mocks.projectFindMany,
        },
    },
}));

vi.mock("@/storage/inTx", () => ({
    inTx: mocks.inTx,
}));

vi.mock("@/modules/encrypt", () => ({
    decryptString: mocks.decryptString,
}));

vi.mock("./webhookVerify", () => ({
    verifyWebhookSignature: mocks.verifyWebhookSignature,
}));

vi.mock("@/modules/supervisorLimits", () => ({
    checkDailyRunLimit: mocks.checkDailyRunLimit,
}));

vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: {
        _emitEphemeralInternal: mocks._emitEphemeralInternal,
    },
    buildSessionActivityEphemeral: vi.fn((payload: unknown) => payload),
    buildSupervisorTriggerEphemeral: mocks.buildSupervisorTriggerEphemeral,
}));

vi.mock("@/app/auth/auth", () => ({
    auth: {
        createSupervisorCallbackToken: mocks.authCreateSupervisorCallbackToken,
    },
}));

vi.mock("@/modules/supervisorProfileResolver", () => ({
    parseDefaultProfileId: mocks.parseDefaultProfileId,
    resolveSupervisorProfile: mocks.resolveSupervisorProfile,
}));

vi.mock("@/app/presence/sessionCache", () => ({
    activityCache: {},
}));

vi.mock("./webhookFetchLabels", () => ({
    fetchIssueLabelsFromProvider: vi.fn(),
}));

vi.mock("@/utils/log", () => ({
    log: mocks.log,
}));

import { dispatchWebhook } from "./webhookDispatch";

describe("dispatchWebhook push supervisor trigger", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mocks.webhookRouteFindMany.mockResolvedValue([
            {
                id: "route-1",
                accountId: "user-1",
                repoUrl: "https://github.com/owner/repo",
                provider: "github",
                enabled: true,
                webhookSecret: new Uint8Array([1, 2, 3]),
            },
        ]);
        mocks.projectFindMany.mockResolvedValue([
            {
                id: "project-1",
                accountId: "user-1",
                machineId: "machine-1",
                path: "/repo",
                supervisorMode: "suggest",
                supervisorEnabledDimensions: "security,architecture",
                supervisorCustomRules: "focus on auth",
                supervisorConfig: JSON.stringify({
                    defaultProfileId: "profile-1",
                }),
            },
        ]);
        mocks.txRunFindFirst.mockResolvedValue(null);
        mocks.txRunCreate.mockResolvedValue({ id: "run-1" });
        mocks.txProjectUpdate.mockResolvedValue({});
        mocks.inTx.mockImplementation(async (callback: (tx: unknown) => unknown) =>
            callback({
                supervisorRun: {
                    findFirst: mocks.txRunFindFirst,
                    create: mocks.txRunCreate,
                },
                project: {
                    update: mocks.txProjectUpdate,
                },
            }),
        );
        mocks.decryptString.mockReturnValue("secret");
        mocks.verifyWebhookSignature.mockReturnValue(true);
        mocks.checkDailyRunLimit.mockResolvedValue({
            allowed: true,
            currentCount: 0,
            limit: 10,
        });
        mocks.authCreateSupervisorCallbackToken.mockResolvedValue("callback-token");
        mocks.parseDefaultProfileId.mockReturnValue("profile-1");
        mocks.resolveSupervisorProfile.mockResolvedValue({
            runtimeProfile: {
                schemaVersion: 1,
                profileId: "profile-1",
                profileName: "Profile 1",
                source: "account-profile",
                trust: "trusted",
                environmentVariables: {
                    OPENAI_API_KEY: "sk-live",
                },
            },
        });
    });

    it("resolves and injects runtimeProfile for push-triggered supervisor runs", async () => {
        const body = {
            ref: "refs/heads/main",
            commits: [{ modified: ["src/index.ts"] }],
            repository: { html_url: "https://github.com/owner/repo" },
            pusher: { name: "alice" },
        };
        const rawBody = JSON.stringify(body);

        const result = await dispatchWebhook(
            "github",
            rawBody,
            {
                "x-github-event": "push",
                "x-github-delivery": "delivery-1",
                "x-hub-signature-256": "sha256=test",
            },
            body,
        );

        expect(result).toEqual({ dispatched: true, reason: undefined });
        expect(mocks.parseDefaultProfileId).toHaveBeenCalledWith(
            JSON.stringify({ defaultProfileId: "profile-1" }),
        );
        expect(mocks.resolveSupervisorProfile).toHaveBeenCalledWith(
            "user-1",
            "profile-1",
        );
        expect(mocks.buildSupervisorTriggerEphemeral).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: "project-1",
                runId: "run-1",
                trigger: "push",
                callbackToken: "callback-token",
                changedFiles: ["src/index.ts"],
                runtimeProfile: expect.objectContaining({
                    profileId: "profile-1",
                    environmentVariables: {
                        OPENAI_API_KEY: "sk-live",
                    },
                }),
            }),
        );
    });
});
