import { describe, expect, it } from "vitest";
import {
    buildTaskDetailActions,
    formatTaskDate,
    getTaskFilterLabel,
    getTaskPriorityLabel,
    getTaskStatusBadgeColor,
    getTaskStatusLabel,
    isTaskActive,
    isTaskTerminal,
    matchesTaskFilter,
    sortTasksByUpdatedAt,
    TASK_FILTERS,
} from "./taskDetailViewModel";
import type { ServerTask } from "@/sync/apiTasks";

function createTask(overrides: Partial<ServerTask> = {}): ServerTask {
    return {
        id: "task-1",
        projectId: "project-1",
        machineId: "machine-1",
        directory: "/repo/.dev/worktree/task-1",
        priority: "urgent",
        status: "running",
        triggerType: "manual",
        triggerRef: null,
        attempt: 1,
        maxAttempts: 3,
        sessionId: "session-1",
        errorMessage: null,
        dispatchedAt: 1710000000000,
        completedAt: null,
        createdAt: 1710000000000,
        updatedAt: 1710000005000,
        promptPreview: "Run task",
        skillNames: ["skill-a"],
        ...overrides,
    };
}

const translate = (key: string) => key;

describe("taskDetailViewModel", () => {
    it("maps task status to badge colors", () => {
        expect(getTaskStatusBadgeColor("running")).toBe("#007AFF");
        expect(getTaskStatusBadgeColor("dispatching")).toBe("#007AFF");
        expect(getTaskStatusBadgeColor("completed")).toBe("#34C759");
        expect(getTaskStatusBadgeColor("failed")).toBe("#FF3B30");
        expect(getTaskStatusBadgeColor("cancelled")).toBe("#8E8E93");
        expect(getTaskStatusBadgeColor("queued")).toBe("#AEAEB2");
    });

    it("maps status, priority, and filter labels through i18n keys", () => {
        expect(getTaskStatusLabel("queued", translate)).toBe("tasks.statusQueued");
        expect(getTaskStatusLabel("completed", translate)).toBe("tasks.statusCompleted");
        expect(getTaskStatusLabel("custom", translate)).toBe("custom");
        expect(getTaskPriorityLabel("urgent", translate)).toBe("tasks.priorityUrgent");
        expect(getTaskPriorityLabel("background", translate)).toBe("tasks.priorityBackground");
        expect(getTaskPriorityLabel("custom", translate)).toBe("custom");
        expect(TASK_FILTERS).toEqual(["all", "active", "completed", "failed"]);
        expect(getTaskFilterLabel("all", translate)).toBe("tasks.filterAll");
        expect(getTaskFilterLabel("active", translate)).toBe("tasks.filterActive");
        expect(getTaskFilterLabel("custom", translate)).toBe("custom");
    });

    it("formats nullable dates", () => {
        expect(formatTaskDate(null)).toBe("-");
        expect(formatTaskDate(0)).not.toBe("-");
        expect(formatTaskDate(1710000000000)).not.toBe("-");
    });

    it("identifies active and terminal statuses", () => {
        expect(isTaskActive("queued")).toBe(true);
        expect(isTaskActive("running")).toBe(true);
        expect(isTaskActive("completed")).toBe(false);
        expect(isTaskTerminal("completed")).toBe(true);
        expect(isTaskTerminal("failed")).toBe(true);
        expect(isTaskTerminal("running")).toBe(false);
    });

    it("matches filters and sorts by updatedAt desc", () => {
        const newer = createTask({ id: "task-2", updatedAt: 20, status: "completed" });
        const older = createTask({ id: "task-1", updatedAt: 10, status: "running" });

        expect(matchesTaskFilter(older, undefined)).toBe(true);
        expect(matchesTaskFilter(older, "active")).toBe(true);
        expect(matchesTaskFilter(newer, "active")).toBe(false);
        expect(matchesTaskFilter(newer, "completed")).toBe(true);
        expect(sortTasksByUpdatedAt([older, newer]).map((task) => task.id)).toEqual([
            "task-2",
            "task-1",
        ]);
    });

    it("shows session jump and cancel for active tasks", () => {
        expect(buildTaskDetailActions(createTask())).toEqual({
            canCancel: true,
            canRetry: false,
            canDelete: false,
            sessionHref: "/session/session-1",
        });
    });

    it("shows retry and delete for failed tasks without session", () => {
        expect(buildTaskDetailActions(createTask({
            status: "failed",
            sessionId: null,
            errorMessage: "boom",
        }))).toEqual({
            canCancel: false,
            canRetry: true,
            canDelete: true,
            sessionHref: null,
        });
    });

    it("shows delete only for other terminal tasks", () => {
        expect(buildTaskDetailActions(createTask({ status: "completed" }))).toEqual({
            canCancel: false,
            canRetry: false,
            canDelete: true,
            sessionHref: "/session/session-1",
        });
    });
});
