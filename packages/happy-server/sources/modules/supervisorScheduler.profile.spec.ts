import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    projectFindMany: vi.fn(),
    projectUpdate: vi.fn(),
    dbTransaction: vi.fn(),
    txRunFindFirst: vi.fn(),
    txProjectUpdateMany: vi.fn(),
    txRunCreate: vi.fn(),
    checkDailyRunLimit: vi.fn(),
    incrementDailyRunCount: vi.fn(),
    emitEphemeral: vi.fn(),
    buildSupervisorTriggerEphemeral: vi.fn((payload: unknown) => payload),
    authCreateSupervisorCallbackToken: vi.fn(),
    parseDefaultProfileId: vi.fn(),
    resolveSupervisorProfile: vi.fn(),
    log: vi.fn(),
}));

vi.mock("@/storage/db", () => ({
    db: {
        project: {
            findMany: mocks.projectFindMany,
            update: mocks.projectUpdate,
        },
        $transaction: mocks.dbTransaction,
    },
}));

vi.mock("@/utils/log", () => ({
    log: mocks.log,
}));

vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: {
        emitEphemeral: mocks.emitEphemeral,
    },
    buildSupervisorTriggerEphemeral: mocks.buildSupervisorTriggerEphemeral,
}));

vi.mock("./supervisorLimits", () => ({
    checkDailyRunLimit: mocks.checkDailyRunLimit,
    incrementDailyRunCount: mocks.incrementDailyRunCount,
}));

vi.mock("@/app/auth/auth", () => ({
    auth: {
        createSupervisorCallbackToken: mocks.authCreateSupervisorCallbackToken,
    },
}));

vi.mock("./supervisorProfileResolver", () => ({
    parseDefaultProfileId: mocks.parseDefaultProfileId,
    resolveSupervisorProfile: mocks.resolveSupervisorProfile,
}));

import { checkAndTriggerScheduledRuns } from "./supervisorScheduler";

describe("checkAndTriggerScheduledRuns", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mocks.projectFindMany.mockResolvedValue([
            {
                id: "project-1",
                path: "/repo",
                supervisorMode: "suggest",
                supervisorScheduleIntervalHours: 24,
                supervisorEnabledDimensions: "security,architecture",
                supervisorCustomRules: "focus on auth",
                supervisorConfig: JSON.stringify({
                    defaultProfileId: "profile-1",
                    maxFindings: 7,
                }),
                supervisorNextRunAt: new Date("2026-04-20T00:00:00.000Z"),
            },
        ]);
        mocks.checkDailyRunLimit.mockResolvedValue({
            allowed: true,
            currentCount: 0,
            limit: 10,
        });
        mocks.txRunFindFirst.mockResolvedValue(null);
        mocks.txProjectUpdateMany.mockResolvedValue({ count: 1 });
        mocks.txRunCreate.mockResolvedValue({ id: "run-1" });
        mocks.dbTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
            callback({
                supervisorRun: {
                    findFirst: mocks.txRunFindFirst,
                    create: mocks.txRunCreate,
                },
                project: {
                    updateMany: mocks.txProjectUpdateMany,
                },
            }),
        );
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
            profileName: "Profile 1",
        });
        mocks.authCreateSupervisorCallbackToken.mockResolvedValue("callback-token");
    });

    it("resolves and injects runtimeProfile for scheduled supervisor runs", async () => {
        await checkAndTriggerScheduledRuns("machine-1", "user-1");

        expect(mocks.parseDefaultProfileId).toHaveBeenCalledWith(
            JSON.stringify({
                defaultProfileId: "profile-1",
                maxFindings: 7,
            }),
        );
        expect(mocks.resolveSupervisorProfile).toHaveBeenCalledWith(
            "user-1",
            "profile-1",
        );
        expect(mocks.buildSupervisorTriggerEphemeral).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: "project-1",
                runId: "run-1",
                trigger: "scheduled",
                machineId: "machine-1",
                repoPath: "/repo",
                mode: "suggest",
                dimensions: ["security", "architecture"],
                customRules: "focus on auth",
                maxFindings: 7,
                callbackToken: "callback-token",
                runtimeProfile: expect.objectContaining({
                    profileId: "profile-1",
                    environmentVariables: {
                        OPENAI_API_KEY: "sk-live",
                    },
                }),
            }),
        );
        expect(mocks.emitEphemeral).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: "user-1",
                recipientFilter: {
                    type: "machine-scoped-only",
                    machineId: "machine-1",
                },
                payload: expect.objectContaining({
                    runtimeProfile: expect.objectContaining({
                        profileId: "profile-1",
                    }),
                }),
            }),
        );
    });
});
