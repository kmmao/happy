/**
 * Git worktree operations for managing the worktree lifecycle.
 * Provides functions for listing, diffing, merging, and cleaning up worktrees.
 */

import { machineBash, sessionBash } from "./ops";

export interface WorktreeInfo {
    readonly name: string;
    readonly path: string;
    readonly branch: string;
    readonly commit: string;
}

export interface DiffStats {
    readonly filesChanged: number;
    readonly insertions: number;
    readonly deletions: number;
}

export interface CommitInfo {
    readonly hash: string;
    readonly message: string;
    readonly author: string;
    readonly date: string;
}

export interface WorktreeOpResult {
    readonly success: boolean;
    readonly error?: string;
}

/**
 * List all Happy-managed worktrees on a machine.
 */
export async function listWorktrees(
    machineId: string,
    repoPath: string,
): Promise<readonly WorktreeInfo[]> {
    const result = await machineBash(
        machineId,
        "git worktree list --porcelain",
        repoPath,
    );

    if (!result.success) {
        return [];
    }

    const entries: WorktreeInfo[] = [];
    const blocks = result.stdout.split("\n\n").filter(Boolean);

    for (const block of blocks) {
        const lines = block.split("\n");
        let path = "";
        let branch = "";
        let commit = "";

        for (const line of lines) {
            if (line.startsWith("worktree ")) {
                path = line.substring("worktree ".length);
            } else if (line.startsWith("HEAD ")) {
                commit = line.substring("HEAD ".length).substring(0, 8);
            } else if (line.startsWith("branch ")) {
                branch = line.substring("branch refs/heads/".length);
            }
        }

        // Only include Happy-managed worktrees
        if (path && path.includes(".dev/worktree/")) {
            const name = path.split(".dev/worktree/").pop() || branch;
            entries.push({ name, path, branch: branch || "(detached)", commit });
        }
    }

    return entries;
}

/**
 * Get diff between worktree branch and parent branch.
 */
export async function getWorktreeDiff(
    sessionId: string,
    parentBranch: string,
): Promise<{ readonly success: boolean; readonly diff: string; readonly stats: DiffStats }> {
    const statsResult = await sessionBash(sessionId, {
        command: `git diff --stat ${parentBranch}...HEAD 2>&1`,
        timeout: 15000,
    });

    const diffResult = await sessionBash(sessionId, {
        command: `git diff ${parentBranch}...HEAD 2>&1`,
        timeout: 30000,
    });

    // Parse stats
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;

    if (statsResult.success && statsResult.stdout) {
        const lastLine = statsResult.stdout.trim().split("\n").pop() || "";
        const filesMatch = lastLine.match(/(\d+) files? changed/);
        const insertMatch = lastLine.match(/(\d+) insertions?/);
        const deleteMatch = lastLine.match(/(\d+) deletions?/);
        filesChanged = filesMatch ? parseInt(filesMatch[1], 10) : 0;
        insertions = insertMatch ? parseInt(insertMatch[1], 10) : 0;
        deletions = deleteMatch ? parseInt(deleteMatch[1], 10) : 0;
    }

    return {
        success: diffResult.success,
        diff: diffResult.stdout || "",
        stats: { filesChanged, insertions, deletions },
    };
}

/**
 * Get commit log for worktree branch since diverging from parent.
 */
export async function getWorktreeCommits(
    sessionId: string,
    parentBranch: string,
): Promise<{ readonly success: boolean; readonly commits: readonly CommitInfo[] }> {
    const result = await sessionBash(sessionId, {
        command: `git log ${parentBranch}..HEAD --format="%H|%s|%an|%ad" --date=short 2>&1`,
        timeout: 15000,
    });

    if (!result.success || !result.stdout.trim()) {
        return { success: result.success, commits: [] };
    }

    const commits = result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
            const [hash, message, author, date] = line.split("|");
            return {
                hash: (hash || "").substring(0, 8),
                message: message || "",
                author: author || "",
                date: date || "",
            };
        });

    return { success: true, commits };
}

