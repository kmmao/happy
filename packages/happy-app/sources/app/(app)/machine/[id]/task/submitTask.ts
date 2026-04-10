import type { AuthCredentials } from "@/auth/tokenStorage";
import type { Project } from "@/sync/projectManager";

export class WorktreeSetupError extends Error {
    readonly kind: "not_git_repo" | "resolve_project_path" | "create_worktree_failed";

    constructor(
        kind: "not_git_repo" | "resolve_project_path" | "create_worktree_failed",
        message: string,
    ) {
        super(message);
        this.name = "WorktreeSetupError";
        this.kind = kind;
    }
}

type CreateTaskFn = (credentials: AuthCredentials, body: {
    machineId: string;
    prompt: string;
    priority?: string;
    maxAttempts?: number;
    skillIds?: string[];
    projectId?: string;
    directory?: string;
}) => Promise<unknown>;

type CreateWorktreeFn = (machineId: string, basePath: string, issueNumber?: number) => Promise<{
    success: boolean;
    worktreePath: string;
    branchName: string;
    parentBranch: string;
    errorCode?: 'not_git_repo' | 'create_worktree_failed';
    error?: string;
}>;

interface SubmitTaskDeps {
    createTask?: CreateTaskFn;
    createWorktree?: CreateWorktreeFn;
}

interface SubmitTaskInput {
    credentials: AuthCredentials;
    machineId: string;
    prompt: string;
    priority: string;
    maxAttempts: string;
    selectedProjectId: string | null;
    machineProjects: Project[];
}

async function resolveDeps(deps: SubmitTaskDeps): Promise<Required<SubmitTaskDeps>> {
    if (deps.createTask && deps.createWorktree) {
        return deps as Required<SubmitTaskDeps>;
    }

    const [{ createTask }, { createWorktree }] = await Promise.all([
        import("@/sync/apiTasks"),
        import("@/utils/createWorktree"),
    ]);

    return {
        createTask: deps.createTask ?? createTask,
        createWorktree: deps.createWorktree ?? createWorktree,
    };
}

export async function submitTask(
    input: SubmitTaskInput,
    deps: SubmitTaskDeps = {},
): Promise<void> {
    const {
        createTask: createTaskImpl,
        createWorktree: createWorktreeImpl,
    } = await resolveDeps(deps);

    let taskDirectory: string | undefined;

    if (input.selectedProjectId) {
        const proj = input.machineProjects.find(
            (p) => (p.serverId ?? p.id) === input.selectedProjectId,
        );
        if (!proj?.key.path) {
            throw new WorktreeSetupError("resolve_project_path", "Failed to resolve project path");
        }

        const wt = await createWorktreeImpl(input.machineId, proj.key.path);
        if (!wt.success) {
            throw new WorktreeSetupError(
                wt.errorCode === "not_git_repo" ? "not_git_repo" : "create_worktree_failed",
                wt.error ?? "Failed to create worktree",
            );
        }
        taskDirectory = wt.worktreePath;
    }

    await createTaskImpl(input.credentials, {
        machineId: input.machineId,
        prompt: input.prompt.trim(),
        priority: input.priority,
        maxAttempts: Math.max(1, parseInt(input.maxAttempts, 10) || 3),
        projectId: input.selectedProjectId ?? undefined,
        directory: taskDirectory,
    });
}
