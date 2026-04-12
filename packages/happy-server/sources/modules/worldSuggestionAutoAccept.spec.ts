import { describe, expect, it, vi, beforeEach } from "vitest";

const { worldSuggestionAccept, dbMock } = vi.hoisted(() => ({
    worldSuggestionAccept: vi.fn(async () => ({
        suggestionId: "sug-1",
        createdEntityType: "task",
        createdEntityId: "task-1",
    })),
    dbMock: {
        worldSuggestion: {
            count: vi.fn(async () => 0),
            update: vi.fn(async () => ({})),
        },
        task: {
            count: vi.fn(async () => 0),
        },
    },
}));

vi.mock("./worldSuggestionAccept", () => ({ worldSuggestionAccept }));
vi.mock("@/storage/db", () => ({ db: dbMock }));

import {
    autoAcceptSuggestedTasksIfEnabled,
    buildAutoAcceptAudit,
    countRunningAutoTasks,
    parseWorldSuggestionAutoAcceptProjectConfig,
    resolveWorldAutonomyPolicy,
    shouldAutoAcceptSuggestedTask,
} from "./worldSuggestionAutoAccept";
import type { WorldAutonomyPolicy } from "@kmmao/happy-wire";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(overrides: Partial<WorldAutonomyPolicy> = {}): WorldAutonomyPolicy {
    return {
        level: "semi-auto",
        maxAutoAcceptsPerDay: null,
        maxConcurrentAutoTasks: null,
        autoAcceptTypes: ["suggested_task"],
        ...overrides,
    };
}

