import { describe, expect, it, vi } from "vitest";
import { submitTask } from "./submitTask";

describe("submitTask", () => {
    it("passes created worktree path to task creation", async () => {
        const createTaskMock = vi.fn(async () => ({}));
        const createWorktreeMock = vi.fn(async () => ({
            success: true,
            worktreePath: "/repo/.dev/worktree/task-1",
            branchName: "task-1",
            parentBranch: "main",
        }));

        await submitTask({
            credentials: { token: "token" } as any,
            machineId: "machine-1",
            prompt: "Run task",
            priority: "user",
            maxAttempts: "3",
            selectedProjectId: "project-1",
            machineProjects: [{
                id: "local-project-1",
                serverId: "project-1",
                key: { machineId: "machine-1", path: "/repo" },
            }] as any,
        }, {
            createTask: createTaskMock as any,
            createWorktree: createWorktreeMock as any,
        });

        expect(createTaskMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ directory: "/repo/.dev/worktree/task-1" }),
        );
    });

    it("preserves created worktree when task creation fails", async () => {
        const createTaskMock = vi.fn(async () => {
            throw new Error("server failed");
        });
        const createWorktreeMock = vi.fn(async () => ({
            success: true,
            worktreePath: "/repo/.dev/worktree/task-1",
            branchName: "task-1",
            parentBranch: "main",
        }));

        await expect(submitTask({
            credentials: { token: "token" } as any,
            machineId: "machine-1",
            prompt: "Run task",
            priority: "user",
            maxAttempts: "3",
            selectedProjectId: "project-1",
            machineProjects: [{
                id: "local-project-1",
                serverId: "project-1",
                key: { machineId: "machine-1", path: "/repo" },
            }] as any,
        }, {
            createTask: createTaskMock as any,
            createWorktree: createWorktreeMock as any,
        })).rejects.toThrow("server failed");
    });

    it("rejects with typed worktree error when selected project path cannot be resolved", async () => {
        const createTaskMock = vi.fn(async () => ({}));

        await expect(submitTask({
            credentials: { token: "token" } as any,
            machineId: "machine-1",
            prompt: "Run task",
            priority: "user",
            maxAttempts: "3",
            selectedProjectId: "project-1",
            machineProjects: [],
        }, {
            createTask: createTaskMock as any,
            createWorktree: vi.fn() as any,
        })).rejects.toMatchObject({
            name: "WorktreeSetupError",
            kind: "resolve_project_path",
            message: "Failed to resolve project path",
        });

        expect(createTaskMock).not.toHaveBeenCalled();
    });

    it("wraps not-git-repo worktree failures in a typed error", async () => {
        const createWorktreeMock = vi.fn(async () => ({
            success: false,
            worktreePath: "",
            branchName: "",
            parentBranch: "main",
            errorCode: "not_git_repo",
            error: "Not a Git repository",
        }));

        await expect(submitTask({
            credentials: { token: "token" } as any,
            machineId: "machine-1",
            prompt: "Run task",
            priority: "user",
            maxAttempts: "3",
            selectedProjectId: "project-1",
            machineProjects: [{
                id: "local-project-1",
                serverId: "project-1",
                key: { machineId: "machine-1", path: "/repo" },
            }] as any,
        }, {
            createTask: vi.fn() as any,
            createWorktree: createWorktreeMock as any,
        })).rejects.toMatchObject({
            name: "WorktreeSetupError",
            kind: "not_git_repo",
            message: "Not a Git repository",
        });
    });

    it("wraps generic worktree failures in a typed error", async () => {
        const createTaskMock = vi.fn(async () => ({}));
        const createWorktreeMock = vi.fn(async () => ({
            success: false,
            worktreePath: "",
            branchName: "",
            parentBranch: "main",
            errorCode: "create_worktree_failed",
            error: "Permission denied",
        }));

        await expect(submitTask({
            credentials: { token: "token" } as any,
            machineId: "machine-1",
            prompt: "Run task",
            priority: "user",
            maxAttempts: "3",
            selectedProjectId: "project-1",
            machineProjects: [{
                id: "local-project-1",
                serverId: "project-1",
                key: { machineId: "machine-1", path: "/repo" },
            }] as any,
        }, {
            createTask: createTaskMock as any,
            createWorktree: createWorktreeMock as any,
        })).rejects.toMatchObject({
            name: "WorktreeSetupError",
            kind: "create_worktree_failed",
            message: "Permission denied",
        });

        expect(createTaskMock).not.toHaveBeenCalled();
    });
});