/**
 * Push worktree branch and create PR via gh CLI.
 */
export async function createPullRequest(
    sessionId: string,
    branchName: string,
    parentBranch: string,
    title: string,
    body: string,
): Promise<{ readonly success: boolean; readonly prUrl?: string; readonly error?: string }> {
    // Check if gh is installed
    const ghCheck = await sessionBash(sessionId, {
        command: "gh --version 2>&1",
        timeout: 5000,
    });

    if (!ghCheck.success || ghCheck.exitCode !== 0) {
        return {
            success: false,
            error: "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/",
        };
    }

    // Push the branch
    const pushResult = await sessionBash(sessionId, {
        command: `git push -u origin ${branchName} 2>&1`,
        timeout: 60000,
    });

    if (!pushResult.success || pushResult.exitCode !== 0) {
        return {
            success: false,
            error: pushResult.stdout.trim() || pushResult.stderr?.trim() || "Push failed",
        };
    }

    // Create PR
    const escapedTitle = title.replace(/"/g, '\\"');
    const escapedBody = body.replace(/"/g, '\\"');
    const prResult = await sessionBash(sessionId, {
        command: `gh pr create --base "${parentBranch}" --head "${branchName}" --title "${escapedTitle}" --body "${escapedBody}" 2>&1`,
        timeout: 30000,
    });

    if (!prResult.success || prResult.exitCode !== 0) {
        return {
            success: false,
            error: prResult.stdout.trim() || prResult.stderr?.trim() || "PR creation failed",
        };
    }

    // Extract PR URL from output
    const prUrl = prResult.stdout.trim().split("\n").pop() || "";

    return { success: true, prUrl };
}

/**
 * Direct merge: merge worktree branch into parent branch.
 */
export async function directMerge(
    machineId: string,
    branchName: string,
    parentBranch: string,
    repoPath: string,
): Promise<WorktreeOpResult> {
    // Merge from the parent repo (not from inside the worktree)
    const result = await machineBash(
        machineId,
        `git merge ${branchName} --no-ff -m "Merge worktree branch '${branchName}'" 2>&1`,
        repoPath,
    );

    if (!result.success || result.exitCode !== 0) {
        const output = result.stdout.trim() || result.stderr.trim();
        if (output.includes("CONFLICT")) {
            return {
                success: false,
                error: `Merge conflicts detected. Please resolve them manually in ${repoPath}`,
            };
        }
        return {
            success: false,
            error: output || "Merge failed",
        };
    }

    return { success: true };
}

/**
 * Remove a worktree and optionally delete its branch.
 */
export async function removeWorktree(
    machineId: string,
    worktreeName: string,
    repoPath: string,
    deleteBranch: boolean,
): Promise<WorktreeOpResult> {
    // Prune stale worktrees first
    await machineBash(machineId, "git worktree prune", repoPath);

    // Remove worktree
    const worktreePath = `.dev/worktree/${worktreeName}`;
    const removeResult = await machineBash(
        machineId,
        `git worktree remove "${worktreePath}" --force 2>&1`,
        repoPath,
    );

    if (!removeResult.success && !removeResult.stderr.includes("is not a working tree")) {
        return {
            success: false,
            error: removeResult.stdout.trim() || removeResult.stderr.trim() || "Failed to remove worktree",
        };
    }

    // Optionally delete the branch
    if (deleteBranch) {
        const branchResult = await machineBash(
            machineId,
            `git branch -d "${worktreeName}" 2>&1`,
            repoPath,
        );

        if (!branchResult.success && branchResult.stderr.includes("not fully merged")) {
            return {
                success: true,
                error: `Worktree removed but branch '${worktreeName}' was not deleted (not fully merged)`,
            };
        }
    }

    return { success: true };
}