function makeSuggestion(overrides: Record<string, any> = {}): any {
    return {
        id: "sug-1",
        projectId: "project-1",
        relatedGoalId: null,
        relatedTaskId: null,
        type: "suggested_task",
        title: "Investigate API retry",
        summary: "summary",
        reason: "reason",
        evidence: [{ kind: "task", id: "task-1", label: "Retry failed" }],
        recommendedRole: "builder",
        payload: {
            task: {
                title: "Investigate API retry",
                prompt: "Inspect retry logic and propose minimal fix",
                priority: "user",
            },
        },
        requiresHuman: false,
        status: "open",
        dedupeKey: "dedupe:1",
        bucket: "next_step",
        createdAt: 1,
        actedAt: null,
        acceptSource: null,
        acceptAudit: null,
        autoAcceptStatus: null,
        autoAcceptReasonCode: null,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// resolveWorldAutonomyPolicy
// ---------------------------------------------------------------------------

describe("resolveWorldAutonomyPolicy", () => {
    it("returns disabled when both supervisorMode and supervisorConfig are null", () => {
        const policy = resolveWorldAutonomyPolicy({ supervisorMode: null, supervisorConfig: null });
        expect(policy.level).toBe("disabled");
    });

    it("reads level from supervisorMode when present", () => {
        const policy = resolveWorldAutonomyPolicy({ supervisorMode: "semi-auto", supervisorConfig: null });
        expect(policy.level).toBe("semi-auto");
    });

    it("maps all valid supervisorMode values", () => {
        for (const mode of ["disabled", "suggest", "semi-auto", "auto"] as const) {
            expect(resolveWorldAutonomyPolicy({ supervisorMode: mode, supervisorConfig: null }).level).toBe(mode);
        }
    });

    it("ignores unknown supervisorMode and falls back to config", () => {
        const policy = resolveWorldAutonomyPolicy({
            supervisorMode: "unknown_mode",
            supervisorConfig: JSON.stringify({ worldAutonomy: { autoAcceptSafeSuggestedTasks: true } }),
        });
        expect(policy.level).toBe("semi-auto");
    });

    it("falls back to semi-auto when supervisorMode is null but legacy boolean is true", () => {
        const policy = resolveWorldAutonomyPolicy({
            supervisorMode: null,
            supervisorConfig: JSON.stringify({ worldAutonomy: { autoAcceptSafeSuggestedTasks: true } }),
        });
        expect(policy.level).toBe("semi-auto");
    });

    it("falls back to disabled when supervisorMode is null and legacy boolean is false", () => {
        const policy = resolveWorldAutonomyPolicy({
            supervisorMode: null,
            supervisorConfig: JSON.stringify({ worldAutonomy: { autoAcceptSafeSuggestedTasks: false } }),
        });
        expect(policy.level).toBe("disabled");
    });

    it("supervisorMode takes precedence over legacy boolean", () => {
        const policy = resolveWorldAutonomyPolicy({
            supervisorMode: "suggest",
            supervisorConfig: JSON.stringify({ worldAutonomy: { autoAcceptSafeSuggestedTasks: true } }),
        });
        expect(policy.level).toBe("suggest");
    });

    it("reads maxAutoAcceptsPerDay from supervisorConfig", () => {
        const policy = resolveWorldAutonomyPolicy({
            supervisorMode: "semi-auto",
            supervisorConfig: JSON.stringify({ worldAutonomy: { maxAutoAcceptsPerDay: 5 } }),
        });
        expect(policy.maxAutoAcceptsPerDay).toBe(5);
    });

    it("reads maxConcurrentAutoTasks from supervisorConfig", () => {
        const policy = resolveWorldAutonomyPolicy({
            supervisorMode: "semi-auto",
            supervisorConfig: JSON.stringify({ worldAutonomy: { maxConcurrentAutoTasks: 3 } }),
        });
        expect(policy.maxConcurrentAutoTasks).toBe(3);
    });

    it("returns null for non-integer or non-positive numeric params", () => {
        const policy = resolveWorldAutonomyPolicy({
            supervisorMode: "auto",
            supervisorConfig: JSON.stringify({ worldAutonomy: { maxAutoAcceptsPerDay: -1, maxConcurrentAutoTasks: 0 } }),
        });
        expect(policy.maxAutoAcceptsPerDay).toBeNull();
        expect(policy.maxConcurrentAutoTasks).toBeNull();
    });

    it("handles malformed JSON gracefully", () => {
        const policy = resolveWorldAutonomyPolicy({ supervisorMode: null, supervisorConfig: "not json" });
        expect(policy.level).toBe("disabled");
    });
});

// ---------------------------------------------------------------------------
// parseWorldSuggestionAutoAcceptProjectConfig (legacy shim)
// ---------------------------------------------------------------------------

describe("parseWorldSuggestionAutoAcceptProjectConfig", () => {
    it("returns disabled by default", () => {
        expect(parseWorldSuggestionAutoAcceptProjectConfig(null)).toEqual({
            autoAcceptSafeSuggestedTasks: false,
            maxAutoAcceptsPerDay: null,
        });
    });

    it("reads boolean flag from supervisorConfig JSON", () => {
        expect(parseWorldSuggestionAutoAcceptProjectConfig(JSON.stringify({
            worldAutonomy: { autoAcceptSafeSuggestedTasks: true },
        }))).toEqual({
            autoAcceptSafeSuggestedTasks: true,
            maxAutoAcceptsPerDay: null,
        });
    });

    it("reads numeric daily limit from supervisorConfig JSON", () => {
        expect(parseWorldSuggestionAutoAcceptProjectConfig(JSON.stringify({
            worldAutonomy: {
                autoAcceptSafeSuggestedTasks: true,
                maxAutoAcceptsPerDay: 2,
            },
        }))).toEqual({
            autoAcceptSafeSuggestedTasks: true,
            maxAutoAcceptsPerDay: 2,
        });
    });
});

// ---------------------------------------------------------------------------
// shouldAutoAcceptSuggestedTask
// ---------------------------------------------------------------------------

describe("shouldAutoAcceptSuggestedTask", () => {
    it("returns true for low-risk suggested_task in semi-auto mode", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy(),
            suggestion: makeSuggestion(),
        })).toBe(true);
    });

    it("returns false when policy level is disabled", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy({ level: "disabled" }),
            suggestion: makeSuggestion(),
        })).toBe(false);
    });

    it("returns false when policy level is suggest", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy({ level: "suggest" }),
            suggestion: makeSuggestion(),
        })).toBe(false);
    });

    it("returns true in auto mode for eligible task", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy({ level: "auto" }),
            suggestion: makeSuggestion(),
        })).toBe(true);
    });

    it("returns false for non-open suggestions", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy(),
            suggestion: makeSuggestion({ status: "accepted" }),
        })).toBe(false);
    });

    it("returns false for non-task suggestions", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy(),
            suggestion: makeSuggestion({
                type: "suggested_goal",
                payload: { goal: { title: "Create follow-up goal" } },
            }),
        })).toBe(false);
    });

    it("returns false for task suggestions outside next_step bucket", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy(),
            suggestion: makeSuggestion({ bucket: "needs_human_input" }),
        })).toBe(false);
    });

    it("returns false when evidence contains message or decision", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy(),
            suggestion: makeSuggestion({
                evidence: [{ kind: "decision", id: "dec-1", label: "Pending decision" }],
            }),
        })).toBe(false);
    });

    it("returns false when requiresHuman is true", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy(),
            suggestion: makeSuggestion({ requiresHuman: true }),
        })).toBe(false);
    });

    it("returns false when task title is empty", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy(),
            suggestion: makeSuggestion({
                payload: { task: { title: "  ", prompt: "valid prompt" } },
            }),
        })).toBe(false);
    });

    it("returns false for retryable_failed_task dedupeKey when policy is semi-auto", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy({ level: "semi-auto" }),
            suggestion: makeSuggestion({ dedupeKey: "retryable_failed_task:task-1:1:timeout" }),
        })).toBe(false);
    });

    it("returns true for retryable_failed_task dedupeKey when policy is auto", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy({ level: "auto" }),
            suggestion: makeSuggestion({ dedupeKey: "retryable_failed_task:task-1:1:timeout" }),
        })).toBe(true);
    });

    it("returns false for blocked_goal_supplement dedupeKey when policy is semi-auto", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy({ level: "semi-auto" }),
            suggestion: makeSuggestion({ dedupeKey: "blocked_goal_supplement:goal-1:task_failed:err" }),
        })).toBe(false);
    });

    it("returns true for blocked_goal_supplement dedupeKey when policy is auto", () => {
        expect(shouldAutoAcceptSuggestedTask({
            policy: makePolicy({ level: "auto" }),
            suggestion: makeSuggestion({ dedupeKey: "blocked_goal_supplement:goal-1:task_failed:err" }),
        })).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// buildAutoAcceptAudit
// ---------------------------------------------------------------------------

describe("buildAutoAcceptAudit", () => {
    it("builds a stable reason snapshot for eligible task suggestions", () => {
        const audit = buildAutoAcceptAudit({ suggestion: makeSuggestion() });
        expect(audit).toEqual({
            rule: "safe_suggested_task_auto_accept",
            checks: [
                "type:suggested_task",
                "bucket:next_step",
                "requiresHuman:false",
                "payload:task_title_prompt_present",
                "evidence:no_message_decision",
                "dedupeKey:dedupe",
            ],
        });
    });

    it("selects retryable_failed_task_auto_accept rule for retryable dedupeKey", () => {
        const audit = buildAutoAcceptAudit({
            suggestion: makeSuggestion({ dedupeKey: "retryable_failed_task:task-1:1:timeout" }),
        });
        expect(audit.rule).toBe("retryable_failed_task_auto_accept");
        expect(audit.checks).toContain("dedupeKey:retryable_failed_task");
    });

    it("selects blocked_goal_supplement_auto_accept rule for supplement dedupeKey", () => {
        const audit = buildAutoAcceptAudit({
            suggestion: makeSuggestion({ dedupeKey: "blocked_goal_supplement:goal-1:task_failed:syntax error" }),
        });
        expect(audit.rule).toBe("blocked_goal_supplement_auto_accept");
        expect(audit.checks).toContain("dedupeKey:blocked_goal_supplement");
    });
});

// ---------------------------------------------------------------------------
// countRunningAutoTasks
// ---------------------------------------------------------------------------

describe("countRunningAutoTasks", () => {
    beforeEach(() => vi.clearAllMocks());

    it("queries tasks with triggerType suggestion_auto and running-like statuses", async () => {
        dbMock.task.count.mockResolvedValue(2);
        const result = await countRunningAutoTasks({ accountId: "user-1", projectId: "project-1" });
        expect(result).toBe(2);
        expect(dbMock.task.count).toHaveBeenCalledWith({
            where: {
                accountId: "user-1",
                projectId: "project-1",
                triggerType: "suggestion_auto",
                status: { in: ["dispatching", "running"] },
            },
        });
    });
});

// ---------------------------------------------------------------------------
// autoAcceptSuggestedTasksIfEnabled
// ---------------------------------------------------------------------------

describe("autoAcceptSuggestedTasksIfEnabled", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMock.worldSuggestion.count.mockResolvedValue(0);
        dbMock.task.count.mockResolvedValue(0);
    });

    it("does nothing when supervisorMode is disabled", async () => {
        await autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: "disabled",
            supervisorConfig: null,
            suggestions: [makeSuggestion()],
        });
        expect(worldSuggestionAccept).not.toHaveBeenCalled();
    });

    it("does nothing when supervisorMode is suggest", async () => {
        await autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: "suggest",
            supervisorConfig: null,
            suggestions: [makeSuggestion()],
        });
        expect(worldSuggestionAccept).not.toHaveBeenCalled();
    });

    it("auto-accepts when supervisorMode is semi-auto", async () => {
        await autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: "semi-auto",
            supervisorConfig: null,
            suggestions: [makeSuggestion()],
        });
        expect(worldSuggestionAccept).toHaveBeenCalledWith(expect.objectContaining({
            suggestionId: "sug-1",
            acceptSource: "system_auto",
        }));
    });

    it("falls back to legacy boolean when supervisorMode is null", async () => {
        await autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: null,
            supervisorConfig: JSON.stringify({ worldAutonomy: { autoAcceptSafeSuggestedTasks: true } }),
            suggestions: [makeSuggestion()],
        });
        expect(worldSuggestionAccept).toHaveBeenCalledTimes(1);
    });

    it("does not auto-accept when supervisorMode is null and legacy boolean is absent", async () => {
        await autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: null,
            supervisorConfig: null,
            suggestions: [makeSuggestion()],
        });
        expect(worldSuggestionAccept).not.toHaveBeenCalled();
    });

    it("records skipped status with concurrency_exceeded when running auto tasks hit limit", async () => {
        dbMock.task.count.mockResolvedValue(3);

        await autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: "semi-auto",
            supervisorConfig: JSON.stringify({ worldAutonomy: { maxConcurrentAutoTasks: 3 } }),
            suggestions: [makeSuggestion()],
        });

        expect(worldSuggestionAccept).not.toHaveBeenCalled();
        expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "sug-1" },
            data: {
                autoAcceptStatus: "skipped",
                autoAcceptReasonCode: "concurrency_exceeded",
            },
        });
    });

    it("proceeds when running auto tasks are below concurrency limit", async () => {
        dbMock.task.count.mockResolvedValue(1);

        await autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: "semi-auto",
            supervisorConfig: JSON.stringify({ worldAutonomy: { maxConcurrentAutoTasks: 3 } }),
            suggestions: [makeSuggestion()],
        });

        expect(worldSuggestionAccept).toHaveBeenCalledTimes(1);
    });

    it("skips concurrency check when maxConcurrentAutoTasks is null", async () => {
        dbMock.task.count.mockResolvedValue(100);

        await autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: "semi-auto",
            supervisorConfig: null,
            suggestions: [makeSuggestion()],
        });

        // Should not have called task.count since maxConcurrentAutoTasks is null
        expect(dbMock.task.count).not.toHaveBeenCalled();
        expect(worldSuggestionAccept).toHaveBeenCalledTimes(1);
    });

    it("records skipped status when daily quota is exhausted", async () => {
        dbMock.worldSuggestion.count.mockResolvedValue(2);

        await autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: "semi-auto",
            supervisorConfig: JSON.stringify({ worldAutonomy: { maxAutoAcceptsPerDay: 2 } }),
            suggestions: [makeSuggestion()],
        });

        expect(worldSuggestionAccept).not.toHaveBeenCalled();
        expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "sug-1" },
            data: {
                autoAcceptStatus: "skipped",
                autoAcceptReasonCode: "quota_exhausted",
            },
        });
    });

    it("only auto-accepts up to remaining daily quota", async () => {
        dbMock.worldSuggestion.count.mockResolvedValue(1);

        await autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: "semi-auto",
            supervisorConfig: JSON.stringify({ worldAutonomy: { maxAutoAcceptsPerDay: 2 } }),
            suggestions: [
                makeSuggestion({ id: "sug-1" }),
                makeSuggestion({ id: "sug-2", dedupeKey: "dedupe:2" }),
            ],
        });

        expect(worldSuggestionAccept).toHaveBeenCalledTimes(1);
        expect(worldSuggestionAccept).toHaveBeenCalledWith(expect.objectContaining({ suggestionId: "sug-1" }));
    });

    it("records skipped/already_acted and expires when accept loses race", async () => {
        worldSuggestionAccept.mockRejectedValueOnce(new Error("Suggestion not found or already acted upon"));

        await autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: "semi-auto",
            supervisorConfig: null,
            suggestions: [makeSuggestion()],
        });

        expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "sug-1" },
            data: {
                status: "expired",
                actedAt: expect.any(Date),
                autoAcceptStatus: "skipped",
                autoAcceptReasonCode: "already_acted",
            },
        });
    });

    it("records failed/dispatch_failed when accept throws dispatch error", async () => {
        worldSuggestionAccept.mockRejectedValueOnce(new Error("Task dispatch failed: token expired"));

        await expect(autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: "semi-auto",
            supervisorConfig: null,
            suggestions: [makeSuggestion()],
        })).rejects.toThrow("Auto-accept failed for suggestion sug-1");

        expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "sug-1" },
            data: {
                autoAcceptStatus: "failed",
                autoAcceptReasonCode: "accept_failed",
                autoAcceptFailureDetail: "dispatch_failed",
            },
        });
    });

    it("records failed/payload_invalid when accept throws payload error", async () => {
        worldSuggestionAccept.mockRejectedValueOnce(new Error("Suggestion payload does not match suggestion type"));

        await expect(autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: "semi-auto",
            supervisorConfig: null,
            suggestions: [makeSuggestion()],
        })).rejects.toThrow("Auto-accept failed for suggestion sug-1");

        expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "sug-1" },
            data: {
                autoAcceptStatus: "failed",
                autoAcceptReasonCode: "accept_failed",
                autoAcceptFailureDetail: "payload_invalid",
            },
        });
    });

    it("records failed/auto_accept_failed for unknown errors", async () => {
        worldSuggestionAccept.mockRejectedValueOnce(new Error("database unavailable"));

        await expect(autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: "semi-auto",
            supervisorConfig: null,
            suggestions: [makeSuggestion()],
        })).rejects.toThrow("Auto-accept failed for suggestion sug-1");

        expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "sug-1" },
            data: {
                autoAcceptStatus: "failed",
                autoAcceptReasonCode: "accept_failed",
                autoAcceptFailureDetail: "auto_accept_failed",
            },
        });
    });

    it("counts only system_auto accepts toward the daily quota", async () => {
        dbMock.worldSuggestion.count.mockResolvedValue(1);

        await autoAcceptSuggestedTasksIfEnabled({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: "semi-auto",
            supervisorConfig: JSON.stringify({ worldAutonomy: { maxAutoAcceptsPerDay: 2 } }),
            suggestions: [],
        });

        expect(dbMock.worldSuggestion.count).toHaveBeenCalledWith({
            where: {
                accountId: "user-1",
                projectId: "project-1",
                status: "accepted",
                acceptSource: "system_auto",
                actedAt: { gte: expect.any(Date) },
            },
        });
    });
});
